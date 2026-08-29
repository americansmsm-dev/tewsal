/** POST /api/v1/products/:id/stock — تعديل مخزون منتج (إضافة/خصم). */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { adjustStock } from "@/server/services/fulfillment";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const schema = z.object({ delta: z.number().int(), reason: z.string().max(40).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, OPS);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => adjustStock(tx, { productId: id, ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok(result);
  } catch (err) { return handleError(err); }
}
