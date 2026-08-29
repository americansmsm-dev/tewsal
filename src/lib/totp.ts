/**
 * ============================================================
 *  TOTP — المصادقة الثنائية (RFC 6238)
 * ------------------------------------------------------------
 *  تطبيق خفيف من غير مكتبات: سر Base32، كود ٦ أرقام كل ٣٠ ثانية،
 *  يتوافق مع Google Authenticator / Authy.
 * ============================================================
 */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(): string {
  const buf = randomBytes(20);
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** كود اللحظة الحالية (للاختبار/العرض). */
export function totpNow(secret: string, nowMs = Date.now()): string {
  return hotp(secret, Math.floor(nowMs / 30000));
}

/** التحقق من كود المستخدم مع نافذة ±خطوة (تسامح مع فرق الساعة). */
export function verifyTotp(secret: string, token: string, nowMs = Date.now()): boolean {
  const t = token.replace(/\D/g, "");
  if (t.length !== 6) return false;
  const counter = Math.floor(nowMs / 30000);
  for (let w = -1; w <= 1; w++) if (hotp(secret, counter + w) === t) return true;
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = "Tewsal"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
