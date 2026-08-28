/**
 * POST /api/v1/settlements/:id/pay — دفع التسوية.
 * بيكتب قيد التحويل ويعلّم الشحنات مسوّاة. لازم تكون معتمدة.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres } from "@/lib/money";
import { paySettlement } from "@/server/services/settlement";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

const paySchema = z.object({
  method: z.enum(["bank", "vodafone_cash", "instapay", "cash"]),
  reference: z.string().max(120).optional(),
  /** رسم استلام كاش (٥٠ ج) بالجنيه — للطريقة cash */
  cashFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  branchId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
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
        branchId: parsed.data.branchId ?? null,
      })
    );
    return ok({ status: result.status, journalEntryNo: result.journalEntryNo.toString() });
  } catch (err) {
    return handleError(err);
  }
}
