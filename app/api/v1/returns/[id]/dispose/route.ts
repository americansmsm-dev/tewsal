/**
 * POST /api/v1/returns/:id/dispose — إتلاف مرتجع بعد المدة.
 * :id = معرّف الشحنة. مدير النظام بس. بيعدّي على البوابة
 * applyTransition (awaiting_return → disposed) وبيقيّد الشحن.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { disposeReturn } from "@/server/services/returns";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const ADMIN = ["super_admin"] as const;

const schema = z.object({
  reason: z.string().min(1).max(2000),
  overrideAge: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, ADMIN);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction((tx) =>
      disposeReturn(tx, {
        shipmentId: id,
        reason: parsed.data.reason,
        overrideAge: parsed.data.overrideAge,
        actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName },
      })
    );
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
