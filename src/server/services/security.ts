/**
 * ============================================================
 *  الأمان — الصلاحيات + وضع الطوارئ + المصادقة الثنائية (مرحلة ط)
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { PERMISSIONS, type Permission } from "../domain/permissions";
import { generateSecret, verifyTotp, otpauthUri } from "@/lib/totp";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}
const VALID = new Set<string>(PERMISSIONS as readonly string[]);

// ---------------------------------------------------------------
// الصلاحيات
// ---------------------------------------------------------------

export async function setUserPermissions(
  ex: SqlExecutor,
  input: { userId: string; extra?: string[]; revoked?: string[] }
): Promise<{ ok: boolean }> {
  const extra = (input.extra ?? []).filter((p) => VALID.has(p));
  const revoked = (input.revoked ?? []).filter((p) => VALID.has(p));
  const u = rowsOf<{ id: string }>(await ex.execute(sql`SELECT id FROM users WHERE id = ${input.userId}::uuid`))[0];
  if (!u) throw new HttpError(404, "NOT_FOUND", "المستخدم مش موجود");
  // القيم من قائمة بيضاء (VALID) فبناء المصفوفة آمن
  const arrLit = (a: string[]) => (a.length ? `ARRAY[${a.map((p) => `'${p}'`).join(",")}]::text[]` : `ARRAY[]::text[]`);
  await ex.execute(sql`
    UPDATE users SET extra_permissions = ${sql.raw(arrLit(extra))}, revoked_permissions = ${sql.raw(arrLit(revoked))}
    WHERE id = ${input.userId}::uuid`);
  return { ok: true };
}

// ---------------------------------------------------------------
// وضع الطوارئ
// ---------------------------------------------------------------

export async function setEmergencyFreeze(ex: SqlExecutor, on: boolean): Promise<{ frozen: boolean }> {
  await ex.execute(sql`
    INSERT INTO settings (key, value, name_ar, category, value_type)
    VALUES ('emergency.freeze_settlements', ${sql.raw(on ? "'true'::jsonb" : "'false'::jsonb")}, 'وضع الطوارئ — تجميد دفع التسويات', 'security', 'boolean')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return { frozen: on };
}

export async function emergencyState(ex: SqlExecutor): Promise<boolean> {
  const v = rowsOf<{ value: unknown }>(await ex.execute(sql`SELECT value FROM settings WHERE key = 'emergency.freeze_settlements' LIMIT 1`))[0]?.value;
  return v === true || v === "true";
}

// ---------------------------------------------------------------
// المصادقة الثنائية (2FA)
// ---------------------------------------------------------------

/** توليد سر جديد (لسه مش مفعّل) + رابط للـ QR. */
export async function setupTwoFactor(ex: SqlExecutor, input: { userId: string; username: string }): Promise<{ secret: string; uri: string }> {
  const secret = generateSecret();
  await ex.execute(sql`UPDATE users SET two_factor_secret = ${secret}, two_factor_enabled_at = NULL WHERE id = ${input.userId}::uuid`);
  return { secret, uri: otpauthUri(secret, input.username) };
}

/** تفعيل الـ 2FA بعد التحقق من أول كود. */
export async function enableTwoFactor(ex: SqlExecutor, input: { userId: string; code: string }): Promise<{ enabled: boolean }> {
  const u = rowsOf<{ secret: string | null }>(await ex.execute(sql`SELECT two_factor_secret AS secret FROM users WHERE id = ${input.userId}::uuid`))[0];
  if (!u?.secret) throw new HttpError(422, "NO_SETUP", "ابدأ الإعداد الأول");
  if (!verifyTotp(u.secret, input.code)) throw new HttpError(422, "BAD_CODE", "الكود غلط");
  await ex.execute(sql`UPDATE users SET two_factor_enabled_at = now() WHERE id = ${input.userId}::uuid`);
  return { enabled: true };
}

export async function disableTwoFactor(ex: SqlExecutor, userId: string): Promise<{ disabled: boolean }> {
  await ex.execute(sql`UPDATE users SET two_factor_secret = NULL, two_factor_enabled_at = NULL WHERE id = ${userId}::uuid`);
  return { disabled: true };
}

/** التحقق وقت الدخول (لو المستخدم مفعّل الـ 2FA). */
export async function checkTwoFactorAtLogin(ex: SqlExecutor, input: { userId: string; code?: string }): Promise<{ ok: boolean; needs2fa: boolean }> {
  const u = rowsOf<{ secret: string | null; enabled: string | null }>(
    await ex.execute(sql`SELECT two_factor_secret AS secret, two_factor_enabled_at AS enabled FROM users WHERE id = ${input.userId}::uuid`)
  )[0];
  if (!u?.secret || !u.enabled) return { ok: true, needs2fa: false };
  if (!input.code) return { ok: false, needs2fa: true };
  return { ok: verifyTotp(u.secret, input.code), needs2fa: true };
}
