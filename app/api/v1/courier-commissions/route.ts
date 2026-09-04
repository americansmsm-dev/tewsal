/**
 * /api/v1/courier-commissions — محاسبة عمولات المناديب (قسم المحاسب).
 *
 *  GET  — من غير courierId: المناديب اللي عندهم أوردرات لسه ماتحاسبش عليها.
 *         مع courierId: أوردراته + المبلغ المقترح لكل أوردر.
 *  POST — المحاسب بيأكّد المبلغ (يقدر يعدّله) فيتسجّل القيد.
 *
 *  ⚠️ المبلغ **مبيتحسبش لوحده** — الاقتراح للعرض بس لحد ما المحاسب يأكّد.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { pendingOrders, couriersWithPending, suggestedRate, recordCommission } from "@/server/services/courierCommission";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
/** المحاسب والإدارة بس */
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

function commissionCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `CM-${year}-${seq.padStart(6, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, FINANCE);
    const courierId = new URL(req.url).searchParams.get("courierId");
    const rateP = await suggestedRate(db);

    if (!courierId) {
      const couriers = await couriersWithPending(db);
      return ok({ couriers, suggestedRateP: rateP.toString(), suggestedRate: formatEGP(rateP) });
    }
    if (!z.string().uuid().safeParse(courierId).success) {
      return fail("BAD_REQUEST", "معرّف المندوب غير صالح", 400);
    }
    const orders = await pendingOrders(db, courierId);
    return ok({
      orders,
      count: orders.length,
      suggestedRateP: rateP.toString(),
      suggestedRate: formatEGP(rateP),
      suggestedTotal: formatEGP(rateP * BigInt(orders.length)),
    });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  courierId: z.string().uuid(),
  shipmentIds: z.array(z.string().uuid()).min(1).max(1000),
  /** المبلغ لكل أوردر — المحاسب بيحدده (الاقتراح مجرد قيمة ابتدائية) */
  amountPerOrder: z.string().regex(/^\d+(\.\d{1,2})?$/, "المبلغ لازم رقم"),
  note: z.string().max(300).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const { courierId, shipmentIds, amountPerOrder, note } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
      return recordCommission(tx, {
        courierId, shipmentIds, amountPerOrderP: poundsToPiastres(amountPerOrder),
        note: note ?? null, code: commissionCode(n.n), actorUserId: ctx.user.userId,
      });
    });

    return ok({ id: result.id, code: result.code, count: result.count, total: formatEGP(result.totalP) }, 201);
  } catch (err) { return handleError(err); }
}
