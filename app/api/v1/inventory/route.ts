/** /api/v1/inventory — الجرد. GET قائمة · POST فتح جرد لفرع. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createCount, listCounts } from "@/server/services/warehouse";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

export async function GET(req: NextRequest) {
  try { await requireRole(req, OPS); const counts = await listCounts(db); return ok({ counts, count: counts.length }); }
  catch (err) { return handleError(err); }
}

const schema = z.object({ branchId: z.string().uuid().nullable().optional() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات غير صالحة", 400);
    const result = await db.transaction((tx) => createCount(tx, { branchId: parsed.data.branchId, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
