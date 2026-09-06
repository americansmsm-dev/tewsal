/**
 * POST /api/v1/notifications/read — تعليم إشعار (أو الكل) مقروء.
 * body: { id } لواحد، أو { all: true } للكل. المستخدم بيعلّم بتوعه هو بس.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات غير صالحة", 400);
    const { id, all } = parsed.data;

    if (all) {
      await db.execute(sql`
        UPDATE notifications SET is_read = true
        WHERE user_id = ${ctx.user.userId}::uuid AND is_read = false
      `);
      return ok({ updated: "all" });
    }
    if (!id) return fail("BAD_REQUEST", "معرّف ناقص", 400);
    // المستخدم بيعلّم إشعاراته هو بس
    await db.execute(sql`
      UPDATE notifications SET is_read = true
      WHERE id = ${id}::uuid AND user_id = ${ctx.user.userId}::uuid
    `);
    return ok({ updated: id });
  } catch (err) {
    return handleError(err);
  }
}
