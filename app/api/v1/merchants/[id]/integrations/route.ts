/**
 * /api/v1/merchants/:id/integrations — توكنات الـ API والويب-هوك للتاجر.
 * GET: القائمة · POST: { action: 'token'|'webhook', ... }
 */
import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { createToken, listTokens, registerWebhook, listWebhooks } from "@/server/services/apiAccess";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, MGMT);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const [tokens, webhooks] = await Promise.all([listTokens(db, id), listWebhooks(db, id)]);
    return ok({ tokens, webhooks });
  } catch (err) { return handleError(err); }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("token"), name: z.string().min(1).max(60) }),
  z.object({ action: z.literal("webhook"), url: z.string().url(), events: z.string().max(200).optional() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, MGMT);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const b = parsed.data;
    let result: unknown;
    await db.transaction(async (tx) => {
      result = b.action === "token"
        ? await createToken(tx, { merchantId: id, name: b.name, actorUserId: ctx.user.userId })
        : await registerWebhook(tx, { merchantId: id, url: b.url, events: b.events });
    });
    return ok(result, 201);
  } catch (err) { return handleError(err); }
}
