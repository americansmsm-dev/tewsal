/**
 * GET /api/v1/shipments/:id — تفاصيل شحنة كاملة (للبوليصة والعرض).
 * بيرجّع كل بيانات الأوردر + قطعه + **تاريخ كل خطوة** عدّى بيها.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireUser(req);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.awb, s.status, s.service_type, s.merchant_id,
               s.recipient_name, s.recipient_phone, s.recipient_phone_alt,
               s.address_line, s.landmark,
               s.cod_amount_p::text AS cod_amount_p, s.payment_method, s.shipping_payer,
               s.pieces_count, s.is_fragile, s.fragile_insured, s.notes_to_courier,
               s.price_p::text AS price_p, s.total_fees_p::text AS total_fees_p,
               s.merchant_net_p::text AS merchant_net_p,
               s.weight_registered_kg, s.weight_actual_kg, s.attempts_count,
               s.merchant_reference, s.created_at, s.promised_at, s.rescheduled_at,
               s.delivered_at, s.is_wallet_order,
               -- تاريخ الاستلام من التاجر: بيتستخرج من تاريخ الحالات (مفيش عمود ليه)
               (SELECT h.occurred_at FROM shipment_status_history h
                 WHERE h.shipment_id = s.id AND h.to_status = 'picked_up'
                 ORDER BY h.occurred_at ASC LIMIT 1) AS picked_up_at,
               g.name_ar AS governorate, z.name_ar AS zone, a.name_ar AS area,
               m.name_ar AS merchant_name, m.code AS merchant_code, m.phone AS merchant_phone,
               cu.full_name AS courier_name, cu.phone AS courier_phone
        FROM shipments s
        JOIN governorates g ON g.id = s.governorate_id
        JOIN zones z ON z.id = s.zone_id
        LEFT JOIN areas a ON a.id = s.area_id
        LEFT JOIN merchants m ON m.id = s.merchant_id
        LEFT JOIN users cu ON cu.id = s.current_courier_id
        WHERE s.id = ${id}::uuid
        LIMIT 1
      `)
    );
    const s = rows[0];
    if (!s) return handleError(notFound("الشحنة مش موجودة"));

    // التاجر يشوف شحناته هو بس
    if (ctx.user.role === "merchant" && s.merchant_id && s.merchant_id !== ctx.user.merchantId) {
      return handleError(notFound("الشحنة مش موجودة"));
    }

    // قطع الأوردر (للتسليم الجزئي بالقطعة)
    const items = rowsOf<{ id: string; name_ar: string; sku: string | null; qty: number; unit_price_p: string; status: string }>(
      await db.execute(sql`
        SELECT id, name_ar, sku, qty, unit_price_p::text, status
        FROM shipment_items WHERE shipment_id = ${id}::uuid ORDER BY created_at ASC
      `)
    );

    // تاريخ كل خطوة عدّت بيها الشحنة (مين، إمتى، ليه)
    const history = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT h.from_status, h.to_status, h.reason_code, h.note,
               h.actor_name, h.actor_role, h.occurred_at, h.recorded_at, h.source,
               rc.name_ar AS reason_label
        FROM shipment_status_history h
        LEFT JOIN shipment_reason_codes rc ON rc.code = h.reason_code
        WHERE h.shipment_id = ${id}::uuid
        ORDER BY h.occurred_at ASC, h.recorded_at ASC
      `)
    );

    // عمولة المندوب لكل أوردر — تكلفة على الشركة (مالهاش علاقة بالتاجر)
    const commRaw = rowsOf<{ value: unknown }>(
      await db.execute(sql`SELECT value FROM settings WHERE key = 'commission.default_per_delivery_p' LIMIT 1`)
    )[0]?.value;
    const commissionP = BigInt(typeof commRaw === "number" ? commRaw : Number(commRaw ?? 0) || 0);

    const codP = BigInt((s.cod_amount_p as string) || "0");
    const priceP = BigInt((s.price_p as string) || "0");
    // ⚠️ total_fees_p **شامل سعر الشحن** (SHIPPING بند جوه الرسوم) — فمنطرحش الشحن تاني
    const feesP = BigInt((s.total_fees_p as string) || "0");
    // صافي التاجر المعتمد وقت الإنشاء (= التحصيل − إجمالي الرسوم)
    const netP = BigInt((s.merchant_net_p as string) || (codP - feesP).toString());
    // تفصيل سعر الأوردر: لو الشحن على العميل فالتحصيل شامل الشحن أصلًا
    const customerPaysShipping = s.shipping_payer === "customer";
    const goodsP = customerPaysShipping ? codP - priceP : codP; // البضاعة من غير شحن
    const withShippingP = goodsP + priceP;                       // البضاعة + الشحن
    return ok({
      shipment: {
        ...s,
        codAmount: formatEGP(codP),
        priceAmount: formatEGP(priceP),
        goodsAmount: formatEGP(goodsP > 0n ? goodsP : 0n),
        withShippingAmount: formatEGP(withShippingP > 0n ? withShippingP : priceP),
        customerPaysShipping,
        feesAmount: formatEGP(feesP),
        // صافي التاجر = التحصيل − إجمالي الرسوم (الرسوم شاملة الشحن)
        netAmount: formatEGP(netP),
        courierCommission: formatEGP(commissionP),
        courierCommissionP: commissionP.toString(),
      },
      items: items.map((it) => ({
        id: it.id, nameAr: it.name_ar, sku: it.sku, qty: it.qty,
        unitPriceP: it.unit_price_p, price: formatEGP(BigInt(it.unit_price_p || "0")), status: it.status,
      })),
      history,
    });
  } catch (err) {
    return handleError(err);
  }
}
