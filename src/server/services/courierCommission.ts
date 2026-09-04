/**
 * ============================================================
 *  محاسبة عمولات المناديب — المحاسب هو اللي بيحدد المبلغ
 * ------------------------------------------------------------
 *  قرار المالك: العمولة **مبتتقيّدش لوحدها**. السيستم بيقترح
 *  (عدد الأوردرات المتسلّمة × السعر الافتراضي) والمحاسب يعدّل
 *  المبلغ ويأكّد — وساعتها بس بيتسجّل القيد.
 *
 *  ⚠️ كل أوردر يتحاسب عليه **مرة واحدة للأبد** — مضمونة بفهرس
 *     فريد على courier_commission_items.shipment_id.
 *
 *  القيد: مدين مصروف عمولات المناديب / دائن مستحق للمندوب.
 *  (تكلفة على الشركة — مالهاش أي علاقة بالتاجر ولا بحساب الأوردر.)
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { Piastres } from "@/lib/money";
import { buildCommissionEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** السعر الافتراضي للعمولة (الاقتراح) — المحاسب يقدر يغيّره */
export async function suggestedRate(ex: SqlExecutor): Promise<Piastres> {
  const v = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = 'commission.default_per_delivery_p' LIMIT 1`)
  )[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return BigInt(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);
}

export interface PendingOrder {
  id: string; awb: string; delivered_at: string | null; merchant_name: string | null; cod_amount_p: string;
}

/** أوردرات المندوب المتسلّمة اللي لسه ماتحاسبش عليها */
export async function pendingOrders(ex: SqlExecutor, courierId: string): Promise<PendingOrder[]> {
  return rowsOf<PendingOrder>(
    await ex.execute(sql`
      SELECT s.id, s.awb, s.delivered_at, m.name_ar AS merchant_name, s.cod_amount_p::text AS cod_amount_p
      FROM shipments s
      LEFT JOIN merchants m ON m.id = s.merchant_id
      LEFT JOIN courier_commission_items ci ON ci.shipment_id = s.id
      WHERE s.current_courier_id = ${courierId}::uuid
        AND s.status IN ('delivered', 'partially_delivered')
        AND ci.id IS NULL
      ORDER BY s.delivered_at ASC NULLS LAST
    `)
  );
}

/** ملخص لكل مندوب — عشان المحاسب يعرف عند مين شغل */
export async function couriersWithPending(ex: SqlExecutor) {
  return rowsOf<{ id: string; full_name: string; pending: number }>(
    await ex.execute(sql`
      SELECT u.id, u.full_name, COUNT(s.id)::int AS pending
      FROM users u
      JOIN shipments s ON s.current_courier_id = u.id
        AND s.status IN ('delivered', 'partially_delivered')
      LEFT JOIN courier_commission_items ci ON ci.shipment_id = s.id
      WHERE u.role = 'courier' AND ci.id IS NULL
      GROUP BY u.id, u.full_name
      HAVING COUNT(s.id) > 0
      ORDER BY COUNT(s.id) DESC, u.full_name ASC
    `)
  );
}

/**
 * تسجيل العمولة: المحاسب بيحدد المبلغ لكل أوردر ويأكّد.
 * بيتقيّد في الدفتر مرة واحدة، والأوردرات بتتقفل ما تتحاسبش تاني.
 */
export async function recordCommission(
  ex: SqlExecutor,
  input: {
    courierId: string;
    shipmentIds: string[];
    amountPerOrderP: Piastres;
    note?: string | null;
    code: string;
    actorUserId: string | null;
  }
): Promise<{ id: string; code: string; count: number; totalP: Piastres }> {
  if (input.shipmentIds.length === 0) {
    throw new HttpError(400, "NO_SHIPMENTS", "مفيش أوردرات محددة");
  }
  if (input.amountPerOrderP <= 0n) {
    throw new HttpError(422, "BAD_AMOUNT", "مبلغ العمولة لازم يكون أكبر من صفر");
  }

  // المندوب لازم يكون مندوب فعلًا
  const courier = rowsOf<{ role: string }>(
    await ex.execute(sql`SELECT role FROM users WHERE id = ${input.courierId}::uuid AND is_active = true LIMIT 1`)
  )[0];
  if (!courier) throw new HttpError(422, "COURIER_MISSING", "المندوب مش موجود أو غير مفعّل");
  if (courier.role !== "courier") throw new HttpError(422, "NOT_COURIER", "لازم يكون مندوب");

  // كل الأوردرات لازم تكون للمندوب ده ومتسلّمة ولسه ماتحاسبش عليها
  const ok = rowsOf<{ id: string }>(
    await ex.execute(sql`
      SELECT s.id FROM shipments s
      LEFT JOIN courier_commission_items ci ON ci.shipment_id = s.id
      WHERE s.id = ANY(${sql`ARRAY[${sql.join(
        input.shipmentIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}]`})
        AND s.current_courier_id = ${input.courierId}::uuid
        AND s.status IN ('delivered', 'partially_delivered')
        AND ci.id IS NULL
      FOR UPDATE OF s
    `)
  );
  if (ok.length !== input.shipmentIds.length) {
    throw new HttpError(422, "NOT_ELIGIBLE", "فيه أوردرات اتحاسب عليها قبل كده أو مش للمندوب ده");
  }

  const count = ok.length;
  const totalP = input.amountPerOrderP * BigInt(count);

  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO courier_commissions (code, courier_id, shipments_count, amount_per_order_p, total_p, note, created_by)
      VALUES (${input.code}, ${input.courierId}::uuid, ${count}, ${input.amountPerOrderP.toString()}::bigint,
              ${totalP.toString()}::bigint, ${input.note ?? null}, ${input.actorUserId ?? null}::uuid)
      RETURNING id
    `)
  )[0]!.id;

  for (const r of ok) {
    await ex.execute(sql`
      INSERT INTO courier_commission_items (commission_id, shipment_id, amount_p)
      VALUES (${id}::uuid, ${r.id}::uuid, ${input.amountPerOrderP.toString()}::bigint)
    `);
  }

  // القيد: مصروف عمولات / مستحق للمندوب
  const posted = await postEntry(
    ex,
    buildCommissionEntry({
      runSheetId: id, // مصدر القيد = سجل العمولة ده
      courierId: input.courierId,
      deliveredCount: count,
      amountPerDeliveryP: input.amountPerOrderP,
      sourceType: "manual", // المحاسب سجّلها بإيده مش من كشف
    }),
    { actorUserId: input.actorUserId }
  );
  await ex.execute(sql`UPDATE courier_commissions SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${id}::uuid`);

  return { id, code: input.code, count, totalP };
}
