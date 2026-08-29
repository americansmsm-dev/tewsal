/** POST /api/v1/claims/:id/resolve — اعتماد أو رفض مطالبة (اعتماد = تعويض). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { poundsToPiastres, formatEGP } from "@/lib/money";
import { resolveClaim } from "@/server/services/claim";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  overrideFragile: z.boolean().optional(),
  rejectReason: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const b = parsed.data;

    const result = await db.transaction((tx) =>
      resolveClaim(tx, {
        claimId: id,
        decision: b.decision,
        amountP: b.amount ? poundsToPiastres(b.amount) : null,
        overrideFragile: b.overrideFragile,
        rejectReason: b.rejectReason ?? null,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );

    return ok({
      status: result.status,
      approved: formatEGP(result.approvedAmountP),
      approvedP: result.approvedAmountP.toString(),
      posted: result.posted,
    });
  } catch (err) {
    return handleError(err);
  }
}
