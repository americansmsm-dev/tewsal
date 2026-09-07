/**
 * POST /api/v1/push/subscribe — تسجيل جهاز لإشعارات الدفع.
 *
 * ⚠️ نفس المتصفح بيرجّع نفس الـendpoint كل مرة، فالتسجيل المتكرر
 *    **بيحدّث** الصف مش بيكرّره. ولو الجهاز اتنقل لمستخدم تاني
 *    (لاب مشترك في المكتب) الصف بيتحوّل للمستخدم الجديد — عشان
 *    ماتوصلش إشعارات الأول للتاني.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(5).max(500),
  }),
  deviceLabel: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات الاشتراك ناقصة", 400);
    const { endpoint, keys, deviceLabel } = parsed.data;

    const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;

    await db.execute(sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label)
      VALUES (${ctx.user.userId}::uuid, ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${ua}, ${deviceLabel ?? null})
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id      = EXCLUDED.user_id,
        p256dh       = EXCLUDED.p256dh,
        auth         = EXCLUDED.auth,
        user_agent   = EXCLUDED.user_agent,
        device_label = COALESCE(EXCLUDED.device_label, push_subscriptions.device_label),
        last_seen_at = now(),
        failed_at    = NULL
    `);

    return ok({ subscribed: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}
