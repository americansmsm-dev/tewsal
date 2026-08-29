/**
 * /api/v1/merchants/:id/crm — بيانات CRM للتاجر
 * GET:  الحقول + النقاط + العناوين + الأسعار الخاصة + حركة النقاط
 * POST: { action: 'update' | 'points' | 'address' | 'override', ... }
 */
import { type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  updateMerchantCrm, awardPoints, addPickupAddress, addPriceOverride,
  listPickupAddresses, listPriceOverrides,
} from "@/server/services/crm";
import { requireRole } from "@/server/http/context";
import { ok, fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const MGMT = ["super_admin", "branch_manager", "accountant"] as const;

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, MGMT);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);

    const merchant = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        SELECT m.id::text, m.name_ar, m.product_type, m.allowed_weight_kg, m.points::text AS points, m.flyer_balance,
               m.sales_rep_id::text, m.cs_rep_id::text,
               s.full_name AS sales_rep_name, c.full_name AS cs_rep_name
        FROM merchants m
        LEFT JOIN users s ON s.id = m.sales_rep_id
        LEFT JOIN users c ON c.id = m.cs_rep_id
        WHERE m.id = ${id}::uuid`)
    )[0];
    if (!merchant) return fail("NOT_FOUND", "التاجر مش موجود", 404);

    const [addresses, overrides, events, staff] = await Promise.all([
      listPickupAddresses(db, id),
      listPriceOverrides(db, id),
      db.execute(sql`SELECT delta::text, balance_after::text, reason_ar, created_at FROM merchant_point_events WHERE merchant_id = ${id}::uuid ORDER BY created_at DESC LIMIT 20`),
      db.execute(sql`SELECT id::text, full_name FROM users WHERE role IN ('super_admin','branch_manager','ops','support') AND is_active = true ORDER BY full_name`),
    ]);
    return ok({
      merchant, addresses, overrides,
      pointEvents: Array.isArray(events) ? events : (events as { rows: unknown[] }).rows,
      staff: Array.isArray(staff) ? staff : (staff as { rows: unknown[] }).rows,
    });
  } catch (err) {
    return handleError(err);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    salesRepId: z.string().uuid().nullable().optional(),
    csRepId: z.string().uuid().nullable().optional(),
    productType: z.string().max(80).nullable().optional(),
    allowedWeightKg: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  }),
  z.object({ action: z.literal("points"), delta: z.number().int(), reason: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("address"), label: z.string().min(1).max(80), address: z.string().min(1).max(300),
    governorateId: z.string().uuid().nullable().optional(), phone: z.string().max(20).nullable().optional(), isDefault: z.boolean().optional(),
  }),
  z.object({ action: z.literal("override"), zoneId: z.string().uuid(), tier: z.string().nullable(), price: z.string().regex(/^\d+(\.\d{1,2})?$/) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole(req, MGMT);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail("BAD_REQUEST", "معرّف غير صالح", 400);
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "بيانات ناقصة", 400);
    const b = parsed.data;
    const actor = { userId: ctx.user.userId, role: ctx.user.role, name: ctx.user.fullName };

    const result = await db.transaction(async (tx) => {
      if (b.action === "update") return updateMerchantCrm(tx, { merchantId: id, ...b });
      if (b.action === "points") return awardPoints(tx, { merchantId: id, delta: b.delta, reason: b.reason, actor });
      if (b.action === "address") return addPickupAddress(tx, { merchantId: id, ...b });
      return addPriceOverride(tx, { merchantId: id, zoneId: b.zoneId, tier: b.tier, price: b.price });
    });
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
