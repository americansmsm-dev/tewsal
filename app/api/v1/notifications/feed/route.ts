/**
 * GET /api/v1/notifications/feed — صندوق وارد المستخدم الحالي.
 * بيرجّع آخر الإشعارات + عدد غير المقروء. بيتنادى بالبولنج (~٢٠ث).
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 30), 100);

    const notifications = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id::text, event, title_ar, body_ar, entity_type, entity_id, is_read, created_at
        FROM notifications
        WHERE user_id = ${ctx.user.userId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      `)
    );
    const unread = rowsOf<{ n: number }>(
      await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM notifications
        WHERE user_id = ${ctx.user.userId}::uuid AND is_read = false
      `)
    )[0]?.n ?? 0;

    return ok({ notifications, unreadCount: unread });
  } catch (err) {
    return handleError(err);
  }
}
