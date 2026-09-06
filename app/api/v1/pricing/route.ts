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
    const prices = rowsOf<{ id: string; zone: string; tier: string; price_p: string; cost_p: string | null }>(
      await db.execute(sql`
        SELECT pli.id, z.name_ar AS zone, pli.tier, pli.price_p::text,
               -- تكلفة المندوب على مستوى المنطقة (لو فيه قاعدة عمولة خاصة بالمنطقة)
               (SELECT ccr.amount_p::text FROM courier_commission_rules ccr
                  WHERE ccr.zone_id = pli.zone_id AND ccr.courier_id IS NULL AND ccr.governorate_id IS NULL
                    AND ccr.is_active = true AND ccr.effective_from <= now()
                    AND (ccr.effective_to IS NULL OR ccr.effective_to > now())
                  ORDER BY ccr.priority DESC LIMIT 1) AS cost_p
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
    // عمولة المندوب لكل أوردر متسلّم — تكلفة على الشركة (مش على التاجر)
    const commissionP = rowsOf<{ value: unknown }>(
      await db.execute(sql`SELECT value FROM settings WHERE key = 'commission.default_per_delivery_p' LIMIT 1`)
    )[0]?.value;
    const cP = BigInt(typeof commissionP === "number" ? commissionP : Number(commissionP ?? 0) || 0);
    // عمولة المرتجع — سعر منفصل عن التسليم
    const commissionRetP = rowsOf<{ value: unknown }>(
      await db.execute(sql`SELECT value FROM settings WHERE key = 'commission.default_per_return_p' LIMIT 1`)
    )[0]?.value;
    const crP = BigInt(typeof commissionRetP === "number" ? commissionRetP : Number(commissionRetP ?? 0) || 0);

    return ok({
      commission: { valueP: cP.toString(), value: formatEGP(cP) },
      commissionReturn: { valueP: crP.toString(), value: formatEGP(crP) },
      prices: prices.map((p) => {
        // التكلفة = قاعدة عمولة المنطقة لو موجودة، وإلا الافتراضي العام
        const costP = p.cost_p != null ? BigInt(p.cost_p) : cP;
        const marginP = BigInt(p.price_p) - costP;
        const marginPct = BigInt(p.price_p) > 0n ? Math.round((Number(marginP) / Number(p.price_p)) * 1000) / 10 : 0;
        return {
          id: p.id, zone: p.zone, tier: p.tier,
          price: formatEGP(BigInt(p.price_p)), priceP: p.price_p,
          cost: formatEGP(costP), costP: costP.toString(),
          margin: formatEGP(marginP), marginP: marginP.toString(), marginPct,
        };
      }),
      fees: fees.map((f) => ({ id: f.id, code: f.code, nameAr: f.name_ar, calcType: f.calc_type, value: formatEGP(BigInt(f.value_p)), valueP: f.value_p, percentBp: f.percent_bp })),
    });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  kind: z.enum(["price", "fee", "commission", "commission_return"]),
  id: z.string().uuid().optional(),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/, "المبلغ لازم رقم"),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req, MANAGER);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);
    const { kind, id, value } = parsed.data;
    const p = poundsToPiastres(value);
    if (kind === "commission" || kind === "commission_return") {
      const key = kind === "commission"
        ? "commission.default_per_delivery_p"
        : "commission.default_per_return_p";
      await db.execute(sql`
        UPDATE settings SET value = ${sql.raw(`'${p.toString()}'::jsonb`)}, updated_at = now()
        WHERE key = ${key}`);
      return ok({ updated: true, value: formatEGP(p) });
    }
    if (!id) return fail("BAD_REQUEST", "معرّف ناقص", 400);
    if (kind === "price") {
      await db.execute(sql`UPDATE price_list_items SET price_p = ${p.toString()}::bigint WHERE id = ${id}::uuid`);
    } else {
      await db.execute(sql`UPDATE fee_definitions SET value_p = ${p.toString()}::bigint WHERE id = ${id}::uuid`);
    }
    return ok({ updated: true, value: formatEGP(p) });
  } catch (err) { return handleError(err); }
}
