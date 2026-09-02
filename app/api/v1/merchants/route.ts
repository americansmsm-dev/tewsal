/**
 * ============================================================
 *  /api/v1/merchants — التجار
 * ------------------------------------------------------------
 *  POST: فتح حساب تاجر (الإدارة بس — مفيش تسجيل ذاتي)
 *  GET:  قائمة التجار
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { normalizeEgyptMobile } from "@/lib/phone";
import { hashPassword } from "@/server/auth/password";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const ADMIN = ["super_admin", "branch_manager"] as const;

const createSchema = z.object({
  code: z.string().min(1, "اكتب كود التاجر").max(40),
  nameAr: z.string().min(1, "اكتب اسم التاجر").max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email("إيميل غير صالح").max(200).optional(),
  tier: z.enum(["t1", "t2", "t3"]).optional(),
  codEnabled: z.boolean().optional(),
  defaultShippingPayer: z.enum(["merchant", "customer"]).optional(),
  notes: z.string().max(1000).optional(),
  /** اختياري: افتح حساب دخول للتاجر على البوابة */
  loginUsername: z.string()
    .min(3, "اسم الدخول ٣ حروف على الأقل")
    .max(40)
    .regex(/^[a-zA-Z0-9_.]+$/, "اسم الدخول: حروف إنجليزية وأرقام و _ . بس (من غير مسافات أو عربي)")
    .optional(),
  /** اختياري: الباسورد اللي الأدمن بيكتبه — وإلا بيتولّد مؤقت */
  loginPassword: z.string().min(6, "الباسورد ٦ حروف على الأقل").max(72).optional(),
});

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, ADMIN);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    }
    const m = parsed.data;
    const phone = m.phone ? normalizeEgyptMobile(m.phone) : null;
    if (m.phone && !phone) return fail("BAD_PHONE", "رقم التليفون غير صالح", 400);

    try {
      const result = await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
          INSERT INTO merchants (code, name_ar, phone, email, tier, cod_enabled, default_shipping_payer, notes, created_by_user_id)
          VALUES (${m.code}, ${m.nameAr}, ${phone}, ${m.email ?? null},
                  ${m.tier ?? "t1"}, ${m.codEnabled ?? true},
                  ${m.defaultShippingPayer ?? "merchant"}, ${m.notes ?? null}, ${ctx.user.userId}::uuid)
          RETURNING id, code, name_ar, tier
        `);
        const merchant = (Array.isArray(rows) ? rows : (rows as { rows: { id: string }[] }).rows)[0] as {
          id: string;
        };

        // اختياري: حساب دخول للتاجر على البوابة
        let login: { username: string; tempPassword: string; custom: boolean } | null = null;
        if (m.loginUsername) {
          const custom = !!m.loginPassword;
          const pw = m.loginPassword ?? tempPassword();
          const hash = await hashPassword(pw);
          await tx.execute(sql`
            INSERT INTO users (full_name, username, phone, password_hash, role, merchant_id, must_change_password)
            VALUES (${m.nameAr}, ${m.loginUsername}, ${phone}, ${hash}, 'merchant', ${merchant.id}::uuid, ${!custom})
          `);
          login = { username: m.loginUsername, tempPassword: pw, custom };
        }
        return { merchant, login };
      });
      return ok({ merchant: result.merchant, login: result.login }, 201);
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string };
      if (e?.code === "23505") {
        const c = e.constraint_name ?? "";
        if (c.includes("users_username")) return fail("DUPLICATE_USERNAME", "اسم دخول التاجر موجود قبل كده", 409);
        return fail("DUPLICATE_CODE", "كود التاجر ده موجود قبل كده", 409);
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
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    const rows = await db.execute(sql`
      SELECT id, code, name_ar, phone, tier, cod_enabled, is_active, created_at
      FROM merchants
      ${q ? sql`WHERE name_ar ILIKE ${"%" + q + "%"} OR code ILIKE ${"%" + q + "%"} OR phone ILIKE ${"%" + q + "%"}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ merchants: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}
