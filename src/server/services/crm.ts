/**
 * ============================================================
 *  خدمة CRM التاجر والعميل — مرحلة ج
 * ------------------------------------------------------------
 *  recipientLookup   — تاريخ العميل بالموبايل + هل هو في القائمة السوداء
 *  blacklist add/remove/isBlacklisted
 *  awardPoints       — حركة نقاط الولاء (الرصيد على merchants.points)
 *  updateMerchantCrm — موظف مبيعات/خدمة عملاء/نوع منتج/وزن مسموح
 *  عناوين الاستلام + الأسعار الخاصة (view/add)
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { normalizeEgyptMobile } from "@/lib/phone";
import { poundsToPiastres, type Piastres } from "@/lib/money";
import { type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

// ---------------------------------------------------------------
// لوك-أب المستلم
// ---------------------------------------------------------------

export interface RecipientLookup {
  phone: string;
  total: number;
  delivered: number;
  failed: number;
  returned: number;
  /** نسبة النجاح من اللي اتحسم */
  successRate: number;
  blacklisted: boolean;
  blacklistReason: string | null;
  lastNames: string[];
}

/** تاريخ العميل بالموبايل عبر كل التجار + حالة القائمة السوداء. */
export async function recipientLookup(ex: SqlExecutor, phoneRaw: string): Promise<RecipientLookup> {
  const phone = normalizeEgyptMobile(phoneRaw);
  if (!phone) throw new HttpError(400, "BAD_PHONE", "رقم غير صالح");

  const stats = rowsOf<{
    total: number; delivered: number; failed: number; returned: number;
  }>(
    await ex.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('delivered','partially_delivered'))::int AS delivered,
        COUNT(*) FILTER (WHERE status = 'delivery_failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'returned_to_merchant')::int AS returned
      FROM shipments WHERE recipient_phone = ${phone}
    `)
  )[0] ?? { total: 0, delivered: 0, failed: 0, returned: 0 };

  const names = rowsOf<{ recipient_name: string }>(
    await ex.execute(sql`
      SELECT DISTINCT recipient_name FROM shipments WHERE recipient_phone = ${phone} ORDER BY recipient_name LIMIT 5
    `)
  ).map((r) => r.recipient_name);

  const bl = rowsOf<{ reason_ar: string }>(
    await ex.execute(sql`SELECT reason_ar FROM customer_blacklist WHERE phone = ${phone} LIMIT 1`)
  )[0];

  const resolved = stats.delivered + stats.returned;
  return {
    phone,
    total: stats.total,
    delivered: stats.delivered,
    failed: stats.failed,
    returned: stats.returned,
    successRate: resolved > 0 ? Math.round((stats.delivered / resolved) * 1000) / 10 : 0,
    blacklisted: !!bl,
    blacklistReason: bl?.reason_ar ?? null,
    lastNames: names,
  };
}

export async function isBlacklisted(ex: SqlExecutor, phone: string): Promise<boolean> {
  const p = normalizeEgyptMobile(phone);
  if (!p) return false;
  const r = rowsOf<{ n: number }>(
    await ex.execute(sql`SELECT COUNT(*)::int AS n FROM customer_blacklist WHERE phone = ${p}`)
  )[0];
  return (r?.n ?? 0) > 0;
}

export async function addBlacklist(
  ex: SqlExecutor,
  input: { phone: string; reason: string; actorUserId: string | null }
): Promise<{ phone: string }> {
  const phone = normalizeEgyptMobile(input.phone);
  if (!phone) throw new HttpError(400, "BAD_PHONE", "رقم غير صالح");
  if (!input.reason?.trim()) throw new HttpError(422, "REASON_REQUIRED", "لازم سبب");
  await ex.execute(sql`
    INSERT INTO customer_blacklist (phone, reason_ar, added_by)
    VALUES (${phone}, ${input.reason}, ${input.actorUserId ?? null}::uuid)
    ON CONFLICT (phone) DO UPDATE SET reason_ar = EXCLUDED.reason_ar
  `);
  return { phone };
}

export async function removeBlacklist(ex: SqlExecutor, phoneRaw: string): Promise<{ removed: boolean }> {
  const phone = normalizeEgyptMobile(phoneRaw);
  if (!phone) throw new HttpError(400, "BAD_PHONE", "رقم غير صالح");
  await ex.execute(sql`DELETE FROM customer_blacklist WHERE phone = ${phone}`);
  return { removed: true };
}

// ---------------------------------------------------------------
// نقاط الولاء
// ---------------------------------------------------------------

/** إضافة/خصم نقاط للتاجر مع تسجيل الحركة. */
export async function awardPoints(
  ex: SqlExecutor,
  input: { merchantId: string; delta: number; reason: string; actor: Actor }
): Promise<{ balance: string }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new HttpError(400, "BAD_DELTA", "قيمة نقاط غير صالحة");
  }
  const m = rowsOf<{ points: string }>(
    await ex.execute(sql`SELECT points::text FROM merchants WHERE id = ${input.merchantId}::uuid FOR UPDATE`)
  )[0];
  if (!m) throw new HttpError(404, "NOT_FOUND", "التاجر مش موجود");
  const balance = BigInt(m.points) + BigInt(input.delta);
  if (balance < 0n) throw new HttpError(422, "INSUFFICIENT", "النقاط مش كفاية للاستبدال");

  await ex.execute(sql`UPDATE merchants SET points = ${balance.toString()}::bigint, updated_at = now() WHERE id = ${input.merchantId}::uuid`);
  await ex.execute(sql`
    INSERT INTO merchant_point_events (merchant_id, delta, balance_after, reason_ar, created_by)
    VALUES (${input.merchantId}::uuid, ${input.delta}, ${balance.toString()}::bigint, ${input.reason}, ${input.actor.userId ?? null}::uuid)
  `);
  return { balance: balance.toString() };
}

// ---------------------------------------------------------------
// بيانات التاجر التسويقية
// ---------------------------------------------------------------

export async function updateMerchantCrm(
  ex: SqlExecutor,
  input: {
    merchantId: string;
    salesRepId?: string | null;
    csRepId?: string | null;
    productType?: string | null;
    allowedWeightKg?: string | null;
  }
): Promise<{ updated: boolean }> {
  await ex.execute(sql`
    UPDATE merchants SET
      sales_rep_id = ${input.salesRepId !== undefined ? sql`${input.salesRepId}::uuid` : sql`sales_rep_id`},
      cs_rep_id = ${input.csRepId !== undefined ? sql`${input.csRepId}::uuid` : sql`cs_rep_id`},
      product_type = ${input.productType !== undefined ? sql`${input.productType}` : sql`product_type`},
      allowed_weight_kg = ${input.allowedWeightKg !== undefined ? sql`${input.allowedWeightKg}` : sql`allowed_weight_kg`},
      updated_at = now()
    WHERE id = ${input.merchantId}::uuid
  `);
  return { updated: true };
}

// ---------------------------------------------------------------
// عناوين الاستلام المتعددة
// ---------------------------------------------------------------

export async function listPickupAddresses(ex: SqlExecutor, merchantId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT a.id::text, a.label, a.address, a.phone, a.is_default, a.is_active, g.name_ar AS governorate
      FROM merchant_pickup_addresses a
      LEFT JOIN governorates g ON g.id = a.governorate_id
      WHERE a.merchant_id = ${merchantId}::uuid AND a.is_active = true
      ORDER BY a.is_default DESC, a.created_at
    `)
  );
}

