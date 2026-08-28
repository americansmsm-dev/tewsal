/** POST /api/v1/pickups/:id/confirm — المندوب/العمليات يأكّد الاستلام. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { confirmPickup } from "@/server/services/pickup";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const FIELD = ["super_admin", "branch_manager", "ops", "courier"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, FIELD);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const result = await db.transaction((tx) =>
      confirmPickup(tx, {
        pickupId: id,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
