/**
 * ============================================================
 *  /api/v1/users — الفريق (موظفين ومناديب)
 * ------------------------------------------------------------
 *  POST: فتح حساب موظف/مندوب (الإدارة بس). بيرجّع باسورد
 *        مؤقت مرة واحدة — الموظف بيغيّره أول دخول.
 *  GET:  قائمة الفريق.
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { normalizeEgyptMobile } from "@/lib/phone";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";
import { USER_ROLES, ROLE_LABELS_AR } from "@/server/db/schema/identity";

export const dynamic = "force-dynamic";

const ADMIN = ["super_admin", "branch_manager"] as const;
// الإدارة مش بتفتح super_admin من الشاشة — بيتعمل بالبذور
const CREATABLE_ROLES = USER_ROLES.filter((r) => r !== "super_admin" && r !== "merchant");

const createSchema = z.object({
  fullName: z.string().min(2).max(120),
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.]+$/, "الحروف الإنجليزية والأرقام و _ . فقط"),
  phone: z.string().max(30).optional(),
  role: z.enum(CREATABLE_ROLES as unknown as [string, ...string[]]),
  /** المدير يقدر يحدّد الباسورد بنفسه — وإلا بيتولّد مؤقت */
  password: z.string().min(6).max(72).optional(),
});

/** باسورد مؤقت قوي وسهل القراءة */
function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, ADMIN);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const u = parsed.data;

    const phone = u.phone ? normalizeEgyptMobile(u.phone) : null;
    if (u.phone && !phone) return fail("BAD_PHONE", "رقم التليفون غير صالح", 400);

    // لو المدير حدّد الباسورد، بنستخدمه (وميضطرش يغيّره)؛ وإلا مؤقت
    const custom = !!u.password;
    const password = u.password ?? tempPassword();
    const passwordHash = await hashPassword(password);

    try {
      const rows = await db.execute(sql`
        INSERT INTO users (full_name, username, phone, password_hash, role, must_change_password)
        VALUES (${u.fullName}, ${u.username}, ${phone}, ${passwordHash}, ${u.role}, ${!custom})
        RETURNING id, full_name, username, role
      `);
      const created = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as {
        id: string;
        role: string;
      };
      // ⚠️ الباسورد بيترجع مرة واحدة بس — مبيتخزنش نص أبدًا
      return ok(
        { user: { ...created, roleLabel: ROLE_LABELS_AR[created.role as never] }, tempPassword: password },
        201
      );
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string };
      if (e?.code === "23505") {
        const c = e.constraint_name ?? "";
        if (c.includes("phone")) return fail("DUPLICATE_PHONE", "رقم التليفون مستخدم قبل كده", 409);
        return fail("DUPLICATE_USERNAME", "اسم المستخدم موجود قبل كده", 409);
      }
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    const rows = await db.execute(sql`
      SELECT id, full_name, username, phone, role, is_active, last_login_at, created_at
      FROM users
      WHERE role <> 'merchant'
        ${role ? sql`AND role = ${role}` : sql``}
      ORDER BY created_at DESC
    `);
    const list = (Array.isArray(rows) ? rows : (rows as { rows: Record<string, unknown>[] }).rows).map((u) => ({
      ...u,
      roleLabel: ROLE_LABELS_AR[(u as { role: string }).role as never] ?? (u as { role: string }).role,
    }));
    return ok({ users: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}
