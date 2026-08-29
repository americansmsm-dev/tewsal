/**
 * ============================================================
 *  سياق الطلب — مين بيطلب، من فين
 * ------------------------------------------------------------
 *  بيقرا الجلسة من الكوكي ويرجّع المستخدم، أو بيرمي 401.
 *  وبيجمّع الـ IP والـ user-agent و request-id للتدقيق.
 * ============================================================
 */
import type { NextRequest } from "next/server";
import { db } from "../db";
import { resolveSession, SESSION_COOKIE, type SessionUser } from "../auth/session";
import { hasPermission, PERMISSION_LABELS_AR, type Permission } from "../domain/permissions";
import { unauthorized, forbidden } from "./respond";

export interface RequestContext {
  user: SessionUser;
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/** الـ IP الحقيقي من ورا Cloudflare/بروكسي */
export function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

/** معرّف طلب للتتبع في السجلات (بيتولّد لو مش موجود) */
export function requestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

/**
 * التأكد إن الطلب من مستخدم مسجّل دخول.
 * ⚠️ بيرمي 401 لو مفيش جلسة صالحة — المسار مبيكملش.
 */
export async function requireUser(req: NextRequest): Promise<RequestContext> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await resolveSession(db, token);
  if (!user) throw unauthorized();
  return {
    user,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    requestId: requestId(req),
  };
}

/**
 * التأكد إن المستخدم من دور مسموح له.
 * ⚠️ التحقق على السيرفر دايمًا — مش على الواجهة.
 */
export async function requireRole(
  req: NextRequest,
  roles: readonly string[]
): Promise<RequestContext> {
  const ctx = await requireUser(req);
  if (!roles.includes(ctx.user.role)) {
    throw forbidden(`الإجراء ده متاح لـ: ${roles.join("، ")}`);
  }
  return ctx;
}

/**
 * التأكد إن المستخدم عنده صلاحية دقيقة معيّنة (فوق الدور).
 * بيرمي 403 لو مسحوبة منه أو مش من صلاحيات دوره.
 */
export async function requirePermission(
  req: NextRequest,
  perm: Permission
): Promise<RequestContext> {
  const ctx = await requireUser(req);
  if (!hasPermission(ctx.user, perm)) {
    throw forbidden(`مالكش صلاحية «${PERMISSION_LABELS_AR[perm]}»`);
  }
  return ctx;
}
