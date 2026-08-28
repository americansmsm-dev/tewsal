/**
 * POST /api/v1/settlements/:id/approve — اعتماد تسوية.
 * فوق الحد بيحتاج شخصين مختلفين (قرار ٦).
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { approveSettlement } from "@/server/services/settlement";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FINANCE = ["super_admin", "branch_manager", "accountant"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FINANCE);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    if (!ctx.user.userId) return fail("NO_USER", "الاعتماد محتاج مستخدم معروف", 422);

    const result = await db.transaction((tx) =>
      approveSettlement(tx, { settlementId: id, actorUserId: ctx.user.userId! })
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
