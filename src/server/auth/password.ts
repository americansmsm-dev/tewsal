/**
 * ============================================================
 *  التجزئة والتحقق من كلمة المرور — argon2id
 * ------------------------------------------------------------
 *  ⚠️ ده المكان **الوحيد** في السيستم اللي بيعمل hash لكلمة
 *     مرور أو يتحقق منها. أي مكان تاني ممنوع.
 *
 *  argon2id = الأقوى ضد الهجمات بكارت الشاشة (GPU) وضد
 *  الهجمات الجانبية. المعاملات متوازنة بين الأمان والسرعة
 *  على سيرفر مشترك.
 * ============================================================
 */
import { hash, verify } from "@node-rs/argon2";

// ⚠️ @node-rs/argon2 افتراضه Argon2id أصلًا — فمش بنمرّر
//    الـ algorithm صراحةً عشان const enum مبيشتغلش مع isolatedModules.
const OPTIONS = {
  memoryCost: 19456, // ~19 MB — توصية OWASP
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) {
    throw new Error("كلمة المرور لازم تكون ٨ حروف على الأقل");
  }
  return hash(plain, OPTIONS);
}

export interface PasswordCheck {
  /** الباسورد صح؟ */
  ok: boolean;
  /** الهاش المخزَّن نفسه تالف/بصيغة مش مفهومة (مشكلة سيرفر مش مستخدم) */
  hashError: boolean;
}

/**
 * التحقق التفصيلي من كلمة المرور.
 *
 * ⚠️ بيفرّق بين «الباسورد غلط» و«الهاش المخزَّن تالف». الاتنين
 *    بيرجّعوا فشل للمستخدم (مفيش تسريب معلومات)، بس السبب
 *    بيتسجّل في login_attempts عشان تعرف المشكلة فين — قبل كده
 *    الاتنين كانوا شكل واحد ومفيش أي أثر.
 */
export async function verifyPasswordDetailed(hashed: string, plain: string): Promise<PasswordCheck> {
  try {
    return { ok: await verify(hashed, plain), hashError: false };
  } catch {
    return { ok: false, hashError: true };
  }
}

/** التحقق البسيط — بيرجّع false لو الهاش تالف بدل ما يرمي. */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return (await verifyPasswordDetailed(hashed, plain)).ok;
}
