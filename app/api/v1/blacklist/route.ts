/**
 * /api/v1/blacklist — القائمة السوداء لأرقام العملاء
 * GET:  القائمة · POST: إضافة رقم
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { addBlacklist } from "@/server/services/crm";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops", "support"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, OPS);
    const rows = await db.execute(sql`
      SELECT b.phone, b.reason_ar, b.created_at, u.full_name AS added_by_name
      FROM customer_blacklist b LEFT JOIN users u ON u.id = b.added_by
      ORDER BY b.created_at DESC LIMIT 300
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ blacklist: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}

const schema = z.object({ phone: z.string().min(6).max(20), reason: z.string().min(1).max(300) });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, OPS);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) =>
      addBlacklist(tx, { phone: parsed.data.phone, reason: parsed.data.reason, actorUserId: ctx.user.userId })
    );
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
