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

async function moneySetting(ex: SqlExecutor, key: string): Promise<Piastres> {
  const v = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`)
  )[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return BigInt(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);
}

/** السعر الافتراضي لعمولة التسليم (الاقتراح) — المحاسب يقدر يغيّره */
export async function suggestedRate(ex: SqlExecutor): Promise<Piastres> {
  return moneySetting(ex, "commission.default_per_delivery_p");
}

/**
 * السعر الافتراضي لعمولة **المرتجع** — منفصل عن التسليم بقرار المالك.
 * لو الإعداد مش موجود بنرجع لسعر التسليم عشان مايضيعش حق المندوب.
 */
export async function suggestedReturnRate(ex: SqlExecutor): Promise<Piastres> {
  const r = await moneySetting(ex, "commission.default_per_return_p");
  return r > 0n ? r : suggestedRate(ex);
}

/** الحالات اللي بتستاهل عمولة: تسليم (كامل/جزئي) أو مرتجع اتسلّم للتاجر */
const COMMISSIONABLE = sql`('delivered', 'partially_delivered', 'returned_to_merchant')`;

export interface PendingOrder {
  id: string; awb: string; delivered_at: string | null; merchant_name: string | null; cod_amount_p: string;
  status: string;
  /** delivery = تسليم للعميل · return = مرتجع رجع للتاجر (سعر مختلف) */
  kind: "delivery" | "return";
}

/** أوردرات المندوب المتسلّمة اللي لسه ماتحاسبش عليها */
export async function pendingOrders(ex: SqlExecutor, courierId: string): Promise<PendingOrder[]> {
  return rowsOf<PendingOrder>(
    await ex.execute(sql`
      SELECT s.id, s.awb, s.delivered_at, m.name_ar AS merchant_name, s.cod_amount_p::text AS cod_amount_p,
             s.status,
             CASE WHEN s.status = 'returned_to_merchant' THEN 'return' ELSE 'delivery' END AS kind
      FROM shipments s
      LEFT JOIN merchants m ON m.id = s.merchant_id
      LEFT JOIN courier_commission_items ci ON ci.shipment_id = s.id
      WHERE s.current_courier_id = ${courierId}::uuid
        AND s.status IN ${COMMISSIONABLE}
        AND ci.id IS NULL
      ORDER BY COALESCE(s.delivered_at, s.status_updated_at) ASC NULLS LAST
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
        AND s.status IN ${COMMISSIONABLE}
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
    /** سعر المرتجع — لو مش متبعت بنستخدم سعر التسليم */
    amountPerReturnP?: Piastres;
    note?: string | null;
    code: string;
    actorUserId: string | null;
  }
): Promise<{ id: string; code: string; count: number; totalP: Piastres; deliveries: number; returns: number }> {
  if (input.shipmentIds.length === 0) {
    throw new HttpError(400, "NO_SHIPMENTS", "مفيش أوردرات محددة");
  }
  if (input.amountPerOrderP <= 0n) {
    throw new HttpError(422, "BAD_AMOUNT", "مبلغ العمولة لازم يكون أكبر من صفر");
  }
  const returnRateP = input.amountPerReturnP ?? input.amountPerOrderP;
  if (returnRateP <= 0n) {
    throw new HttpError(422, "BAD_AMOUNT", "مبلغ عمولة المرتجع لازم يكون أكبر من صفر");
  }

  // المندوب لازم يكون مندوب فعلًا
  const courier = rowsOf<{ role: string }>(
    await ex.execute(sql`SELECT role FROM users WHERE id = ${input.courierId}::uuid AND is_active = true LIMIT 1`)
  )[0];
  if (!courier) throw new HttpError(422, "COURIER_MISSING", "المندوب مش موجود أو غير مفعّل");
  if (courier.role !== "courier") throw new HttpError(422, "NOT_COURIER", "لازم يكون مندوب");

  // كل الأوردرات لازم تكون للمندوب ده ومتسلّمة ولسه ماتحاسبش عليها
  const ok = rowsOf<{ id: string; status: string }>(
    await ex.execute(sql`
      SELECT s.id, s.status FROM shipments s
      LEFT JOIN courier_commission_items ci ON ci.shipment_id = s.id
      WHERE s.id = ANY(${sql`ARRAY[${sql.join(
        input.shipmentIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}]`})
        AND s.current_courier_id = ${input.courierId}::uuid
        AND s.status IN ${COMMISSIONABLE}
        AND ci.id IS NULL
      FOR UPDATE OF s
    `)
  );
  if (ok.length !== input.shipmentIds.length) {
    throw new HttpError(422, "NOT_ELIGIBLE", "فيه أوردرات اتحاسب عليها قبل كده أو مش للمندوب ده");
  }

  // كل أوردر بسعره: المرتجع بسعر المرتجع، والباقي بسعر التسليم
  const amountFor = (status: string): Piastres =>
    status === "returned_to_merchant" ? returnRateP : input.amountPerOrderP;
  const count = ok.length;
  const returns = ok.filter((r) => r.status === "returned_to_merchant").length;
  const deliveries = count - returns;
  const totalP = ok.reduce((sum, r) => sum + amountFor(r.status), 0n);

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
      VALUES (${id}::uuid, ${r.id}::uuid, ${amountFor(r.status).toString()}::bigint)
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
      totalP, // ⚠️ إجمالي صريح — الأسعار ممكن تكون مختلفة (تسليم/مرتجع)
      sourceType: "manual", // المحاسب سجّلها بإيده مش من كشف
    }),
    { actorUserId: input.actorUserId }
  );
  await ex.execute(sql`UPDATE courier_commissions SET journal_entry_id = ${posted.entryId}::uuid WHERE id = ${id}::uuid`);

  return { id, code: input.code, count, totalP, deliveries, returns };
}
