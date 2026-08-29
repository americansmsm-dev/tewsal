/** POST /api/v1/tasks/:id — تحديث حالة/إسناد تاسك. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { updateTask } from "@/server/services/opsTools";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const STAFF = ["super_admin", "branch_manager", "ops", "accountant", "support"] as const;

const schema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, STAFF);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => updateTask(tx, { taskId: id, ...parsed.data }));
    return ok(result);
  } catch (err) { return handleError(err); }
}
