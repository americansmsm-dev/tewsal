/**
 * ============================================================
 *  خدمة طلبات الاستلام — Pickup
 * ------------------------------------------------------------
 *  createPickup  — التاجر يطلب استلام لشحنات في انتظار الاستلام
 *  assignPickup  — إسناد لمندوب (كل شحنة تعدّي على البوابة →
 *                  pickup_assigned)
 *  confirmPickup — المندوب يأكّد الاستلام (→ picked_up) ويتقيّد
 *                  رسم الخدمة لو أقل من الحد المجاني (قرار ١٠)
 *
 *  ⚠️ تغيير حالة الشحنة دايمًا عبر applyTransition (البوابة).
 *     الرسم بيتقيّد **مرة واحدة** عند التأكيد.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildPickupFeeEntry } from "../domain/ledger";
import { postEntry, recomputeMerchantBalance, type SqlExecutor } from "./ledger";
import { applyTransition, type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export interface CreatePickupInput {
  merchantId: string;
  shipmentIds: string[];
  pickupAddress: string;
  governorateId?: string | null;
  contactPhone?: string | null;
  scheduledDate?: string | null;
  timeWindow?: string | null;
  notes?: string | null;
  code: string;
  actorUserId: string | null;
}

export interface PickupSummary {
  pickupId: string;
  code: string;
  ordersCount: number;
  serviceFeeP: Piastres;
  status: string;
}

/** رسم الاستلام لو العدد أقل من الحد المجاني */
async function computeServiceFee(ex: SqlExecutor, ordersCount: number): Promise<Piastres> {
  const th = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = 'pickup.free_threshold' LIMIT 1`)
  );
  const threshold = Number(th[0]?.value ?? 5);
  if (ordersCount >= threshold) return 0n;

  const fee = rowsOf<{ value_p: string }>(
    await ex.execute(sql`
      SELECT value_p::text FROM fee_definitions WHERE code = 'PICKUP_SERVICE' AND is_active = true LIMIT 1
    `)
  );
  return BigInt(fee[0]?.value_p ?? "0");
}

export async function createPickup(
  ex: SqlExecutor,
  input: CreatePickupInput
): Promise<PickupSummary> {
  if (input.shipmentIds.length === 0) {
    throw new HttpError(400, "NO_SHIPMENTS", "لازم تختار شحنة واحدة على الأقل");
  }

  // التأكد إن كل الشحنات للتاجر ده وفي انتظار الاستلام
  const ships = rowsOf<{ id: string; status: string; merchant_id: string }>(
    await ex.execute(sql`
      SELECT id, status, merchant_id::text
      FROM shipments
      WHERE id = ANY(${sql`ARRAY[${sql.join(
        input.shipmentIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}]`})
      FOR UPDATE
    `)
  );
  if (ships.length !== input.shipmentIds.length) {
    throw new HttpError(422, "SHIPMENT_MISSING", "بعض الشحنات مش موجودة");
  }
  for (const s of ships) {
    if (s.merchant_id !== input.merchantId) {
      throw new HttpError(422, "WRONG_MERCHANT", "فيه شحنة مش تابعة للتاجر ده");
    }
    if (s.status !== "awaiting_pickup") {
      throw new HttpError(422, "NOT_AWAITING", "فيه شحنة مش في حالة انتظار الاستلام");
    }
  }

  const ordersCount = ships.length;
  const serviceFeeP = await computeServiceFee(ex, ordersCount);

  let pickupId: string;
  try {
    pickupId = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO pickups
          (code, merchant_id, pickup_address, governorate_id, contact_phone,
           scheduled_date, time_window, status, orders_count, service_fee_p, notes, created_by_user_id)
        VALUES (
          ${input.code}, ${input.merchantId}::uuid, ${input.pickupAddress},
          ${input.governorateId ?? null}::uuid, ${input.contactPhone ?? null},
          ${input.scheduledDate ?? null}, ${input.timeWindow ?? null},
          'requested', ${ordersCount}, ${serviceFeeP.toString()}::bigint,
          ${input.notes ?? null}, ${input.actorUserId ?? null}::uuid
        )
        RETURNING id
      `)
    )[0]!.id;
  } catch (err) {
    throw err;
  }

  for (const s of ships) {
    try {
      await ex.execute(sql`
        INSERT INTO pickup_shipments (pickup_id, shipment_id)
        VALUES (${pickupId}::uuid, ${s.id}::uuid)
      `);
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        throw new HttpError(422, "ALREADY_IN_PICKUP", "فيه شحنة في طلب استلام تاني بالفعل");
      }
      throw err;
    }
  }

  return { pickupId, code: input.code, ordersCount, serviceFeeP, status: "requested" };
}

