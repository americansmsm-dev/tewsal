/** POST /api/v1/pickups/:id/assign — إسناد الاستلام لمندوب. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { assignPickup } from "@/server/services/pickup";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.object({ courierId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", "اختار مندوب", 400);

    const result = await db.transaction((tx) =>
      assignPickup(tx, {
        pickupId: id,
        courierId: parsed.data.courierId,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
