/** POST /api/v1/users/:id/password — المدير يعيّن باسورد جديد لمستخدم. */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const ADMIN = ["super_admin", "branch_manager"] as const;

const schema = z.object({ password: z.string().min(8).max(72) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, ADMIN);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "الباسورد لازم ٨ حروف على الأقل", 400);

    const hash = await hashPassword(parsed.data.password);
    const rows = await db.execute(sql`
      UPDATE users SET password_hash = ${hash}, must_change_password = false,
        failed_login_count = 0, locked_until = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND role <> 'super_admin'
      RETURNING id, username
    `);
    const r = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as { username: string } | undefined;
    if (!r) return handleError(notFound("المستخدم مش موجود"));
    return ok({ username: r.username, changed: true });
  } catch (err) {
    return handleError(err);
  }
}
