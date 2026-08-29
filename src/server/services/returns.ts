/**
 * ============================================================
 *  خدمة المرتجعات — Returns
 * ------------------------------------------------------------
 *  enterReturns  — بتتفتح تلقائيًا لما شحنة تدخل awaiting_return
 *                  (من الـ route بعد applyTransition، بدون قيد).
 *  listReturns   — سجل المرتجعات: رف + عمر + مستوى تصعيد لكل مرتجع.
 *  assignShelf   — تحطّ/تنقل المرتجع على رف (لازم يكون awaiting_return).
 *  disposeReturn — إتلاف بعد المدة → applyTransition لـ disposed
 *                  (بيقيّد الشحن)، بموافقة مدير النظام بس.
 *  listShelves / createShelf — إدارة الرفوف.
 *
 *  ⚠️ تغيير حالة الشحنة دايمًا عبر applyTransition (البوابة).
 *     العمر والتصعيد بيتحسبوا من shipments.status_updated_at —
 *     مصدر واحد للحقيقة، مفيش تكرار حالة في جدول المرتجعات.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { buildDisposalEntry } from "../domain/ledger";
import { boolSetting } from "./shipmentFinancials";
import { type SqlExecutor } from "./ledger";
import { applyTransition, type Actor } from "./transition";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** حدود تصعيد المرتجعات القديمة (بالأيام) — الافتراضي [14, 30] */
async function escalationThresholds(ex: SqlExecutor): Promise<[number, number]> {
  const r = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = 'returns.escalate_after_days' LIMIT 1`)
  );
  const v = r[0]?.value;
  if (Array.isArray(v) && v.length >= 2) return [Number(v[0]), Number(v[1])];
  return [14, 30];
}

// ---------------------------------------------------------------
// فتح المرتجع — بيتنده من الـ route عند دخول awaiting_return
// ---------------------------------------------------------------

/**
 * تسجيل الشحنة في سجل المرتجعات. آمنة للتكرار: لو المرتجع
 * موجود بيسيبه زي ما هو (بيحافظ على الرف ووقت الدخول الأول).
 * بترجّع الـ id سواء اتعمل دلوقتي أو كان موجود.
 */
export async function enterReturns(
  ex: SqlExecutor,
  input: { shipmentId: string; actorUserId: string | null }
): Promise<{ returnId: string; created: boolean }> {
  const s = rowsOf<{ awb: string; merchant_id: string; status: string }>(
    await ex.execute(sql`
      SELECT awb, merchant_id::text, status FROM shipments WHERE id = ${input.shipmentId}::uuid
    `)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");

  const existing = rowsOf<{ id: string }>(
    await ex.execute(sql`SELECT id::text FROM returns WHERE shipment_id = ${input.shipmentId}::uuid LIMIT 1`)
  )[0];
  if (existing) return { returnId: existing.id, created: false };

  const row = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO returns (shipment_id, merchant_id, awb, entered_at)
      VALUES (${input.shipmentId}::uuid, ${s.merchant_id}::uuid, ${s.awb}, now())
      ON CONFLICT (shipment_id) DO NOTHING
      RETURNING id::text
    `)
  )[0];
  // لو حصل سباق والصف اتعمل من نداء تاني، نقراه
  if (!row) {
    const again = rowsOf<{ id: string }>(
      await ex.execute(sql`SELECT id::text FROM returns WHERE shipment_id = ${input.shipmentId}::uuid LIMIT 1`)
    )[0]!;
    return { returnId: again.id, created: false };
  }
  return { returnId: row.id, created: true };
}

// ---------------------------------------------------------------
// سجل المرتجعات — رف + عمر + تصعيد
// ---------------------------------------------------------------

export interface ReturnRow {
  id: string;
  shipmentId: string;
  awb: string;
  merchantName: string;
  status: string;
  shelfId: string | null;
  shelfCode: string | null;
  shelfName: string | null;
  enteredAt: string;
  /** عمر المرتجع في حالته الحالية (أيام) — من status_updated_at */
  ageDays: number;
  /** 0 = عادي · 1 = تجاوز الحد الأول · 2 = تجاوز الحد الثاني (مؤهّل للإتلاف) */
  escalationLevel: number;
  disposedAt: string | null;
  returnedAt: string | null;
}

/**
 * سجل المرتجعات. الافتراضي بيعرض المرتجعات النشطة (اللي لسه على
 * الرف — awaiting_return). filter='all' بيعرض الكل بما فيها
 * المتسلَّمة والمتلَفة.
 */
