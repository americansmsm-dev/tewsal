/**
 * ============================================================
 *  خدمة كشوف المناديب — Run Sheet
 * ------------------------------------------------------------
 *  createRunSheet   — العمليات تفتح كشف تحميل لمندوب
 *  dispatchRunSheet — تحطّ شحنات من المخزن على الكشف → كل شحنة
 *                     تخرج للتسليم (at_hub → out_for_delivery)
 *                     عبر البوابة applyTransition (متطلب run_sheet)
 *  closeRunSheet    — إغلاق الكشف → تتقيّد عمولة المندوب مرة
 *                     واحدة على عدد الشحنات المسلَّمة
 *
 *  ⚠️ تغيير حالة الشحنة دايمًا عبر applyTransition (البوابة).
 *     العمولة بتتقيّد **مرة واحدة** عند الإغلاق (kind=commission،
 *     source=run_sheet — الفهرس الفريد يمنع التكرار).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildCommissionEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
import { applyTransition, type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** عمولة الشحنة الواحدة من الإعدادات (افتراضي ٥٠ ج) */
async function commissionPerDelivery(ex: SqlExecutor): Promise<Piastres> {
  const r = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = 'commission.default_per_delivery_p' LIMIT 1`)
  );
  return BigInt(Number(r[0]?.value ?? 5000));
}

export interface CreateRunSheetInput {
  courierId: string;
  branchId?: string | null;
  code: string;
  notes?: string | null;
  actorUserId: string | null;
}

export interface RunSheetSummary {
  runSheetId: string;
  code: string;
  status: string;
}

export async function createRunSheet(
  ex: SqlExecutor,
  input: CreateRunSheetInput
): Promise<RunSheetSummary> {
  // المندوب لازم يكون موجود وبدور مندوب
  const courier = rowsOf<{ role: string }>(
    await ex.execute(sql`SELECT role FROM users WHERE id = ${input.courierId}::uuid AND is_active = true LIMIT 1`)
  )[0];
  if (!courier) throw new HttpError(422, "COURIER_MISSING", "المندوب مش موجود أو غير مفعّل");
  if (courier.role !== "courier") throw new HttpError(422, "NOT_COURIER", "لازم يكون مندوب");

  const runSheetId = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO run_sheets (code, courier_id, branch_id, status, notes, created_by_user_id)
      VALUES (${input.code}, ${input.courierId}::uuid, ${input.branchId ?? null}::uuid, 'open',
              ${input.notes ?? null}, ${input.actorUserId ?? null}::uuid)
      RETURNING id
    `)
  )[0]!.id;

  return { runSheetId, code: input.code, status: "open" };
}

/** تنزيل الكشف: شحنات المخزن تخرج للتسليم على عهدة المندوب */
export async function dispatchRunSheet(
  ex: SqlExecutor,
  input: { runSheetId: string; shipmentIds: string[]; actor: Actor }
): Promise<{ status: string; dispatched: number }> {
  if (input.shipmentIds.length === 0) {
    throw new HttpError(400, "NO_SHIPMENTS", "لازم تختار شحنة واحدة على الأقل");
  }

  const rs = rowsOf<{ status: string; courier_id: string }>(
    await ex.execute(sql`SELECT status, courier_id::text FROM run_sheets WHERE id = ${input.runSheetId}::uuid FOR UPDATE`)
  )[0];
  if (!rs) throw new HttpError(404, "NOT_FOUND", "الكشف مش موجود");
  if (rs.status !== "open" && rs.status !== "dispatched") {
    throw new HttpError(422, "BAD_STATUS", "الكشف مقفول أو ملغي");
  }

  // كل الشحنات لازم تكون في المخزن
  const ships = rowsOf<{ id: string; status: string }>(
    await ex.execute(sql`
      SELECT id, status FROM shipments
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
    if (s.status !== "at_hub") {
      throw new HttpError(422, "NOT_AT_HUB", "فيه شحنة مش في المخزن — لازم تكون at_hub قبل التنزيل");
    }
  }

  for (const s of ships) {
    await applyTransition(ex, {
      shipmentId: s.id,
      to: "out_for_delivery",
      actor: input.actor,
      expectedStatus: "at_hub",
      runSheetId: input.runSheetId,
      courierId: rs.courier_id,
    });
    try {
      await ex.execute(sql`
        INSERT INTO run_sheet_items (run_sheet_id, shipment_id)
        VALUES (${input.runSheetId}::uuid, ${s.id}::uuid)
      `);
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "23505") {
        throw new HttpError(422, "ALREADY_ON_SHEET", "فيه شحنة على الكشف بالفعل");
      }
      throw err;
    }
  }

  const total = rowsOf<{ n: number }>(
    await ex.execute(sql`SELECT count(*)::int AS n FROM run_sheet_items WHERE run_sheet_id = ${input.runSheetId}::uuid`)
  )[0]!.n;

  await ex.execute(sql`
    UPDATE run_sheets SET status = 'dispatched', shipments_count = ${total}, dispatched_at = now(), updated_at = now()
    WHERE id = ${input.runSheetId}::uuid
  `);

  return { status: "dispatched", dispatched: ships.length };
}

/** إغلاق الكشف: تتقيّد عمولة المندوب على المسلَّم */
export async function closeRunSheet(
  ex: SqlExecutor,
  input: { runSheetId: string; actor: Actor }
): Promise<{ status: string; deliveredCount: number; commissionP: Piastres }> {
  const rs = rowsOf<{ status: string; courier_id: string }>(
    await ex.execute(sql`SELECT status, courier_id::text FROM run_sheets WHERE id = ${input.runSheetId}::uuid FOR UPDATE`)
  )[0];
  if (!rs) throw new HttpError(404, "NOT_FOUND", "الكشف مش موجود");
  if (rs.status !== "dispatched") {
    throw new HttpError(422, "BAD_STATUS", "الكشف لازم يكون منزّل (dispatched) الأول");
  }

  // الشحنات المسلَّمة على الكشف ده (تسليم كامل أو جزئي)
  const delivered = rowsOf<{ n: number }>(
    await ex.execute(sql`
      SELECT count(*)::int AS n
      FROM run_sheet_items rsi
      JOIN shipments s ON s.id = rsi.shipment_id
      WHERE rsi.run_sheet_id = ${input.runSheetId}::uuid
        AND s.status IN ('delivered', 'partially_delivered')
    `)
  )[0]!.n;

  const perDelivery = await commissionPerDelivery(ex);
  let commissionP: Piastres = 0n;

  if (delivered > 0 && perDelivery > 0n) {
    commissionP = perDelivery * BigInt(delivered);
    const posted = await postEntry(
      ex,
      buildCommissionEntry({
        runSheetId: input.runSheetId,
        courierId: rs.courier_id,
        deliveredCount: delivered,
        amountPerDeliveryP: perDelivery,
      }),
      { actorUserId: input.actor.userId }
    );
    await ex.execute(sql`
      UPDATE run_sheets SET commission_entry_id = ${posted.entryId}::uuid WHERE id = ${input.runSheetId}::uuid
    `);
  }

  await ex.execute(sql`
    UPDATE run_sheets
    SET status = 'closed', delivered_count = ${delivered}, commission_p = ${commissionP.toString()}::bigint,
        closed_at = now(), updated_at = now()
    WHERE id = ${input.runSheetId}::uuid
  `);

  return { status: "closed", deliveredCount: delivered, commissionP };
}
