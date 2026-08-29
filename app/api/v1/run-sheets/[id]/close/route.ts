/** POST /api/v1/run-sheets/:id/close — إغلاق الكشف: تتقيّد عمولة المندوب على المسلَّم. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { closeRunSheet } from "@/server/services/runSheet";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE_OPS = ["super_admin", "branch_manager", "ops", "accountant"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE_OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const result = await db.transaction((tx) =>
      closeRunSheet(tx, {
        runSheetId: id,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok({
      status: result.status,
      deliveredCount: result.deliveredCount,
      commission: formatEGP(result.commissionP),
      commissionP: result.commissionP.toString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
