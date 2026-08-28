/** GET /api/v1/couriers — المناديب النشطين (لإسناد الشحنات). */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const rows = await db.execute(sql`
      SELECT id, full_name, phone FROM users
      WHERE role = 'courier' AND is_active = true
      ORDER BY full_name ASC
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ couriers: list });
  } catch (err) {
    return handleError(err);
  }
}
