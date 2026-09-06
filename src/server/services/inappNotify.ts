/**
 * ============================================================
 *  الإشعارات الداخلية — inappNotify
 * ------------------------------------------------------------
 *  صندوق وارد جوّه السيستم لكل مستخدم (مندوب/تاجر/إدارة).
 *  - بيتبعت تلقائي بعد نجاح الأحداث (best-effort، بعد الكوميت)
 *    عشان مانلمسش النواة (applyTransition).
 *  - أو يدويًا من المالك عبر المُرسِل.
 *
 *  ⚠️ مختلف عن services/notifications.ts (واتساب للعميل).
 *  🔒 الأرقام المالية الحساسة (مكسب الشركة) مش بتتبعت للتاجر —
 *     رسائل التاجر بتتكلم عن مستحقاته هو بس.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import type { SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** إعداد تشغيل/إيقاف الحدث — الافتراضي شغّال لو الإعداد مش موجود */
export async function eventEnabled(ex: SqlExecutor, event: string): Promise<boolean> {
  const v = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${`notifications.inapp.${event}`} LIMIT 1`)
  )[0]?.value;
  if (v === undefined || v === null) return true; // الافتراضي: مفعّل
  return !(v === false || v === "false");
}

// ─────────────────────────────────────────────
// حلّ المستلمين
// ─────────────────────────────────────────────

/** حسابات دخول التاجر (ممكن أكتر من واحد) */
export async function merchantUserIds(ex: SqlExecutor, merchantId: string): Promise<string[]> {
  return rowsOf<{ id: string }>(
    await ex.execute(sql`
      SELECT id::text FROM users
      WHERE merchant_id = ${merchantId}::uuid AND role = 'merchant' AND is_active = true
    `)
  ).map((r) => r.id);
}

/** الإدارة ومدير النظام */
export async function adminUserIds(ex: SqlExecutor): Promise<string[]> {
  return rowsOf<{ id: string }>(
    await ex.execute(sql`
      SELECT id::text FROM users
      WHERE role IN ('super_admin', 'branch_manager') AND is_active = true
    `)
  ).map((r) => r.id);
}

/** كل المستخدمين النشطين — اختياريًا بفلتر دور (للإرسال اليدوي) */
export async function usersByRole(ex: SqlExecutor, role?: string | null): Promise<string[]> {
  const rows = role
    ? await ex.execute(sql`SELECT id::text FROM users WHERE role = ${role} AND is_active = true`)
    : await ex.execute(sql`SELECT id::text FROM users WHERE is_active = true`);
  return rowsOf<{ id: string }>(rows).map((r) => r.id);
}

// ─────────────────────────────────────────────
// الإدراج
// ─────────────────────────────────────────────

export interface NotifyInput {
  userIds: string[];
  event: string;
  titleAr: string;
  bodyAr: string;
  entityType?: string | null;
  entityId?: string | null;
  createdBy?: string | null;
}

/**
 * يكتب صف إشعار لكل مستخدم نشط في القائمة. الدور بيتجاب من users
 * تلقائيًا. بيرجّع عدد اللي اتبعت. مابيرميش استثناء لو القايمة فاضية.
 */
export async function notifyUsers(ex: SqlExecutor, input: NotifyInput): Promise<number> {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  const idArr = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const res = await ex.execute(sql`
    INSERT INTO notifications (user_id, role, event, title_ar, body_ar, entity_type, entity_id, created_by)
    SELECT u.id, u.role, ${input.event}, ${input.titleAr}, ${input.bodyAr},
           ${input.entityType ?? null}, ${input.entityId ?? null}, ${input.createdBy ?? null}::uuid
    FROM users u
    WHERE u.id = ANY(${idArr}) AND u.is_active = true
    RETURNING id
  `);
  return rowsOf<{ id: string }>(res).length;
}

// ─────────────────────────────────────────────
// إشعارات جاهزة لكل حدث (best-effort — بتتنادى بعد الكوميت)
// ─────────────────────────────────────────────

const STATUS_MSG: Record<string, string> = {
  picked_up: "تم استلام الشحنة من التاجر",
  at_hub: "الشحنة وصلت المخزن",
  out_for_delivery: "الشحنة خرجت للتسليم",
  delivered: "تم تسليم الشحنة ✅",
  partially_delivered: "تم تسليم الشحنة جزئيًا",
  delivery_failed: "تعذّر تسليم الشحنة ⚠️",
  awaiting_return: "الشحنة في طريق الإرجاع للتاجر",
  returned_to_merchant: "تم إرجاع الشحنة للتاجر",
  lost: "الشحنة اتسجّلت مفقودة",
  damaged: "الشحنة اتسجّلت تالفة",
  cancelled: "تم إلغاء الشحنة",
};

/** إشعار تغيير حالة شحنة — للتاجر والمندوب المسند (والإدارة اختياريًا) */
export async function notifyShipmentStatus(
  ex: SqlExecutor,
  input: { shipmentId: string; awb: string; toStatus: string; merchantId?: string | null; courierId?: string | null }
): Promise<void> {
  if (!(await eventEnabled(ex, `status.${input.toStatus}`))) return;
  const msg = STATUS_MSG[input.toStatus];
  if (!msg) return; // حالات داخلية مش محتاجة إشعار
  const title = `${msg}`;
  const body = `الشحنة ${input.awb}: ${msg}`;

  const recipients: string[] = [];
  if (input.merchantId) recipients.push(...(await merchantUserIds(ex, input.merchantId)));
  if (input.courierId) recipients.push(input.courierId);

  await notifyUsers(ex, {
    userIds: recipients,
    event: `status.${input.toStatus}`,
    titleAr: title,
    bodyAr: body,
    entityType: "shipment",
    entityId: input.shipmentId,
  });
}

/** إشعار دفع تسوية — للتاجر (اتحوّلك) + الإدارة (للسجل) */
export async function notifySettlementPaid(
  ex: SqlExecutor,
  input: { settlementId: string; code: string; merchantId: string; netAmount: string }
): Promise<void> {
  if (!(await eventEnabled(ex, "settlement_paid"))) return;
  const merchants = await merchantUserIds(ex, input.merchantId);
  await notifyUsers(ex, {
    userIds: merchants,
    event: "settlement_paid",
    titleAr: "تم تحويل مستحقاتك 💸",
    bodyAr: `اتحوّلك ${input.netAmount} — تسوية ${input.code}`,
    entityType: "settlement",
    entityId: input.settlementId,
  });
}

/** إشعار إسناد استلام لمندوب */
export async function notifyPickupAssigned(
  ex: SqlExecutor,
  input: { pickupId: string; code: string; courierId: string; ordersCount: number }
): Promise<void> {
  if (!(await eventEnabled(ex, "pickup_assigned"))) return;
  await notifyUsers(ex, {
    userIds: [input.courierId],
    event: "pickup_assigned",
    titleAr: "استلام جديد مسند ليك 🚚",
    bodyAr: `استلام ${input.code} — ${input.ordersCount} أوردر`,
    entityType: "pickup",
    entityId: input.pickupId,
  });
}

/** إشعار تسجيل عمولة لمندوب */
export async function notifyCommission(
  ex: SqlExecutor,
  input: { commissionId: string; code: string; courierId: string; total: string; count: number }
): Promise<void> {
  if (!(await eventEnabled(ex, "commission"))) return;
  await notifyUsers(ex, {
    userIds: [input.courierId],
    event: "commission",
    titleAr: "اتسجّلت عمولتك 🛵",
    bodyAr: `عمولة ${input.total} على ${input.count} أوردر — ${input.code}`,
    entityType: "commission",
    entityId: input.commissionId,
  });
}

/** إشعار المندوب إن مرتجعات اتحمّلت عليه عشان يرجّعها للتاجر */
export async function notifyReturnsDispatched(
  ex: SqlExecutor,
  input: { runSheetId: string; code: string; courierId: string; count: number }
): Promise<void> {
  if (!(await eventEnabled(ex, "returns_dispatched"))) return;
  await notifyUsers(ex, {
    userIds: [input.courierId],
    event: "returns_dispatched",
    titleAr: "مرتجعات اتحمّلت عليك ↩️",
    bodyAr: `${input.count} مرتجع لازم يرجّع للتاجر — كشف ${input.code}`,
    entityType: "run_sheet",
    entityId: input.runSheetId,
  });
}