export async function listReturns(
  ex: SqlExecutor,
  input: { filter?: "active" | "escalated" | "all"; limit?: number } = {}
): Promise<{ rows: ReturnRow[]; thresholds: [number, number] }> {
  const [t1, t2] = await escalationThresholds(ex);
  const filter = input.filter ?? "active";
  const limit = Math.min(input.limit ?? 200, 500);

  const raws = rowsOf<{
    id: string; shipment_id: string; awb: string; merchant_name: string | null;
    status: string; shelf_id: string | null; shelf_code: string | null; shelf_name: string | null;
    entered_at: string; age_days: number; disposed_at: string | null; returned_at: string | null;
  }>(
    await ex.execute(sql`
      SELECT r.id::text, r.shipment_id::text, r.awb, m.name_ar AS merchant_name,
             s.status,
             r.shelf_id::text, sh.code AS shelf_code, sh.name_ar AS shelf_name,
             r.entered_at::text,
             GREATEST(0, (now()::date - s.status_updated_at::date))::int AS age_days,
             r.disposed_at::text, r.returned_at::text
      FROM returns r
      JOIN shipments s ON s.id = r.shipment_id
      LEFT JOIN merchants m ON m.id = r.merchant_id
      LEFT JOIN return_shelves sh ON sh.id = r.shelf_id
      WHERE 1=1
        ${filter === "active" ? sql`AND s.status = 'awaiting_return'` : sql``}
        ${filter === "escalated" ? sql`AND s.status = 'awaiting_return' AND (now()::date - s.status_updated_at::date) >= ${t1}` : sql``}
      ORDER BY
        (s.status = 'awaiting_return') DESC,
        age_days DESC, r.entered_at ASC
      LIMIT ${limit}
    `)
  );

  const rows: ReturnRow[] = raws.map((r) => {
    const active = r.status === "awaiting_return";
    const age = r.age_days;
    const level = !active ? 0 : age >= t2 ? 2 : age >= t1 ? 1 : 0;
    return {
      id: r.id,
      shipmentId: r.shipment_id,
      awb: r.awb,
      merchantName: r.merchant_name ?? "تاجر",
      status: r.status,
      shelfId: r.shelf_id,
      shelfCode: r.shelf_code,
      shelfName: r.shelf_name,
      enteredAt: r.entered_at,
      ageDays: age,
      escalationLevel: level,
      disposedAt: r.disposed_at,
      returnedAt: r.returned_at,
    };
  });

  return { rows, thresholds: [t1, t2] };
}

// ---------------------------------------------------------------
// الرفوف
// ---------------------------------------------------------------

export async function listShelves(
  ex: SqlExecutor
): Promise<Array<{ id: string; code: string; nameAr: string; isActive: boolean; onShelf: number }>> {
  const raws = rowsOf<{ id: string; code: string; name_ar: string; is_active: boolean; on_shelf: number }>(
    await ex.execute(sql`
      SELECT sh.id::text, sh.code, sh.name_ar, sh.is_active,
             COUNT(r.id) FILTER (WHERE s.status = 'awaiting_return')::int AS on_shelf
      FROM return_shelves sh
      LEFT JOIN returns r ON r.shelf_id = sh.id
      LEFT JOIN shipments s ON s.id = r.shipment_id
      GROUP BY sh.id
      ORDER BY sh.code
    `)
  );
  return raws.map((r) => ({
    id: r.id, code: r.code, nameAr: r.name_ar, isActive: r.is_active, onShelf: r.on_shelf,
  }));
}

