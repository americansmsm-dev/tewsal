/** PATCH /api/v1/users/:id — المدير يغيّر اسم الدخول (أو الاسم/التليفون). */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { normalizeEgyptMobile } from "@/lib/phone";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError, notFound } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const ADMIN = ["super_admin", "branch_manager"] as const;

const schema = z.object({
  username: z.string().min(3, "اسم الدخول ٣ حروف على الأقل").max(40)
    .regex(/^[a-zA-Z0-9_.]+$/, "اسم الدخول: حروف إنجليزي وأرقام و _ . بس").optional(),
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, ADMIN);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);
    const { username, fullName, phone } = parsed.data;
    const normPhone = phone ? normalizeEgyptMobile(phone) : phone === null ? null : undefined;
    if (phone && !normPhone) return fail("BAD_PHONE", "رقم التليفون غير صالح", 400);

    try {
      const rows = await db.execute(sql`
        UPDATE users SET
          username = COALESCE(${username ?? null}, username),
          full_name = COALESCE(${fullName ?? null}, full_name),
          phone = ${normPhone === undefined ? sql`phone` : normPhone},
          updated_at = now()
        WHERE id = ${id}::uuid AND role <> 'super_admin'
        RETURNING id, username
      `);
      const r = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as { username: string } | undefined;
      if (!r) return handleError(notFound("المستخدم مش موجود"));
      return ok({ username: r.username, updated: true });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "23505") return fail("DUPLICATE", "اسم الدخول أو التليفون مستخدم قبل كده", 409);
      throw err;
    }
  } catch (err) { return handleError(err); }
}
