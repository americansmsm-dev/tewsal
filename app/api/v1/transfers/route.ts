/** /api/v1/transfers — شيتات السفر. GET قائمة · POST إنشاء. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createTransfer, listTransfers } from "@/server/services/warehouse";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

export async function GET(req: NextRequest) {
  try { await requireRole(req, OPS); const transfers = await listTransfers(db); return ok({ transfers, count: transfers.length }); }
  catch (err) { return handleError(err); }
}

const schema = z.object({ fromBranchId: z.string().uuid().nullable().optional(), toBranchId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createTransfer(tx, { ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
