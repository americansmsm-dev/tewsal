/**
 * ============================================================
 *  بناء القيد المالي للتحول
 * ------------------------------------------------------------
 *  التحول المالي (تسليم/مرتجع/إلغاء) بيحتاج قيد. الملف ده
 *  بيبنيه من **السعر المُثبّت على الشحنة** والرسوم المخزّنة —
 *  مش بيعيد حساب السعر (اللي ممكن يكون اتغيّر).
 *
 *  ⚠️ رسوم التحصيل بتتحسب على **المبلغ المحصّل فعلًا** —
 *     في التسليم الكامل ده = المبلغ المسجّل، وفي الجزئي أقل.
 *
 *  بيرجّع null لو التحول مش بيقيّد قيد دلوقتي (فقد/تلف →
 *  بيفتحوا مطالبة، والتعويض بيتقيّد وقت اعتمادها).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { calcCodFee, type CodPercentBasis } from "@/lib/money";
import type { ShipmentStatus } from "../domain/statusMachine";
import {
  buildDeliveryEntry,
  buildReturnEntry,
  buildCancellationEntry,
  type DraftEntry,
} from "../domain/ledger";
import type { SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

interface FinShipment {
  id: string;
  awb: string;
  merchant_id: string;
  current_courier_id: string | null;
  price_p: string;
  zone_id: string;
  governorate_id: string;
}

export interface FinancialTransitionParams {
  shipmentId: string;
  to: ShipmentStatus;
  cod?: { collectedP: bigint; method: string };
}

/**
 * بناء قيد التحول المالي.
 * بيقرا الشحنة والرسوم من نفس الترانزاكشن، فلازم يتنده بـ tx.
 */
export async function buildTransitionFinancialEntry(
  ex: SqlExecutor,
  params: FinancialTransitionParams
): Promise<DraftEntry | null> {
  const ships = rowsOf<FinShipment>(
    await ex.execute(sql`
      SELECT id, awb, merchant_id, current_courier_id,
             price_p::text, zone_id, governorate_id
      FROM shipments WHERE id = ${params.shipmentId}::uuid
    `)
  );
  const ship = ships[0];
  if (!ship) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");

  const shippingP = BigInt(ship.price_p);

  switch (params.to) {
    case "delivered":
    case "partially_delivered": {
      if (!params.cod) {
        throw new HttpError(400, "BAD_INPUT", "التسليم محتاج المبلغ المحصّل وطريقة الدفع");
      }
      if (!ship.current_courier_id) {
        throw new HttpError(422, "BAD_INPUT", "الشحنة مش على مندوب — مينفعش تتسلّم");
      }
      const codFeeP = await computeCodFee(ex, params.cod.collectedP);
      const otherFeesP = await sumOtherFees(ex, ship.id);
      return buildDeliveryEntry({
        shipmentId: ship.id,
        merchantId: ship.merchant_id,
        courierId: ship.current_courier_id,
        awb: ship.awb,
        codCollectedP: params.cod.collectedP,
        paymentMethod: params.cod.method,
        shippingP,
        codFeeP,
        otherFeesP,
      });
    }

    case "returned_to_merchant": {
      const chargeShipping = await boolSetting(ex, "billing.charge_shipping_on_return", true);
      const returnFeeP = await resolveReturnFee(ex, ship.zone_id, ship.governorate_id);
      return buildReturnEntry({
        shipmentId: ship.id,
        merchantId: ship.merchant_id,
        awb: ship.awb,
        shippingP: chargeShipping ? shippingP : 0n,
        returnFeeP,
      });
    }

    case "cancelled": {
      // الإلغاء بيتحاسب شحن **بس بعد دخول المخزن** — قرار ٥.
      // الإلغاء المبكر بيوصل هنا بشحن صفر، فمفيش قيد.
      const chargeShipping = await boolSetting(ex, "billing.charge_shipping_on_cancel_after_hub", true);
      if (!chargeShipping || shippingP <= 0n) return null;
      return buildCancellationEntry({
        shipmentId: ship.id,
        merchantId: ship.merchant_id,
        awb: ship.awb,
        shippingP,
      });
    }

    // فقد/تلف → مطالبة، مفيش قيد دلوقتي
    default:
      return null;
  }
}

// ---------------------------------------------------------------
// قراءة الإعدادات والرسوم
// ---------------------------------------------------------------

/** رسوم التحصيل على المبلغ المحصّل فعلًا — من تعريف COD */
async function computeCodFee(ex: SqlExecutor, collectedP: bigint): Promise<bigint> {
  if (collectedP <= 0n) return 0n; // مدفوع مقدمًا
  const rows = rowsOf<{
    value_p: string;
    percent_bp: number;
    threshold_p: string;
    basis: string;
  }>(
    await ex.execute(sql`
      SELECT value_p::text, percent_bp, threshold_p::text, basis
      FROM fee_definitions WHERE code = 'COD' AND is_active = true LIMIT 1
    `)
  );
  const cod = rows[0];
  if (!cod) return 0n;
  return calcCodFee(collectedP, {
    flatFee: BigInt(cod.value_p),
    threshold: BigInt(cod.threshold_p),
    percentBp: cod.percent_bp,
    basis: cod.basis as CodPercentBasis,
  });
}

/** مجموع الرسوم الإضافية الفعّالة (قطع/وزن/نائية) — بدون الشحن والتحصيل */
async function sumOtherFees(ex: SqlExecutor, shipmentId: string): Promise<bigint> {
  const rows = rowsOf<{ total: string }>(
    await ex.execute(sql`
      SELECT COALESCE(SUM(amount_p), 0)::text AS total
      FROM shipment_fees
      WHERE shipment_id = ${shipmentId}::uuid
        AND voided_at IS NULL
        AND is_estimate = false
        AND fee_code NOT IN ('SHIPPING', 'COD', 'RETURN', 'EXCHANGE')
    `)
  );
  return BigInt(rows[0]?.total ?? "0");
}

/** رسم المرتجع الفعّال: تجاوز محافظة > تجاوز منطقة > الأساسي */
async function resolveReturnFee(
  ex: SqlExecutor,
  zoneId: string,
  governorateId: string
): Promise<bigint> {
  const rows = rowsOf<{ value_p: string }>(
    await ex.execute(sql`
      SELECT value_p::text FROM (
        SELECT value_p, 1 AS pri FROM fee_zone_overrides
          WHERE fee_code = 'RETURN' AND governorate_id = ${governorateId}::uuid AND is_active = true
        UNION ALL
        SELECT value_p, 2 AS pri FROM fee_zone_overrides
          WHERE fee_code = 'RETURN' AND zone_id = ${zoneId}::uuid AND governorate_id IS NULL AND is_active = true
        UNION ALL
        SELECT value_p, 3 AS pri FROM fee_definitions
          WHERE code = 'RETURN' AND is_active = true
      ) t ORDER BY pri LIMIT 1
    `)
  );
  return BigInt(rows[0]?.value_p ?? "0");
}

/** قراءة إعداد منطقي من جدول الإعدادات */
async function boolSetting(ex: SqlExecutor, key: string, fallback: boolean): Promise<boolean> {
  const rows = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`)
  );
  const v = rows[0]?.value;
  if (v === undefined || v === null) return fallback;
  return v === true || v === "true";
}