export async function createShelf(
  ex: SqlExecutor,
  input: { code: string; nameAr: string; branchId?: string | null; capacity?: number | null; notes?: string | null }
): Promise<{ id: string; code: string }> {
  try {
    const row = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO return_shelves (code, name_ar, branch_id, capacity, notes)
        VALUES (${input.code}, ${input.nameAr}, ${input.branchId ?? null}::uuid,
                ${input.capacity ?? null}, ${input.notes ?? null})
        RETURNING id::text
      `)
    )[0]!;
    return { id: row.id, code: input.code };
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      throw new HttpError(422, "SHELF_EXISTS", "كود الرف موجود بالفعل");
    }
    throw err;
  }
}

/** تحطّ/تنقل مرتجع على رف — لازم يكون لسه في المخزن (awaiting_return) */
export async function assignShelf(
  ex: SqlExecutor,
  input: { shipmentId: string; shelfId: string | null; actor: Actor }
): Promise<{ shelfId: string | null }> {
  const ret = rowsOf<{ id: string; status: string }>(
    await ex.execute(sql`
      SELECT r.id::text, s.status
      FROM returns r JOIN shipments s ON s.id = r.shipment_id
      WHERE r.shipment_id = ${input.shipmentId}::uuid
      FOR UPDATE OF r
    `)
  )[0];
  if (!ret) throw new HttpError(404, "NOT_FOUND", "المرتجع مش موجود");
  if (ret.status !== "awaiting_return") {
    throw new HttpError(422, "NOT_ON_SHELF", "المرتجع مش على الرف — لازم يكون بانتظار الإرجاع");
  }

  if (input.shelfId) {
    const shelf = rowsOf<{ is_active: boolean }>(
      await ex.execute(sql`SELECT is_active FROM return_shelves WHERE id = ${input.shelfId}::uuid LIMIT 1`)
    )[0];
    if (!shelf) throw new HttpError(422, "SHELF_MISSING", "الرف مش موجود");
    if (!shelf.is_active) throw new HttpError(422, "SHELF_INACTIVE", "الرف غير مفعّل");
  }

  await ex.execute(sql`
    UPDATE returns SET shelf_id = ${input.shelfId ?? null}::uuid, updated_at = now()
    WHERE shipment_id = ${input.shipmentId}::uuid
  `);
  return { shelfId: input.shelfId ?? null };
}

// ---------------------------------------------------------------
// الإتلاف — مدير النظام بس، بعد المدة، بموافقة وسبب
// ---------------------------------------------------------------

export interface DisposeResult {
  status: string;
  journalEntryNo: string | null;
  ageDays: number;
}

/**
 * إتلاف مرتجع شاخ على الرف. بيعدّي على البوابة applyTransition
 * (awaiting_return → disposed) اللي بتقيّد الشحن، وبعدين بيسجّل
 * بيانات الإتلاف في سجل المرتجعات.
 *
 * ⚠️ مدير النظام بس (بيتأكّد كمان في canTransition)، ولازم
 *    المرتجع يكون عدّى الحد الثاني للتصعيد — إلا بتجاوز صريح.
 */
export async function disposeReturn(
  ex: SqlExecutor,
  input: { shipmentId: string; reason: string; overrideAge?: boolean; actor: Actor }
): Promise<DisposeResult> {
  if (!input.reason?.trim()) throw new HttpError(422, "REASON_REQUIRED", "الإتلاف محتاج سبب مكتوب");
  if (input.actor.role !== "super_admin") {
    throw new HttpError(403, "FORBIDDEN", "الإتلاف لمدير النظام بس");
  }

  // عمر المرتجع الحالي + التأكد إنه على الرف
  const s = rowsOf<{ status: string; age_days: number }>(
    await ex.execute(sql`
      SELECT status, GREATEST(0, (now()::date - status_updated_at::date))::int AS age_days
      FROM shipments WHERE id = ${input.shipmentId}::uuid
    `)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
  if (s.status !== "awaiting_return") {
    throw new HttpError(422, "NOT_ON_SHELF", "الإتلاف بيتم للمرتجعات اللي على الرف بس");
  }

  const [, t2] = await escalationThresholds(ex);
  if (s.age_days < t2 && !input.overrideAge) {
    throw new HttpError(
      422,
      "TOO_EARLY",
      `المرتجع لسه ماعدّاش مدة التصعيد (${t2} يوم) — عمره ${s.age_days} يوم. محتاج تجاوز صريح.`
    );
  }

  // البوابة الوحيدة — بتبني قيد الإتلاف (شحن) لو الإعداد مفعّل
  const res = await applyTransition(ex, {
    shipmentId: input.shipmentId,
    to: "disposed",
    actor: input.actor,
    expectedStatus: "awaiting_return",
    note: input.reason,
    buildFinancialEntry: (exec) => disposalEntryFor(exec, input.shipmentId),
    source: "web",
  });

  // تسجيل بيانات الإتلاف في سجل المرتجعات (بنعمل الصف لو مش موجود)
  await ex.execute(sql`
    INSERT INTO returns (shipment_id, merchant_id, awb, disposed_at, disposal_reason, disposal_approved_by)
    SELECT ${input.shipmentId}::uuid, s.merchant_id, s.awb, now(), ${input.reason}, ${input.actor.userId ?? null}::uuid
    FROM shipments s WHERE s.id = ${input.shipmentId}::uuid
    ON CONFLICT (shipment_id) DO UPDATE SET
      disposed_at = now(),
      disposal_reason = EXCLUDED.disposal_reason,
      disposal_approved_by = EXCLUDED.disposal_approved_by,
      updated_at = now()
  `);

  return {
    status: "disposed",
    journalEntryNo: res.journalEntryNo?.toString() ?? null,
    ageDays: s.age_days,
  };
}

/** بنّاء قيد الإتلاف — بيقرا الشحن المُثبّت ويطبّق إعداد الشحن */
async function disposalEntryFor(ex: SqlExecutor, shipmentId: string) {
  const ship = rowsOf<{ awb: string; merchant_id: string; price_p: string }>(
    await ex.execute(sql`
      SELECT awb, merchant_id::text, price_p::text FROM shipments WHERE id = ${shipmentId}::uuid
    `)
  )[0];
  if (!ship) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
  const shippingP = BigInt(ship.price_p);
  const chargeShipping = await boolSetting(ex, "billing.charge_shipping_on_return", true);
  if (!chargeShipping || shippingP <= 0n) return null;
  return buildDisposalEntry({
    shipmentId,
    merchantId: ship.merchant_id,
    awb: ship.awb,
    shippingP,
  });
}
