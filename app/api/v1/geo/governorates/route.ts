/**
 * GET /api/v1/geo/governorates — المحافظات المخدومة (للنماذج).
 */
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
      SELECT g.id, g.code, g.name_ar, g.zone_id, g.cod_enabled, g.is_served, z.name_ar AS zone
      FROM governorates g JOIN zones z ON z.id = g.zone_id
      WHERE g.is_served = true
      ORDER BY g.sort_order ASC
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ governorates: list });
  } catch (err) {
    return handleError(err);
  }
}
