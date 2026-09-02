/**
 * ============================================================
 *  /api/v1/shipments — الشحنات
 * ------------------------------------------------------------
 *  POST: إنشاء شحنة (السعر بيتثبّت مرة واحدة)
 *  GET:  قائمة الشحنات بفلاتر + ترقيم بالمؤشر (cursor)
 * ============================================================
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { formatEGP } from "@/lib/money";
import { SHIPMENT_STATUSES } from "@/server/domain/statusMachine";
import { createShipment } from "@/server/services/createShipment";
import { requireRole, requireUser } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const CREATORS = ["super_admin", "branch_manager", "ops", "merchant"] as const;

const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "مبلغ غير صالح");

const createSchema = z.object({
  merchantId: z.string().uuid(),
  recipientName: z.string().min(1).max(200),
  recipientPhone: z.string().min(1).max(30),
  recipientPhoneAlt: z.string().max(30).nullable().optional(),
  governorateId: z.string().uuid(),
  areaId: z.string().uuid().nullable().optional(),
  addressLine: z.string().min(1).max(500),
  landmark: z.string().max(200).nullable().optional(),
  codAmount: moneyString.optional(),
  paymentMethod: z.string().max(30).optional(),
  shippingPayer: z.enum(["merchant", "customer", "split"]).optional(),
  declaredValue: moneyString.optional(),
  piecesCount: z.number().int().positive().max(1000).optional(),
  weightKg: z.number().positive().max(10000).nullable().optional(),
  isFragile: z.boolean().optional(),
  fragileInsured: z.boolean().optional(),
  serviceType: z.string().max(30).optional(),
  merchantReference: z.string().max(120).nullable().optional(),
  notesToCourier: z.string().max(1000).nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  productQty: z.number().int().positive().optional(),
  // قطع الأوردر — للتسليم الجزئي بالقطعة (التحصيل = مجموع أسعارها)
  items: z.array(z.object({
    nameAr: z.string().min(1).max(160),
    sku: z.string().max(60).nullable().optional(),
    qty: z.number().int().positive().max(1000).optional(),
    price: moneyString,
  })).max(50).optional(),
  confirm: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole(req, CREATORS);
    const raw = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    }

    const result = await db.transaction((tx) =>
      createShipment(tx, parsed.data, {
        userId: ctx.user.userId,
        role: ctx.user.role,
        name: ctx.user.fullName,
      })
    );

    return ok(
      {
        id: result.id,
        awb: result.awb,
        status: result.status,
        tier: result.tier,
        price: formatEGP(result.priceP),
        totalFees: formatEGP(result.totalFeesP),
        merchantNet: formatEGP(result.merchantNetP),
        priceP: result.priceP.toString(),
        totalFeesP: result.totalFeesP.toString(),
        merchantNetP: result.merchantNetP.toString(),
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser(req);
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status"); // حالة واحدة أو أكتر مفصولة بفاصلة
    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const merchantId = url.searchParams.get("merchantId");
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const cursor = url.searchParams.get("cursor"); // created_at ISO للصفحة الجاية

    if (statuses.some((s) => !(SHIPMENT_STATUSES as readonly string[]).includes(s))) {
      return fail("BAD_REQUEST", "حالة غير معروفة", 400);
    }

    // التاجر بيشوف شحناته هو بس · المندوب بيشوف اللي معاه بس
    const roleScope =
      ctx.user.role === "merchant" && ctx.user.merchantId
        ? sql`AND s.merchant_id = ${ctx.user.merchantId}::uuid`
        : ctx.user.role === "courier"
          ? sql`AND s.current_courier_id = ${ctx.user.userId}::uuid`
          : sql``;

    const rows = await db.execute(sql`
      SELECT s.id, s.awb, s.status, s.recipient_name, s.recipient_phone,
             s.cod_amount_p::text, s.price_p::text, s.total_fees_p::text,
             s.address_line, s.landmark, s.current_courier_id,
             s.created_at, g.name_ar AS governorate, m.name_ar AS merchant_name,
             cu.full_name AS courier_name
      FROM shipments s
      JOIN governorates g ON g.id = s.governorate_id
      JOIN merchants m ON m.id = s.merchant_id
      LEFT JOIN users cu ON cu.id = s.current_courier_id
      WHERE 1=1
        ${statuses.length ? sql`AND s.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``}
        ${merchantId ? sql`AND s.merchant_id = ${merchantId}::uuid` : sql``}
        ${q ? sql`AND (s.awb ILIKE ${"%" + q + "%"} OR s.recipient_name ILIKE ${"%" + q + "%"} OR s.recipient_phone ILIKE ${"%" + q + "%"})` : sql``}
        ${cursor ? sql`AND s.created_at < ${cursor}` : sql``}
        ${roleScope}
      ORDER BY s.created_at DESC
      LIMIT ${limit}
    `);
    const list = (Array.isArray(rows) ? rows : (rows as { rows: Record<string, unknown>[] }).rows) as Record<string, unknown>[];
    const nextCursor = list.length === limit ? list[list.length - 1]?.created_at : null;

    return ok({ shipments: list, count: list.length, nextCursor });
  } catch (err) {
    return handleError(err);
  }
}
