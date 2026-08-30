/**
 * ============================================================
 *  قطع الأوردر — التسليم/الاستلام الجزئي بالقطعة
 * ------------------------------------------------------------
 *  التاجر بيكتب قطع الأوردر بسعر لكل قطعة. المندوب بيعلّم أنهي
 *  قطع اتسلّمت وأنهي رجعت — والتحصيل بيتحسب من المتسلّم، فمفيش
 *  لغبطة ولا إدخال مبلغ بالإيد.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) return (result as { rows: T[] }).rows;
  return [];
}

export interface ShipmentItem {
  id: string;
  nameAr: string;
  sku: string | null;
  qty: number;
  unitPriceP: string;
  status: string;
}

export async function listItems(ex: SqlExecutor, shipmentId: string): Promise<ShipmentItem[]> {
  const rows = rowsOf<{ id: string; name_ar: string; sku: string | null; qty: number; unit_price_p: string; status: string }>(
    await ex.execute(sql`
      SELECT id, name_ar, sku, qty, unit_price_p::text, status
      FROM shipment_items WHERE shipment_id = ${shipmentId}::uuid ORDER BY created_at ASC
    `)
  );
  return rows.map((r) => ({ id: r.id, nameAr: r.name_ar, sku: r.sku, qty: r.qty, unitPriceP: r.unit_price_p, status: r.status }));
}

export interface ItemDecision {
  collectedP: bigint;
  deliveredCount: number;
  returnedCount: number;
  totalItems: number;
}

/**
 * تطبيق قرار المندوب على القطع: المُمرّرة = متسلّمة، والباقي = مرتجع.
 * بيرجّع التحصيل المحسوب (مجموع أسعار المتسلّم × الكمية) والأعداد.
 * ⚠️ بيتنده جوه نفس ترانزاكشن التحول (قبل applyTransition).
 */
export async function applyItemDecision(
  ex: SqlExecutor,
  shipmentId: string,
  deliveredItemIds: string[]
): Promise<ItemDecision> {
  const items = rowsOf<{ id: string; qty: number; unit_price_p: string }>(
    await ex.execute(sql`
      SELECT id, qty, unit_price_p::text FROM shipment_items
      WHERE shipment_id = ${shipmentId}::uuid FOR UPDATE
    `)
  );
  if (items.length === 0) throw new HttpError(422, "NO_ITEMS", "الأوردر ده مافيهوش قطع مسجّلة");

  const deliveredSet = new Set(deliveredItemIds);
  // اتأكد إن كل المُمرّر تابع للأوردر ده فعلًا
  for (const id of deliveredSet) {
    if (!items.some((it) => it.id === id)) {
      throw new HttpError(400, "BAD_ITEM", "قطعة مش تابعة للأوردر ده");
    }
  }

  let collectedP = 0n;
  let deliveredCount = 0;
  for (const it of items) {
    const delivered = deliveredSet.has(it.id);
    if (delivered) {
      collectedP += BigInt(it.unit_price_p) * BigInt(it.qty);
      deliveredCount++;
    }
    await ex.execute(sql`
      UPDATE shipment_items SET status = ${delivered ? "delivered" : "returned"}, decided_at = now()
      WHERE id = ${it.id}::uuid
    `);
  }

  return {
    collectedP,
    deliveredCount,
    returnedCount: items.length - deliveredCount,
    totalItems: items.length,
  };
}
