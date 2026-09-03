/**
 * /api/v1/merchants/me — بيانات التاجر الداخل نفسه.
 *  GET   — بيرجّع بياناته وعنوان الاستلام المحفوظ.
 *  PATCH — التاجر يحفظ/يعدّل عنوان الاستلام بتاعه.
 *
 * التاجر بيكتب العنوان **مرة واحدة** وبيتحفظ على حسابه — وبعد كده
 * طلب الاستلام بياخده تلقائي، ويقدر يعدّله أي وقت.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MERCHANT = ["merchant"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole(req, MERCHANT);
    const mid = ctx.user.merchantId;
    if (!mid) return handleError(notFound("الحساب مش مربوط بتاجر"));
    const row = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id, code, name_ar, phone, email, tier, cod_enabled,
               default_shipping_payer, pickup_address
        FROM merchants WHERE id = ${mid}::uuid LIMIT 1
      `)
    )[0];
    if (!row) return handleError(notFound("التاجر مش موجود"));
    return ok({ merchant: row });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  pickupAddress: z.string().min(5, "العنوان لازم ٥ حروف على الأقل").max(500),
});

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole(req, MERCHANT);
    const mid = ctx.user.merchantId;
    if (!mid) return handleError(notFound("الحساب مش مربوط بتاجر"));
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);
    }
    const rows = await db.execute(sql`
      UPDATE merchants SET pickup_address = ${parsed.data.pickupAddress.trim()}, updated_at = now()
      WHERE id = ${mid}::uuid
      RETURNING pickup_address
    `);
    const r = rowsOf<{ pickup_address: string }>(rows)[0];
    if (!r) return handleError(notFound("التاجر مش موجود"));
    return ok({ pickupAddress: r.pickup_address, saved: true });
  } catch (err) {
    return handleError(err);
  }
}
