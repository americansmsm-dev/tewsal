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

/**
 * التحقق من كلمة المرور.
 * بيرجّع false لو الهاش تالف بدل ما يرمي — عشان محاولة
 * دخول بهاش قديم متكسرش السيستم.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
