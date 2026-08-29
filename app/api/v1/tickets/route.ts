/** /api/v1/tickets — التذاكر والشكاوى. GET قائمة · POST إنشاء. */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createTicket, listTickets } from "@/server/services/opsTools";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const STAFF = ["super_admin", "branch_manager", "ops", "accountant", "support"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, STAFF);
    const status = new URL(req.url).searchParams.get("status");
    const tickets = await listTickets(db, { status });
    return ok({ tickets, count: tickets.length });
  } catch (err) { return handleError(err); }
}

const schema = z.object({
  category: z.enum(["complaint", "request", "inquiry"]).optional(),
  subject: z.string().min(1).max(200),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  merchantId: z.string().uuid().nullable().optional(),
  shipmentId: z.string().uuid().nullable().optional(),
  customerPhone: z.string().max(20).nullable().optional(),
  body: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, STAFF);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const result = await db.transaction((tx) => createTicket(tx, { ...parsed.data, actor: { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName } }));
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
