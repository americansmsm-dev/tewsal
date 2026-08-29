/**
 * ============================================================
 *  تخزين التجار (فُلفيلمنت) — مرحلة ز
 * ------------------------------------------------------------
 *  منتجات التاجر + حركة المخزون + السحب وقت الشحن + رسم التخزين.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { poundsToPiastres, type Piastres } from "@/lib/money";
import { buildMerchantChargeEntry } from "../domain/ledger";
import { postEntry, type SqlExecutor } from "./ledger";
import { type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

export async function createProduct(
  ex: SqlExecutor,
  input: { merchantId: string; sku: string; nameAr: string; category?: string | null; price?: string | null; quantity?: number }
): Promise<{ id: string }> {
  const priceP = input.price ? poundsToPiastres(input.price) : 0n;
  try {
    const id = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO merchant_products (merchant_id, sku, name_ar, category, price_p, quantity)
        VALUES (${input.merchantId}::uuid, ${input.sku}, ${input.nameAr}, ${input.category ?? null},
                ${priceP.toString()}::bigint, ${input.quantity ?? 0})
        RETURNING id::text`)
    )[0]!.id;
    if (input.quantity && input.quantity > 0) {
      await ex.execute(sql`INSERT INTO stock_movements (product_id, delta, balance_after, reason) VALUES (${id}::uuid, ${input.quantity}, ${input.quantity}, 'restock')`);
    }
    return { id };
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") throw new HttpError(422, "SKU_EXISTS", "الـ SKU موجود للتاجر ده");
    throw err;
  }
}

export async function listProducts(ex: SqlExecutor, merchantId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`
      SELECT id::text, sku, name_ar, category, price_p::text AS price_p, quantity, is_active
      FROM merchant_products WHERE merchant_id = ${merchantId}::uuid AND is_active = true
      ORDER BY name_ar`)
  );
}

/** تعديل مخزون يدوي (إضافة/خصم). */
export async function adjustStock(
  ex: SqlExecutor,
  input: { productId: string; delta: number; reason?: string; actor: Actor }
): Promise<{ balance: number }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new HttpError(400, "BAD_DELTA", "قيمة غير صالحة");
  const p = rowsOf<{ quantity: number }>(
    await ex.execute(sql`SELECT quantity FROM merchant_products WHERE id = ${input.productId}::uuid FOR UPDATE`)
  )[0];
  if (!p) throw new HttpError(404, "NOT_FOUND", "المنتج مش موجود");
  const balance = p.quantity + input.delta;
  if (balance < 0) throw new HttpError(422, "INSUFFICIENT", "الكمية مش كفاية");
  await ex.execute(sql`UPDATE merchant_products SET quantity = ${balance}, updated_at = now() WHERE id = ${input.productId}::uuid`);
  await ex.execute(sql`INSERT INTO stock_movements (product_id, delta, balance_after, reason, created_by) VALUES (${input.productId}::uuid, ${input.delta}, ${balance}, ${input.reason ?? "adjust"}, ${input.actor.userId ?? null}::uuid)`);
  return { balance };
}

/** سحب من المخزون وقت إنشاء الشحنة (بيخصم الكمية). بيتنده جوه ترانزاكشن الشحنة. */
export async function pullFromStock(
  ex: SqlExecutor,
  input: { productId: string; qty: number; shipmentId: string; actorUserId: string | null }
): Promise<{ balance: number }> {
  const qty = input.qty > 0 ? input.qty : 1;
  const p = rowsOf<{ quantity: number; merchant_id: string }>(
    await ex.execute(sql`SELECT quantity, merchant_id::text FROM merchant_products WHERE id = ${input.productId}::uuid FOR UPDATE`)
  )[0];
  if (!p) throw new HttpError(404, "PRODUCT_MISSING", "المنتج مش موجود");
  const balance = p.quantity - qty;
  if (balance < 0) throw new HttpError(422, "OUT_OF_STOCK", "الكمية مش كفاية في المخزون");
  await ex.execute(sql`UPDATE merchant_products SET quantity = ${balance}, updated_at = now() WHERE id = ${input.productId}::uuid`);
  await ex.execute(sql`INSERT INTO stock_movements (product_id, delta, balance_after, reason, shipment_id, created_by) VALUES (${input.productId}::uuid, ${-qty}, ${balance}, 'shipment', ${input.shipmentId}::uuid, ${input.actorUserId ?? null}::uuid)`);
  return { balance };
}

/** رسم تخزين/متجر إلكتروني على التاجر → إيراد إضافي. */
export async function chargeStorageFee(
  ex: SqlExecutor,
  input: { merchantId: string; amount: string; note?: string | null; actor: Actor }
): Promise<{ amountP: Piastres }> {
  const amountP = poundsToPiastres(input.amount);
  if (amountP <= 0n) throw new HttpError(400, "BAD_AMOUNT", "المبلغ لازم أكبر من صفر");
  const n = rowsOf<{ n: string }>(await ex.execute(sql`SELECT nextval('awb_sequence')::text AS n`))[0]!.n;
  await postEntry(
    ex,
    buildMerchantChargeEntry({
      sourceId: crypto.randomUUID(),
      merchantId: input.merchantId,
      amountP,
      kind: "storage_fee",
      memo: input.note?.trim() || `رسم تخزين ${n}`,
    }),
    { actorUserId: input.actor.userId }
  );
  return { amountP };
}
