/** /api/v1/branches — الفروع. GET (بأرصدة الخزنة) · POST إنشاء فرع. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { listBranches, createBranch } from "@/server/services/warehouse";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const VIEW = ["super_admin", "branch_manager", "ops", "accountant"] as const;
const ADMIN = ["super_admin", "branch_manager"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, VIEW);
    const rows = await listBranches(db);
    const branches = rows.map((b) => ({ ...b, cash: formatEGP(BigInt((b.cash_p as string) || "0")) }));
    return ok({ branches, count: branches.length });
  } catch (err) { return handleError(err); }
}

const schema = z.object({ code: z.string().min(1).max(20), nameAr: z.string().min(1).max(120), governorateId: z.string().uuid().nullable().optional(), phone: z.string().max(20).nullable().optional() });

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, ADMIN);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createBranch(tx, parsed.data));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
