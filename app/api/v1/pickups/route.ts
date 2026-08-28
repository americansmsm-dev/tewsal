/**
 * /api/v1/pickups — طلبات الاستلام
 * POST: التاجر/العمليات يطلب استلام لشحنات في انتظار الاستلام
 * GET:  قائمة الطلبات
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { createPickup } from "@/server/services/pickup";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const CREATORS = ["super_admin", "branch_manager", "ops", "merchant"] as const;

const createSchema = z.object({
  merchantId: z.string().uuid(),
  shipmentIds: z.array(z.string().uuid()).min(1).max(500),
  pickupAddress: z.string().min(1).max(500),
  governorateId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  timeWindow: z.enum(["morning", "evening"]).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function pickupCode(seq: string): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  return `PU-${year}-${seq.padStart(6, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, CREATORS);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);

    const result = await db.transaction(async (tx) => {
      const seqR = await tx.execute(sql`SELECT nextval('awb_sequence')::text AS n`);
      const n = (Array.isArray(seqR) ? seqR : (seqR as { rows: { n: string }[] }).rows)[0] as { n: string };
      return createPickup(tx, { ...parsed.data, code: pickupCode(n.n), actorUserId: ctx.user.userId });
    });

    return ok(
      {
        pickupId: result.pickupId,
        code: result.code,
        ordersCount: result.ordersCount,
        serviceFee: formatEGP(result.serviceFeeP),
        serviceFeeP: result.serviceFeeP.toString(),
        status: result.status,
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const rows = await db.execute(sql`
      SELECT p.id, p.code, p.status, p.orders_count, p.service_fee_p::text, p.pickup_address,
             p.scheduled_date, p.time_window, p.created_at,
             m.name_ar AS merchant_name, m.code AS merchant_code,
             u.full_name AS courier_name
      FROM pickups p
      JOIN merchants m ON m.id = p.merchant_id
      LEFT JOIN users u ON u.id = p.courier_id
      WHERE 1=1 ${status ? sql`AND p.status = ${status}` : sql``}
      ORDER BY p.created_at DESC LIMIT ${limit}
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
    return ok({ pickups: list, count: list.length });
  } catch (err) {
    return handleError(err);
  }
}