/** إسناد الاستلام لمندوب — كل شحنة تتحوّل لـ pickup_assigned */
export async function assignPickup(
  ex: SqlExecutor,
  input: { pickupId: string; courierId: string; actor: Actor }
): Promise<{ status: string; assigned: number }> {
  const p = rowsOf<{ status: string }>(
    await ex.execute(sql`SELECT status FROM pickups WHERE id = ${input.pickupId}::uuid FOR UPDATE`)
  )[0];
  if (!p) throw new HttpError(404, "NOT_FOUND", "طلب الاستلام مش موجود");
  if (p.status !== "requested") {
    throw new HttpError(422, "BAD_STATUS", "الطلب مش في حالة تسمح بالإسناد");
  }

  const shipmentIds = rowsOf<{ shipment_id: string }>(
    await ex.execute(sql`SELECT shipment_id::text FROM pickup_shipments WHERE pickup_id = ${input.pickupId}::uuid`)
  ).map((r) => r.shipment_id);

  for (const shipmentId of shipmentIds) {
    await applyTransition(ex, {
      shipmentId,
      to: "pickup_assigned",
      actor: input.actor,
      expectedStatus: "awaiting_pickup",
      pickupId: input.pickupId,
      courierId: input.courierId,
    });
  }

  await ex.execute(sql`
    UPDATE pickups SET courier_id = ${input.courierId}::uuid, status = 'assigned', updated_at = now()
    WHERE id = ${input.pickupId}::uuid
  `);
  return { status: "assigned", assigned: shipmentIds.length };
}

/** تأكيد الاستلام — الشحنات picked_up + رسم الخدمة لو مستحق */
export async function confirmPickup(
  ex: SqlExecutor,
  input: { pickupId: string; actor: Actor }
): Promise<{ status: string; collected: number; feeCharged: boolean }> {
  const p = rowsOf<{ status: string; merchant_id: string; service_fee_p: string; code: string }>(
    await ex.execute(sql`
      SELECT status, merchant_id::text, service_fee_p::text, code
      FROM pickups WHERE id = ${input.pickupId}::uuid FOR UPDATE
    `)
  )[0];
  if (!p) throw new HttpError(404, "NOT_FOUND", "طلب الاستلام مش موجود");
  if (p.status !== "assigned") {
    throw new HttpError(422, "BAD_STATUS", "الطلب لازم يكون مسند لمندوب الأول");
  }

  const shipmentIds = rowsOf<{ shipment_id: string }>(
    await ex.execute(sql`SELECT shipment_id::text FROM pickup_shipments WHERE pickup_id = ${input.pickupId}::uuid`)
  ).map((r) => r.shipment_id);

  for (const shipmentId of shipmentIds) {
    await applyTransition(ex, {
      shipmentId,
      to: "picked_up",
      actor: input.actor,
      expectedStatus: "pickup_assigned",
    });
  }

  // ⚠️ رسم الخدمة بيتقيّد مرة واحدة عند التأكيد
  const feeP = BigInt(p.service_fee_p);
  let feeCharged = false;
  if (feeP > 0n) {
    const posted = await postEntry(
      ex,
      buildPickupFeeEntry({ pickupId: input.pickupId, merchantId: p.merchant_id, code: p.code, feeP }),
      { actorUserId: input.actor.userId }
    );
    await ex.execute(sql`
      UPDATE pickups SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${input.pickupId}::uuid
    `);
    await recomputeMerchantBalance(ex, p.merchant_id);
    feeCharged = true;
  }

  await ex.execute(sql`
    UPDATE pickups SET status = 'collected', confirmed_at = now(), updated_at = now()
    WHERE id = ${input.pickupId}::uuid
  `);
  return { status: "collected", collected: shipmentIds.length, feeCharged };
}
