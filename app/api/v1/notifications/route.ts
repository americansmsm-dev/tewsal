/**
 * /api/v1/notifications — سجل الإشعارات + القوالب.
 * GET: { log, templates } · POST: تعديل قالب { id, bodyAr, isActive }.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { isWhatsappConfigured } from "@/lib/whatsapp";
import { listNotificationLog, listTemplates, updateTemplate } from "@/server/services/notifications";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant", "support"] as const;
const ADMIN = ["super_admin", "branch_manager"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, MGMT);
    const [log, templates] = await Promise.all([listNotificationLog(db), listTemplates(db)]);
    const rows = log.map((l) => ({ ...l, cost: formatEGP(BigInt((l.cost_p as string) || "0")) }));
    return ok({ log: rows, templates, whatsappLive: isWhatsappConfigured() });
  } catch (err) { return handleError(err); }
}

const schema = z.object({ id: z.string().uuid(), bodyAr: z.string().min(1).max(1000), isActive: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, ADMIN);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    return ok(await db.transaction((tx) => updateTemplate(tx, parsed.data)));
  } catch (err) { return handleError(err); }
}
