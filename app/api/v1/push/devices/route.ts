/**
 * GET /api/v1/push/devices — أجهزة المستخدم الحالي المشتركة.
 * DELETE ?id=… — شيل جهاز (الفون القديم مثلًا).
 *
 * المستخدم بيشوف ويشيل **أجهزته هو بس** — مفيش وصول لأجهزة حد تاني.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
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
    const devices = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id::text, device_label, user_agent, created_at, last_seen_at
        FROM push_subscriptions
        WHERE user_id = ${ctx.user.userId}::uuid
        ORDER BY last_seen_at DESC
      `)
    );
    return ok({ devices, count: devices.length });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    await db.execute(sql`
      DELETE FROM push_subscriptions
      WHERE id = ${id}::uuid AND user_id = ${ctx.user.userId}::uuid
    `);
    return ok({ removed: true });
  } catch (err) {
    return handleError(err);
  }
}
