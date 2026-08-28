/** GET /api/v1/reason-codes — أسباب التعذّر (لنموذج التسليم المتعذّر). */
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
      SELECT code, name_ar, requires_note, requires_photo, counts_as_attempt
      FROM shipment_reason_codes WHERE is_active = true ORDER BY sort_order ASC
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ reasonCodes: list });
  } catch (err) {
    return handleError(err);
  }
}
