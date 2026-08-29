/** /api/v1/tasks — التاسكات الداخلية. GET قائمة · POST إنشاء. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createTask, listTasks } from "@/server/services/opsTools";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const STAFF = ["super_admin", "branch_manager", "ops", "accountant", "support"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, STAFF);
    const status = new URL(req.url).searchParams.get("status");
    const tasks = await listTasks(db, { status });
    return ok({ tasks, count: tasks.length });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(),
  type: z.enum(["task", "followup", "call"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  shipmentId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, STAFF);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createTask(tx, { ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
