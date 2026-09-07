/**
 * GET  /api/v1/notifications/prefs — الأحداث اللي المستخدم قافلها.
 * PATCH { event, channel, enabled } — يقفل/يفتح حدث على قناة.
 *
 * ⚠️ **غياب الصف = مفعّل.** بنكتب صف بس لما المستخدم يقفل حاجة،
 *    وبنمسحه لما يرجّعها. كده أي حدث جديد بيشتغل لوحده من غير ما
 *    نلمس صفوف قديمة، ومفيش جدول بيكبر على الفاضي.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const prefs = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT event, channel, enabled FROM notification_prefs
        WHERE user_id = ${ctx.user.userId}::uuid
      `)
    );
    return ok({ prefs, count: prefs.length });
  } catch (err) {
    return handleError(err);
  }
}

const schema = z.object({
  /** اسم الحدث أو '*' لكل الأحداث */
  event: z.string().min(1).max(80),
  channel: z.enum(["inapp", "push"]),
  enabled: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const { event, channel, enabled } = parsed.data;

    if (enabled) {
      // رجّع للافتراضي (مفعّل) = امسح الصف
      await db.execute(sql`
        DELETE FROM notification_prefs
        WHERE user_id = ${ctx.user.userId}::uuid AND event = ${event} AND channel = ${channel}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO notification_prefs (user_id, event, channel, enabled)
        VALUES (${ctx.user.userId}::uuid, ${event}, ${channel}, false)
        ON CONFLICT (user_id, event, channel) DO UPDATE SET enabled = false
      `);
    }
    return ok({ event, channel, enabled });
  } catch (err) {
    return handleError(err);
  }
}
