/** /api/v1/profile — بروفايل المستخدم الحالي: عرض وتعديل (عنوان/اسم). */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { isR2Configured, presignGet } from "@/lib/r2";
import { ROLE_LABELS_AR } from "@/server/db/schema/identity";
import { requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const [u] = rowsOf<{ full_name: string; role: string; phone: string | null; address: string | null; avatar_url: string | null }>(
      await db.execute(sql`SELECT full_name, role, phone, address, avatar_url FROM users WHERE id = ${ctx.user.userId}::uuid`)
    );
    if (!u) return fail("NOT_FOUND", "المستخدم مش موجود", 404);
    let avatarViewUrl: string | null = null;
    if (u.avatar_url && isR2Configured()) {
      try { avatarViewUrl = await presignGet(u.avatar_url); } catch { avatarViewUrl = null; }
    }
    return ok({
      fullName: u.full_name, role: u.role, roleLabel: ROLE_LABELS_AR[u.role as never] ?? u.role,
      phone: u.phone, address: u.address, avatarViewUrl,
    });
  } catch (err) { return handleError(err); }
}

const patchSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  address: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("BAD_REQUEST", "بيانات غير صالحة", 400);
    const { fullName, address } = parsed.data;
    await db.execute(sql`
      UPDATE users SET
        full_name = COALESCE(${fullName ?? null}, full_name),
        address   = ${address === undefined ? sql`address` : address},
        updated_at = now()
      WHERE id = ${ctx.user.userId}::uuid
    `);
    return ok({ updated: true });
  } catch (err) { return handleError(err); }
}