export async function addPickupAddress(
  ex: SqlExecutor,
  input: { merchantId: string; label: string; address: string; governorateId?: string | null; phone?: string | null; isDefault?: boolean }
): Promise<{ id: string }> {
  if (input.isDefault) {
    await ex.execute(sql`UPDATE merchant_pickup_addresses SET is_default = false WHERE merchant_id = ${input.merchantId}::uuid`);
  }
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO merchant_pickup_addresses (merchant_id, label, address, governorate_id, phone, is_default)
      VALUES (${input.merchantId}::uuid, ${input.label}, ${input.address},
              ${input.governorateId ?? null}::uuid, ${input.phone ?? null}, ${input.isDefault ?? false})
      RETURNING id::text
    `)
  )[0]!.id;
  return { id };
}

// ---------------------------------------------------------------
// الأسعار الخاصة بالتاجر
// ---------------------------------------------------------------

export async function listPriceOverrides(ex: SqlExecutor, merchantId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT o.id::text, z.name_ar AS zone, o.tier, o.price_p::text AS price_p,
             o.effective_from, o.effective_to
      FROM merchant_price_overrides o
      JOIN zones z ON z.id = o.zone_id
      WHERE o.merchant_id = ${merchantId}::uuid
      ORDER BY z.sort_order, o.tier
    `)
  );
}

export async function addPriceOverride(
  ex: SqlExecutor,
  input: { merchantId: string; zoneId: string; tier: string | null; price: string }
): Promise<{ id: string }> {
  const priceP: Piastres = poundsToPiastres(input.price);
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO merchant_price_overrides (merchant_id, zone_id, tier, price_p, effective_from)
      VALUES (${input.merchantId}::uuid, ${input.zoneId}::uuid, ${input.tier}, ${priceP.toString()}::bigint, now())
      RETURNING id::text
    `)
  )[0]!.id;
  return { id };
}
