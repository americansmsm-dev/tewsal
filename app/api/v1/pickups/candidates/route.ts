/**
 * GET /api/v1/pickups/candidates — بيغذّي شاشة «الاستلام الجماعي».
 *
 *  من غير merchantId → التجار اللي عندهم أوردرات مستنية الاستلام + عدد كل واحد
 *                       (عشان تعرف الشغل عند مين قبل ما تفتح).
 *  مع merchantId      → أوردرات التاجر الجاهزة للتجميع + بيانات التاجر
 *                       + عنوان الاستلام المحفوظ + الحد المجاني.
 *
 * ⚠️ الشحنة ما تدخلش في أكتر من استلام أبدًا (فهرس فريد عالمي على
 *    pickup_shipments.shipment_id). فالشحنات اللي دخلت استلام قبل كده
 *    بترجع في `blocked` مش في القايمة — عشان اختيارها كان هيفشّل الدفعة كلها.
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const OPS = ["super_admin", "branch_manager", "ops"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** الحد اللي فوقه الاستلام مجاني (إعداد pickup.free_threshold) */
async function freeThreshold(): Promise<number> {
  const v = rowsOf<{ value: unknown }>(
    await db.execute(sql`SELECT value FROM settings WHERE key = 'pickup.free_threshold' LIMIT 1`)
  )[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, OPS);
    const merchantId = new URL(req.url).searchParams.get("merchantId");
    const threshold = await freeThreshold();

    // ── قائمة التجار اللي عندهم شغل ──
    if (!merchantId) {
      const merchants = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT m.id, m.code, m.name_ar, m.pickup_address, COUNT(*)::int AS ready_count
          FROM shipments s
          JOIN merchants m ON m.id = s.merchant_id
          LEFT JOIN pickup_shipments ps ON ps.shipment_id = s.id
          WHERE s.status = 'awaiting_pickup' AND ps.id IS NULL
          GROUP BY m.id, m.code, m.name_ar, m.pickup_address
          ORDER BY COUNT(*) DESC, m.name_ar ASC
        `)
      );
      return ok({ merchants, freeThreshold: threshold });
    }

    if (!z.string().uuid().safeParse(merchantId).success) {
      return fail("BAD_REQUEST", "معرّف التاجر غير صالح", 400);
    }

    // ── أوردرات تاجر معيّن ──
    const merchant = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id, code, name_ar, phone, pickup_address
        FROM merchants WHERE id = ${merchantId}::uuid LIMIT 1
      `)
    )[0];
    if (!merchant) return fail("NOT_FOUND", "التاجر مش موجود", 404);

    const shipments = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.awb, s.recipient_name, s.cod_amount_p::text AS cod_amount_p,
               g.name_ar AS governorate, s.created_at
        FROM shipments s
        JOIN governorates g ON g.id = s.governorate_id
        LEFT JOIN pickup_shipments ps ON ps.shipment_id = s.id
        WHERE s.merchant_id = ${merchantId}::uuid
          AND s.status = 'awaiting_pickup' AND ps.id IS NULL
        ORDER BY s.created_at ASC
      `)
    );

    // شحنات مستنية بس داخلة استلام قديم — تتعرض للعلم بس مش قابلة للاختيار
    const blocked = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.awb, p.code AS pickup_code, p.status AS pickup_status
        FROM shipments s
        JOIN pickup_shipments ps ON ps.shipment_id = s.id
        JOIN pickups p ON p.id = ps.pickup_id
        WHERE s.merchant_id = ${merchantId}::uuid AND s.status = 'awaiting_pickup'
        ORDER BY s.created_at ASC
      `)
    );

    return ok({ merchant, shipments, blocked, freeThreshold: threshold });
  } catch (err) {
    return handleError(err);
  }
}
