/**
 * POST /api/v1/settlements/:id/pay — دفع التسوية.
 * بيكتب قيد التحويل ويعلّم الشحنات مسوّاة. لازم تكون معتمدة.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { z } from "zod";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { paySettlement } from "@/server/services/settlement";
import { notifySettlementPaid } from "@/server/services/inappNotify";
import { requirePermission } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const paySchema = z.object({
  method: z.enum(["bank", "vodafone_cash", "instapay", "cash"]),
  reference: z.string().max(120).optional(),
  /** رسم استلام كاش (٥٠ ج) بالجنيه — للطريقة cash */
  cashFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  /** رسم تسريع التحصيل/التحويل بالجنيه (اختياري، بطلب التاجر) */
  expediteFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  branchId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, "settlement.pay");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const raw = await req.json().catch(() => null);
    const parsed = paySchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction((tx) =>
      paySettlement(tx, {
        settlementId: id,
        actorUserId: ctx.user.userId,
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        cashFeeP: parsed.data.cashFee ? poundsToPiastres(parsed.data.cashFee) : undefined,
        expediteFeeP: parsed.data.expediteFee ? poundsToPiastres(parsed.data.expediteFee) : undefined,
        branchId: parsed.data.branchId ?? null,
      })
    );
    // إشعار داخلي للتاجر إن مستحقاته اتحوّلت — best-effort بعد الكوميت
    void (async () => {
      try {
        const r = await db.execute(sql`SELECT merchant_id::text AS mid, code, net_payable_p::text AS net FROM settlements WHERE id = ${id}::uuid`);
        const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { mid: string; code: string; net: string }[];
        const row = rows[0];
        if (row) await notifySettlementPaid(db, { settlementId: id, code: row.code, merchantId: row.mid, netAmount: formatEGP(BigInt(row.net)) });
      } catch { /* best-effort */ }
    })();

    return ok({ status: result.status, journalEntryNo: result.journalEntryNo.toString() });
  } catch (err) {
    return handleError(err);
  }
}
