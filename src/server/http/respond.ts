/**
 * ============================================================
 *  ردود HTTP موحّدة + ترجمة أخطاء الدومين
 * ------------------------------------------------------------
 *  كل الأخطاء بترجع بالعربي بشكل موحّد:
 *    { error: { code, message } }
 *
 *  أخطاء الدومين (TransitionError) ليها أكواد، والملف ده
 *  بيترجمها لأكواد HTTP الصح — عشان الواجهة تتصرف مظبوط:
 *  409 = تعارض (حدّث وحاول)، 403 = مش مسموح، 422 = ناقص...
 * ============================================================
 */
import { NextResponse } from "next/server";
import { TransitionError, type TransitionErrorCode } from "../services/transition";

/** كود الخطأ → كود HTTP */
const STATUS_OF: Record<TransitionErrorCode, number> = {
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  STATUS_CONFLICT: 409,
  REASSIGNED: 409,
  AMOUNT_MISMATCH: 409,
  NOT_ALLOWED: 403,
  FINANCIAL_REQUIRED: 422,
  FINANCIAL_UNEXPECTED: 422,
  BAD_INPUT: 400,
};

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * تحويل أي خطأ لرد HTTP مناسب.
 * ⚠️ مبنكشفش تفاصيل الأخطاء غير المتوقعة للعميل — بنسجّلها
 *    ونرجّع رسالة عامة، عشان منسربش معلومات عن السيستم.
 */
export function handleError(err: unknown, requestId?: string): NextResponse {
  if (err instanceof TransitionError) {
    return fail(err.code, err.message, STATUS_OF[err.code] ?? 400);
  }
  if (err instanceof HttpError) {
    return fail(err.code, err.message, err.status);
  }
  // خطأ غير متوقع — سجّله ورجّع عام
  console.error(`[${requestId ?? "-"}] خطأ غير متوقع:`, err);
  return fail("INTERNAL", "حصل خطأ في السيرفر — حاول تاني", 500);
}

/** خطأ HTTP صريح للاستخدام في المسارات (مصادقة، صلاحيات، تحقق) */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (msg = "لازم تسجّل دخول") => new HttpError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "مالكش صلاحية للإجراء ده") => new HttpError(403, "FORBIDDEN", msg);
export const badRequest = (msg: string) => new HttpError(400, "BAD_REQUEST", msg);
export const notFound = (msg = "مش موجود") => new HttpError(404, "NOT_FOUND", msg);
