/**
 * /api/v1/return-shelves — رفوف المرتجعات
 * GET:  قائمة الرفوف + عدد المرتجعات على كل رف
 * POST: إنشاء رف جديد (عمليات)
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { listShelves, createShelf } from "@/server/services/returns";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;
const OPS_FINANCE = ["super_admin", "branch_manager", "ops", "accountant"] as const;

const createSchema = z.object({
  code: z.string().min(1).max(30),
  nameAr: z.string().min(1).max(120),
  branchId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, OPS_FINANCE);
    const shelves = await listShelves(db);
    return ok({ shelves, count: shelves.length });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, OPS);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createShelf(tx, parsed.data));
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
