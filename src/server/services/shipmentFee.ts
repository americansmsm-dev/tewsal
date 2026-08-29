/**
 * ============================================================
 *  الرسوم اليدوية على الشحنة — Manual Shipment Fees
 * ------------------------------------------------------------
 *  رسوم مش أوتوماتيك بيضيفها الموظف على شحنة بعينها قبل التسليم
 *  (تغليف إضافي، تأمين قابل للكسر...). بتتخزّن is_estimate=false
 *  فبتتقيّد مع قيد التسليم تلقائيًا (sumOtherFees).
 *
 *  ⚠️ الرسوم متتمسحش — الإلغاء بـ voided_at (زي الدفتر).
 *     بنقبل بس أكواد رسوم يدوية معرّفة على مستوى الشحنة.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";
import { TERMINAL_STATUSES } from "../domain/statusMachine";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

const TERMINAL = new Set<string>(TERMINAL_STATUSES as readonly string[]);

export interface AddFeeInput {
  shipmentId: string;
  feeCode: string;
  amountP: Piastres;
  note?: string | null;
  actorUserId: string | null;
}

/** إضافة رسم يدوي على شحنة (قبل التسليم). */
export async function addManualFee(
  ex: SqlExecutor,
  input: AddFeeInput
): Promise<{ feeId: string; feeCode: string; amountP: Piastres }> {
  if (input.amountP <= 0n) throw new HttpError(400, "BAD_AMOUNT", "لازم مبلغ أكبر من صفر");

  // الرسم لازم يكون معرّف، يدوي، وعلى مستوى الشحنة
  const def = rowsOf<{ name_ar: string; applies_to: string; is_auto: boolean; is_active: boolean }>(
    await ex.execute(sql`
      SELECT name_ar, applies_to, is_auto, is_active FROM fee_definitions WHERE code = ${input.feeCode} LIMIT 1
    `)
  )[0];
  if (!def || !def.is_active) throw new HttpError(422, "FEE_UNKNOWN", "كود الرسم مش معرّف");
  if (def.applies_to !== "shipment") throw new HttpError(422, "FEE_NOT_SHIPMENT", "الرسم ده مش على مستوى الشحنة");
  if (def.is_auto) throw new HttpError(422, "FEE_AUTO", "الرسم ده أوتوماتيك — مبيتضافش يدوي");

  // الشحنة لازم تكون موجودة، مش نهائية، ومش مسوّاة
  const ship = rowsOf<{ status: string; is_settled: boolean }>(
    await ex.execute(sql`SELECT status, is_settled FROM shipments WHERE id = ${input.shipmentId}::uuid LIMIT 1`)
  )[0];
  if (!ship) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
  if (ship.is_settled) throw new HttpError(422, "SETTLED", "الشحنة اتسوّت — مينفعش تضيف رسم");
  if (TERMINAL.has(ship.status)) {
    throw new HttpError(422, "TERMINAL", "الشحنة في حالة نهائية — الرسم لازم يتضاف قبل التسليم");
  }

  const feeId = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO shipment_fees
        (shipment_id, fee_code, description_ar, qty, unit_value_p, amount_p, is_estimate, is_auto, created_by)
      VALUES (
        ${input.shipmentId}::uuid, ${input.feeCode}, ${def.name_ar}, 1,
        ${input.amountP.toString()}::bigint, ${input.amountP.toString()}::bigint,
        false, false, ${input.actorUserId ?? null}::uuid
      )
      RETURNING id::text
    `)
  )[0]!.id;

  return { feeId, feeCode: input.feeCode, amountP: input.amountP };
}

/** إلغاء رسم يدوي (بـ voided_at — مش حذف). */
export async function voidManualFee(
  ex: SqlExecutor,
  input: { feeId: string; reason: string; actorUserId: string | null }
): Promise<{ voided: boolean }> {
  if (!input.reason?.trim()) throw new HttpError(422, "REASON_REQUIRED", "الإلغاء محتاج سبب");
  const fee = rowsOf<{ id: string; is_auto: boolean; voided_at: string | null }>(
    await ex.execute(sql`SELECT id::text, is_auto, voided_at::text FROM shipment_fees WHERE id = ${input.feeId}::uuid FOR UPDATE`)
  )[0];
  if (!fee) throw new HttpError(404, "NOT_FOUND", "الرسم مش موجود");
  if (fee.voided_at) throw new HttpError(422, "ALREADY_VOID", "الرسم ملغي بالفعل");
  if (fee.is_auto) throw new HttpError(422, "FEE_AUTO", "الرسوم الأوتوماتيك متتلغيش يدوي");

  await ex.execute(sql`
    UPDATE shipment_fees SET voided_at = now(), voided_by = ${input.actorUserId ?? null}::uuid, void_reason = ${input.reason}
    WHERE id = ${input.feeId}::uuid
  `);
  return { voided: true };
}

/** رسوم الشحنة (الفعّالة + الملغاة) — للعرض. */
export async function listShipmentFees(
  ex: SqlExecutor,
  shipmentId: string
): Promise<Array<Record<string, unknown>>> {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT id::text, fee_code, description_ar, amount_p::text AS amount_p,
             is_estimate, is_auto, (voided_at IS NOT NULL) AS voided, created_at
      FROM shipment_fees WHERE shipment_id = ${shipmentId}::uuid
      ORDER BY created_at
    `)
  );
}
