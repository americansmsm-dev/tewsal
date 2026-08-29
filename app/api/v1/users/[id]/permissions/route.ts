/**
 * /api/v1/users/:id/permissions — الصلاحيات الدقيقة للمستخدم.
 * GET: الكتالوج + الحالي · POST: { extra[], revoked[] }
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { PERMISSIONS, PERMISSION_LABELS_AR } from "@/server/domain/permissions";
import { setUserPermissions } from "@/server/services/security";
import { requirePermission } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(req, "user.manage");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const u = rowsOf<{ role: string; extra: string[]; revoked: string[] }>(
      await db.execute(sql`SELECT role, extra_permissions AS extra, revoked_permissions AS revoked FROM users WHERE id = ${id}::uuid`)
    )[0];
    if (!u) return fail("NOT_FOUND", "المستخدم مش موجود", 404);
    return ok({ role: u.role, extra: u.extra ?? [], revoked: u.revoked ?? [], catalog: PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS_AR[p] })) });
  } catch (err) { return handleError(err); }
}

const schema = z.object({ extra: z.array(z.string()).max(30).optional(), revoked: z.array(z.string()).max(30).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(req, "user.manage");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات ناقصة", 400);
    return ok(await db.transaction((tx) => setUserPermissions(tx, { userId: id, ...parsed.data })));
  } catch (err) { return handleError(err); }
}
