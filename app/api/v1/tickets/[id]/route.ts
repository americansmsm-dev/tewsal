/**
 * /api/v1/tickets/:id — GET سلسلة التذكرة · POST رسالة أو تحديث.
 * body: { action: 'message', body, isInternal? } | { action: 'update', status?, assignedTo?, priority? }
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { ticketThread, addTicketMessage, updateTicket } from "@/server/services/opsTools";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const STAFF = ["super_admin", "branch_manager", "ops", "accountant", "support"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, STAFF);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    return ok({ thread: await ticketThread(db, id) });
  } catch (err) { return handleError(err); }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), body: z.string().min(1).max(2000), isInternal: z.boolean().optional() }),
  z.object({ action: z.literal("update"), status: z.enum(["open", "pending", "resolved", "closed"]).optional(), assignedTo: z.string().uuid().nullable().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, STAFF);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const b = parsed.data;
    const actor = { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName };
    await db.transaction(async (tx) => {
      if (b.action === "message") await addTicketMessage(tx, { ticketId: id, body: b.body, isInternal: b.isInternal, actor });
      else await updateTicket(tx, { ticketId: id, status: b.status, assignedTo: b.assignedTo, priority: b.priority });
    });
    return ok({ ok: true });
  } catch (err) { return handleError(err); }
}
