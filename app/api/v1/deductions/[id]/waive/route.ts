/** POST /api/v1/deductions/:id/waive — إعفاء المندوب من الخصم (كتابة الخسارة). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { waiveDeduction } from "@/server/services/deduction";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const result = await db.transaction((tx) =>
      waiveDeduction(tx, {
        deductionId: id,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok({ status: result.status, amount: formatEGP(BigInt(result.amountP)) });
  } catch (err) {
    return handleError(err);
  }
}
