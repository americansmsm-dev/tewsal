/**
 * POST /api/v1/push/unsubscribe — إلغاء اشتراك جهاز.
 * المستخدم بيلغي **جهازه هو بس** — الحذف مقيّد بحسابه.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.object({ endpoint: z.string().url().max(2000) });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "endpoint ناقص", 400);

    await db.execute(sql`
      DELETE FROM push_subscriptions
      WHERE endpoint = ${parsed.data.endpoint} AND user_id = ${ctx.user.userId}::uuid
    `);
    return ok({ unsubscribed: true });
  } catch (err) {
    return handleError(err);
  }
}
