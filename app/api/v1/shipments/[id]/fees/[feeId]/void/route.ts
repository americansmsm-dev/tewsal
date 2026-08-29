/**
 * POST /api/v1/shipments/:id/fees/:feeId/void — إلغاء رسم يدوي.
 * بيتلغي بـ voided_at (مش حذف). محتاج سبب.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { voidManualFee } from "@/server/services/shipmentFee";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS_FINANCE = ["super_admin", "branch_manager", "ops", "accountant"] as const;

const schema = z.object({ reason: z.string().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; feeId: string }> }) {
  try {
    const ctx = await requireRole(req, OPS_FINANCE);
    const { feeId } = await params;
    if (!z.string().uuid().safeParse(feeId).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction((tx) =>
      voidManualFee(tx, { feeId, reason: parsed.data.reason, actorUserId: ctx.user.userId })
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
