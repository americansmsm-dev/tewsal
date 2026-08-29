/** GET /api/v1/geo/zones — مناطق التسعير (لقوائم الأسعار الخاصة). */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { requireUser } from "@/server/http/context";
import { ok, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const rows = await db.execute(sql`SELECT id::text, name_ar, code FROM zones ORDER BY sort_order`);
    const zones = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ zones });
  } catch (err) {
    return handleError(err);
  }
}
