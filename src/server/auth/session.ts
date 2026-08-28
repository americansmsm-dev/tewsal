/**
 * ============================================================
 *  الجلسات — جلسات قاعدة بيانات مش JWT
 * ------------------------------------------------------------
 *  ⚠️ ليه DB مش JWT؟ عشان نقدر **نلغي جلسة فورًا** (موظف
 *     مشي، موبايل اتسرق). JWT مبيتلغيش قبل ما ينتهي.
 *
 *  ⚠️ المخزّن في القاعدة هو **sha256(token)** مش التوكن نفسه.
 *     يعني حتى لو حد قرا جدول الجلسات، مش هيقدر ينتحل جلسة.
 *
 *  المندوب ليه جلسة ٩٠ يوم (بيشتغل أوفلاين طول اليوم)،
 *  والموظف ١٢ ساعة (على جهاز مشترك في المكتب).
 * ============================================================
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "../services/ledger";
import type { UserRole } from "../db/schema/identity";

/** مدة الجلسة بالأيام حسب الدور */
const SESSION_DAYS: Record<string, number> = {
  courier: 90, // المندوب أوفلاين طول اليوم
  merchant: 30,
  default: 1, // الموظفين على جهاز مشترك — ١٢–٢٤ ساعة
};

export const SESSION_COOKIE = "tewsal_session";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/** sha256 للتوكن — ده اللي بيتخزن، مش التوكن الخام */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  userId: string;
  role: UserRole;
  fullName: string;
  branchId: string | null;
  /** لو الدور تاجر — سجل التاجر المربوط (بوابة التاجر بتفلتر بيه) */
  merchantId: string | null;
  mustChangePassword: boolean;
  extraPermissions: string[];
  revokedPermissions: string[];
}

export interface CreatedSession {
  /** التوكن الخام — بيتحط في الكوكي وبيتنسى بعد كده */
  token: string;
  expiresAt: Date;
}

/**
 * إنشاء جلسة جديدة بعد نجاح الدخول.
 * بيرجّع التوكن الخام مرة واحدة — القاعدة بتخزّن الهاش بس.
 */
export async function createSession(
  ex: SqlExecutor,
  user: { id: string; role: string },
  ctx: { ip?: string | null; userAgent?: string | null; deviceLabel?: string | null } = {}
): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const days = SESSION_DAYS[user.role] ?? SESSION_DAYS.default!;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await ex.execute(sql`
    INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, device_label)
    VALUES (${id}, ${user.id}::uuid, ${expiresAt.toISOString()},
            ${ctx.ip ?? null}, ${ctx.userAgent ?? null}, ${ctx.deviceLabel ?? null})
  `);

  return { token, expiresAt };
}

/**
 * التحقق من جلسة من التوكن الخام.
 * بيرجّع بيانات المستخدم لو صالحة، وnull غير كده.
 * بيحدّث last_seen_at (مش على كل طلب — كل ٥ دقايق يكفي).
 */
export async function resolveSession(
  ex: SqlExecutor,
  token: string | undefined | null
): Promise<SessionUser | null> {
  if (!token) return null;
  const id = hashToken(token);

  const rows = rowsOf<{
    user_id: string;
    role: UserRole;
    full_name: string;
    branch_id: string | null;
    merchant_id: string | null;
    must_change_password: boolean;
    extra_permissions: string[];
    revoked_permissions: string[];
    is_active: boolean;
  }>(
    await ex.execute(sql`
      SELECT u.id AS user_id, u.role, u.full_name, u.branch_id, u.merchant_id,
             u.must_change_password, u.extra_permissions, u.revoked_permissions,
             u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ${id}
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1
    `)
  );
  const r = rows[0];
  if (!r || !r.is_active) return null;

  // تحديث آخر ظهور — بدون قفل، مش حرج لو فشل
  await ex.execute(sql`
    UPDATE sessions SET last_seen_at = now()
    WHERE id = ${id} AND last_seen_at < now() - interval '5 minutes'
  `);

  return {
    userId: r.user_id,
    role: r.role,
    fullName: r.full_name,
    branchId: r.branch_id,
    merchantId: r.merchant_id,
    mustChangePassword: r.must_change_password,
    extraPermissions: r.extra_permissions ?? [],
    revokedPermissions: r.revoked_permissions ?? [],
  };
}

/** إلغاء جلسة (تسجيل خروج) */
export async function revokeSession(ex: SqlExecutor, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await ex.execute(sql`
    UPDATE sessions SET revoked_at = now() WHERE id = ${hashToken(token)} AND revoked_at IS NULL
  `);
}
