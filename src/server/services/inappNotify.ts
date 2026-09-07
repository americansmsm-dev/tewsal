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
  /**
   * ينتظر إرسال الدفع للأجهزة قبل ما يرجّع.
   * **للسكربتات القصيرة بس** (باك أب · فحوصات ليلية) — لأنها
   * بتقفل الاتصال وتخرج على طول. الـAPI بيسيبه فاير-آند-فورجت.
   */
  awaitPush?: boolean;
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
      AND NOT EXISTS (
        SELECT 1 FROM notification_prefs p
        WHERE p.user_id = u.id AND p.channel = 'inapp' AND p.enabled = false
          AND p.event IN (${input.event}, '*')
      )
    RETURNING user_id::text AS user_id
  `);
  const reached = rowsOf<{ user_id: string }>(res).map((r) => r.user_id);

  // ⚠️ الدفع للأجهزة **بعد** ما الصف اتكتب. في الـAPI بيمشي من
  //    غير انتظار — الإشعار عمره ما يوقّف عملية شغل. ولو الدفع
  //    مش متظبط (مفيش مفاتيح VAPID) الدالة بترجع من غير ما تعمل حاجة.
  //
  //    ⚠️ لكن في **السكربتات** لازم ننتظر: السكربت بيقفل الاتصال
  //    ويخرج فورًا، فالفان-آوت اللي لسه شغّال بيقع بـ
  //    CONNECTION_ENDED والإشعار مايوصلش الأجهزة. عشان كده
  //    awaitPush.
  if (reached.length > 0) {
    const fanout = pushToUsers(ex, reached, {
      event: input.event,
      title: input.titleAr,
      body: input.bodyAr,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    }).catch((err) => {
      console.error("[push] فان-آوت فشل:", err instanceof Error ? err.message : err);
      return 0;
    });
    if (input.awaitPush) await fanout;
    else void fanout;
  }
  return reached.length;
}

/** الرابط اللي الإشعار بيفتحه لما المستخدم يدوس عليه */
function targetUrl(entityType: string | null, entityId: string | null): string {
  if (!entityId) return "/notifications";
  switch (entityType) {
    case "shipment": return `/shipments/${entityId}`;
    case "settlement": return `/settlements`;
    case "pickup": return `/pickups`;
    case "run_sheet": return `/runsheets`;
    case "claim": return `/claims`;
    default: return "/notifications";
  }
}

/** أحداث بتقعد فوق لحد ما تتقرا — فلوس أو حاجة بتوقف الشغل */
const URGENT_EVENTS = new Set([
  "settlement_paid", "settlement_approved", "wallet_low",
  "returns_dispatched", "cash_over_limit", "emergency_mode",
  "backup_failed", "nightly_check_failed",
]);

/**
 * بيبعت الإشعار لأجهزة المستخدمين (فون · لاب · تاب).
 * الاشتراك اللي بيرد ٤٠٤/٤١٠ بيتشال — الأجهزة الميتة بتتنضّف لوحدها.
 */
export async function pushToUsers(
  ex: SqlExecutor,
  userIds: string[],
  msg: { event: string; title: string; body: string; entityType: string | null; entityId: string | null }
): Promise<number> {
  const { isPushConfigured, sendToSubscriptions } = await import("@/lib/push");
  if (!isPushConfigured() || userIds.length === 0) return 0;

  const idArr = sql`ARRAY[${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const subs = rowsOf<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    await ex.execute(sql`
      SELECT s.id::text, s.endpoint, s.p256dh, s.auth
      FROM push_subscriptions s
      WHERE s.user_id = ANY(${idArr})
        AND NOT EXISTS (
          SELECT 1 FROM notification_prefs p
          WHERE p.user_id = s.user_id AND p.channel = 'push' AND p.enabled = false
            AND p.event IN (${msg.event}, '*')
        )
    `)
  );
  if (subs.length === 0) return 0;

  const results = await sendToSubscriptions(subs, {
    title: msg.title,
    body: msg.body,
    url: targetUrl(msg.entityType, msg.entityId),
    tag: msg.entityId ? `${msg.entityType}:${msg.entityId}` : msg.event,
    urgent: URGENT_EVENTS.has(msg.event),
  });

  const dead = results.filter((r) => r.gone).map((r) => r.subscriptionId);
  if (dead.length > 0) {
    await ex.execute(sql`
      DELETE FROM push_subscriptions
      WHERE id = ANY(${sql`ARRAY[${sql.join(dead.map((id) => sql`${id}::uuid`), sql`, `)}]`})
    `);
  }
  const ok = results.filter((r) => r.ok).map((r) => r.subscriptionId);
  if (ok.length > 0) {
    await ex.execute(sql`
      UPDATE push_subscriptions SET last_seen_at = now(), failed_at = NULL
      WHERE id = ANY(${sql`ARRAY[${sql.join(ok.map((id) => sql`${id}::uuid`), sql`, `)}]`})
    `);
  }
  return ok.length;
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

/** تسوية اتعملت — للتاجر (مستحقاتك اتحسبت) والمالية (مستنية اعتماد) */
export async function notifySettlementCreated(
  ex: SqlExecutor,
  input: { settlementId: string; code: string; merchantId: string; netAmount: string; itemCount: number }
): Promise<void> {
  if (!(await eventEnabled(ex, "settlement_created"))) return;
  await notifyUsers(ex, {
    userIds: await merchantUserIds(ex, input.merchantId),
    event: "settlement_created",
    titleAr: "اتعملت تسوية لمستحقاتك 🧾",
    bodyAr: `تسوية ${input.code} — ${input.itemCount} شحنة بصافي ${input.netAmount}`,
    entityType: "settlement",
    entityId: input.settlementId,
  });
  await notifyUsers(ex, {
    userIds: await adminUserIds(ex),
    event: "settlement_pending_approval",
    titleAr: "تسوية مستنية اعتماد ⏳",
    bodyAr: `${input.code} — صافي ${input.netAmount}`,
    entityType: "settlement",
    entityId: input.settlementId,
  });
}

/** تسوية اتعتمدت — للتاجر (جاهزة للتحويل) */
export async function notifySettlementApproved(
  ex: SqlExecutor,
  input: { settlementId: string; code: string; merchantId: string }
): Promise<void> {
  if (!(await eventEnabled(ex, "settlement_approved"))) return;
  await notifyUsers(ex, {
    userIds: await merchantUserIds(ex, input.merchantId),
    event: "settlement_approved",
    titleAr: "تسويتك اتعتمدت ✅",
    bodyAr: `تسوية ${input.code} اتعتمدت وجاهزة للتحويل`,
    entityType: "settlement",
    entityId: input.settlementId,
  });
}

/** شحن محفظة التاجر */
export async function notifyWalletTopup(
  ex: SqlExecutor,
  input: { merchantId: string; amount: string; balance: string }
): Promise<void> {
  if (!(await eventEnabled(ex, "wallet_topup"))) return;
  await notifyUsers(ex, {
    userIds: await merchantUserIds(ex, input.merchantId),
    event: "wallet_topup",
    titleAr: "اتشحنت محفظتك 💳",
    bodyAr: `اتضاف ${input.amount} — الرصيد المتاح ${input.balance}`,
    entityType: "merchant",
    entityId: input.merchantId,
  });
}

/** مطالبة اتفتحت — للمالية والإدارة */
export async function notifyClaimOpened(
  ex: SqlExecutor,
  input: { claimId: string; code: string; awb: string; merchantId: string }
): Promise<void> {
  if (!(await eventEnabled(ex, "claim_opened"))) return;
  await notifyUsers(ex, {
    userIds: [...(await adminUserIds(ex)), ...(await usersByRole(ex, "accountant"))],
    event: "claim_opened",
    titleAr: "مطالبة جديدة اتفتحت 📩",
    bodyAr: `${input.code} على الشحنة ${input.awb}`,
    entityType: "claim",
    entityId: input.claimId,
  });
}

/** مطالبة اتحلّت — للتاجر */
export async function notifyClaimResolved(
  ex: SqlExecutor,
  input: { claimId: string; code: string; merchantId: string; outcome: string; amount?: string | null }
): Promise<void> {
  if (!(await eventEnabled(ex, "claim_resolved"))) return;
  await notifyUsers(ex, {
    userIds: await merchantUserIds(ex, input.merchantId),
    event: "claim_resolved",
    titleAr: "مطالبتك اتحلّت",
    bodyAr: input.amount
      ? `${input.code}: ${input.outcome} — تعويض ${input.amount}`
      : `${input.code}: ${input.outcome}`,
    entityType: "claim",
    entityId: input.claimId,
  });
}

/** عهدة المندوب اتأكدت — للمندوب (خلاص مابقاش عليك كاش) */
export async function notifyHandoverConfirmed(
  ex: SqlExecutor,
  input: { handoverId: string; code: string; courierId: string; amount: string; shortfall?: string | null }
): Promise<void> {
  if (!(await eventEnabled(ex, "handover_confirmed"))) return;
  await notifyUsers(ex, {
    userIds: [input.courierId],
    event: "handover_confirmed",
    titleAr: "عهدتك اتسلّمت ✅",
    bodyAr: input.shortfall
      ? `${input.code}: اتسلّم ${input.amount} — عجز ${input.shortfall} هيتخصم`
      : `${input.code}: اتسلّم ${input.amount} بالكامل`,
    entityType: "handover",
    entityId: input.handoverId,
  });
}

/** كشف توصيل نزل على مندوب */
export async function notifyRunSheetDispatched(
  ex: SqlExecutor,
  input: { runSheetId: string; code: string; courierId: string; count: number }
): Promise<void> {
  if (!(await eventEnabled(ex, "runsheet_dispatched"))) return;
  await notifyUsers(ex, {
    userIds: [input.courierId],
    event: "runsheet_dispatched",
    titleAr: "كشف توصيل نزل ليك 📦",
    bodyAr: `${input.count} شحنة للتسليم — كشف ${input.code}`,
    entityType: "run_sheet",
    entityId: input.runSheetId,
  });
}

/**
 * تنبيه تشغيلي للإدارة (باك أب · فحص ليلي · وضع الطوارئ).
 * بيتنادى من السكربتات المجدولة — عشان السكوت مايتقريش نجاح.
 */
export async function notifyOps(
  ex: SqlExecutor,
  input: { event: string; titleAr: string; bodyAr: string }
): Promise<void> {
  if (!(await eventEnabled(ex, input.event))) return;
  await notifyUsers(ex, {
    userIds: await adminUserIds(ex),
    event: input.event,
    titleAr: input.titleAr,
    bodyAr: input.bodyAr,
    entityType: null,
    entityId: null,
    // بيتنده من السكربتات المجدولة — لازم ننتظر الدفع قبل الخروج
    awaitPush: true,
  });
}
