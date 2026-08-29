/**
 * /api/v1/run-sheets — كشوف المناديب
 * POST: العمليات تفتح كشف تحميل لمندوب
 * GET:  قائمة الكشوف
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { createRunSheet } from "@/server/services/runSheet";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

const createSchema = z.object({
  courierId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function runSheetCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `RS-${year}-${seq.padStart(6, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction(async (tx) => {
      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
      return createRunSheet(tx, { ...parsed.data, code: runSheetCode(n.n), actorUserId: ctx.user.userId });
    });

    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const rows = await db.execute(sql`
      SELECT r.id, r.code, r.status, r.shipments_count, r.delivered_count,
             r.commission_p::text AS commission_p, r.created_at, r.dispatched_at, r.closed_at,
             u.full_name AS courier_name
      FROM run_sheets r
      LEFT JOIN users u ON u.id = r.courier_id
      WHERE 1=1 ${status ? sql`AND r.status = ${status}` : sql``}
      ORDER BY r.created_at DESC LIMIT ${limit}
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ runSheets: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}
