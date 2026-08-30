/**
 * GET /api/v1/shipments/:id — تفاصيل شحنة كاملة (للبوليصة والعرض).
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
        SELECT s.id, s.awb, s.status, s.service_type,
               s.recipient_name, s.recipient_phone, s.recipient_phone_alt,
               s.address_line, s.landmark,
               s.cod_amount_p::text AS cod_amount_p, s.payment_method, s.shipping_payer,
               s.pieces_count, s.is_fragile, s.fragile_insured, s.notes_to_courier,
               s.price_p::text AS price_p, s.total_fees_p::text AS total_fees_p,
               s.merchant_reference, s.created_at,
               g.name_ar AS governorate, z.name_ar AS zone, a.name_ar AS area,
               m.name_ar AS merchant_name, m.code AS merchant_code, m.phone AS merchant_phone
        FROM shipments s
        JOIN governorates g ON g.id = s.governorate_id
        JOIN zones z ON z.id = s.zone_id
        LEFT JOIN areas a ON a.id = s.area_id
        LEFT JOIN merchants m ON m.id = s.merchant_id
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

    return ok({
      shipment: {
        ...s,
        codAmount: formatEGP(BigInt((s.cod_amount_p as string) || "0")),
      },
      items: items.map((it) => ({
        id: it.id, nameAr: it.name_ar, sku: it.sku, qty: it.qty,
        unitPriceP: it.unit_price_p, price: formatEGP(BigInt(it.unit_price_p || "0")), status: it.status,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
