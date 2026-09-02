/**
 * /api/v1/pricing — أسعار الشحن (منطقة × شريحة) والرسوم.
 * GET (الكل يشوف) · PATCH (المدير يعدّل). التعديل بيأثّر على الشحنات
 * الجديدة بس — القديمة سعرها مثبّت وقت الإنشاء (snapshot).
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { requireUser, requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MANAGER = ["super_admin", "branch_manager"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const prices = rowsOf<{ id: string; zone: string; tier: string; price_p: string }>(
      await db.execute(sql`
        SELECT pli.id, z.name_ar AS zone, pli.tier, pli.price_p::text
        FROM price_list_items pli
        JOIN zones z ON z.id = pli.zone_id
        JOIN price_lists pl ON pl.id = pli.price_list_id
        WHERE pl.scope = 'global' AND pl.is_active = true
          AND pl.effective_from <= now() AND (pl.effective_to IS NULL OR pl.effective_to > now())
        ORDER BY z.name_ar, pli.tier
      `)
    );
    const fees = rowsOf<{ id: string; code: string; name_ar: string; calc_type: string; value_p: string; percent_bp: number }>(
      await db.execute(sql`
        SELECT id, code, name_ar, calc_type, value_p::text, percent_bp
        FROM fee_definitions WHERE is_active = true ORDER BY code
      `)
    );
    return ok({
      prices: prices.map((p) => ({ id: p.id, zone: p.zone, tier: p.tier, price: formatEGP(BigInt(p.price_p)), priceP: p.price_p })),
      fees: fees.map((f) => ({ id: f.id, code: f.code, nameAr: f.name_ar, calcType: f.calc_type, value: formatEGP(BigInt(f.value_p)), valueP: f.value_p, percentBp: f.percent_bp })),
    });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  kind: z.enum(["price", "fee"]),
  id: z.string().uuid(),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/, "المبلغ لازم رقم"),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req, MANAGER);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);
    const { kind, id, value } = parsed.data;
    const p = poundsToPiastres(value);
    if (kind === "price") {
      await db.execute(sql`UPDATE price_list_items SET price_p = ${p.toString()}::bigint WHERE id = ${id}::uuid`);
    } else {
      await db.execute(sql`UPDATE fee_definitions SET value_p = ${p.toString()}::bigint WHERE id = ${id}::uuid`);
    }
    return ok({ updated: true, value: formatEGP(p) });
  } catch (err) { return handleError(err); }
}
