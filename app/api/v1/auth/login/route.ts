/**
 * ============================================================
 *  POST /api/v1/auth/login — تسجيل الدخول
 * ------------------------------------------------------------
 *  argon2id + جلسة DB + كوكي HttpOnly.
 *
 *  حماية ضد التخمين: بعد ٥ محاولات فاشلة الحساب بيتقفل ١٥
 *  دقيقة. كل محاولة بتتسجّل في login_attempts للكشف.
 *
 *  ⚠️ الرسالة واحدة سواء المستخدم غلط أو الباسورد غلط —
 *     عشان محدش يعرف أسماء المستخدمين الصح بالتخمين.
 * ============================================================
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { checkTwoFactorAtLogin } from "@/server/services/security";
import { normalizeEgyptMobile } from "@/lib/phone";
import { clientIp } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const bodySchema = z.object({
  username: z.string().min(1, "اكتب اسم المستخدم"),
  password: z.string().min(1, "اكتب كلمة المرور"),
  code: z.string().max(6).optional(),
  deviceLabel: z.string().max(80).optional(),
});

const INVALID = () => fail("INVALID_CREDENTIALS", "اسم المستخدم أو كلمة المرور غلط", 401);

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    }
    // اسم المستخدم ممكن يبقى تليفون — نطبّعه لو كده
    const input = parsed.data.username.trim();
    const asPhone = normalizeEgyptMobile(input);
    const username = asPhone ?? input;

    const rows = await db.execute(sql`
      SELECT id, password_hash, role, is_active, failed_login_count, locked_until,
             must_change_password
      FROM users
      WHERE username = ${username} OR phone = ${username}
      LIMIT 1
    `);
    const user = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows)[0] as
      | {
          id: string;
          password_hash: string;
          role: string;
          is_active: boolean;
          failed_login_count: number;
          locked_until: string | null;
          must_change_password: boolean;
        }
      | undefined;

    async function recordAttempt(success: boolean, reason?: string) {
      await db.execute(sql`
        INSERT INTO login_attempts (username, ip, user_agent, success, failure_reason)
        VALUES (${username}, ${ip}, ${userAgent}, ${success}, ${reason ?? null})
      `);
    }

    if (!user || !user.is_active) {
      await recordAttempt(false, "unknown_or_inactive");
      return INVALID();
    }

    // مقفول؟
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await recordAttempt(false, "locked");
      return fail(
        "ACCOUNT_LOCKED",
        `الحساب مقفول مؤقتًا بسبب محاولات كتير — استنى ${LOCK_MINUTES} دقيقة`,
        429
      );
    }

    const okPassword = await verifyPassword(user.password_hash, parsed.data.password);
    if (!okPassword) {
      const failures = user.failed_login_count + 1;
      const lock = failures >= MAX_FAILURES;
      await db.execute(sql`
        UPDATE users SET
          failed_login_count = ${failures},
          locked_until = ${lock ? sql`now() + (${LOCK_MINUTES} * interval '1 minute')` : sql`locked_until`}
        WHERE id = ${user.id}::uuid
      `);
      await recordAttempt(false, "bad_password");
      return INVALID();
    }

    // ✅ الباسورد صح — نتحقق من المصادقة الثنائية لو مفعّلة
    const twoFa = await checkTwoFactorAtLogin(db, { userId: user.id, code: parsed.data.code });
    if (!twoFa.ok) {
      await recordAttempt(false, twoFa.needs2fa && parsed.data.code ? "bad_2fa" : "needs_2fa");
      return fail("NEEDS_2FA", parsed.data.code ? "كود المصادقة الثنائية غلط" : "محتاج كود المصادقة الثنائية", 401);
    }

    // ✅ نجح — نصفّر العداد ونعمل جلسة
    await db.execute(sql`
      UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
      WHERE id = ${user.id}::uuid
    `);
    const session = await createSession(
      db,
      { id: user.id, role: user.role },
      { ip, userAgent, deviceLabel: parsed.data.deviceLabel ?? null }
    );
    await recordAttempt(true);

    const res = ok({
      user: { role: user.role, mustChangePassword: user.must_change_password },
    });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}

// أي method تانية — 405
export function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "استخدم POST" } }, { status: 405 });
}
