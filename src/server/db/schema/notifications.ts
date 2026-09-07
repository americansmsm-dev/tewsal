/**
 * ============================================================
 *  الإشعارات والتواصل — مرحلة د
 * ------------------------------------------------------------
 *  notification_templates — قوالب تتعدّل من الشاشة بدون نشر
 *  notification_log       — سجل كل إشعار بالتكلفة والحالة
 *  delivery_ratings       — تقييم العميل بعد التسليم (NPS)
 *  push_subscriptions     — أجهزة المستخدم (فون + لاب + تاب)
 *  notification_prefs     — إيقاف حدث/قناة لمستخدم بعينه
 *
 *  الحد اليومي لكل تاجر بيتحسب من السجل + إعداد عام.
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants";
import { shipments } from "./shipments";
import { users } from "./identity";

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** مفتاح الحدث: out_for_delivery · delivered · delivery_failed ... */
    key: text("key").notNull(),
    /** whatsapp · sms */
    channel: text("channel").notNull().default("whatsapp"),
    bodyAr: text("body_ar").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_templates_key_uq").on(t.key, t.channel)]
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("whatsapp"),
    toPhone: text("to_phone").notNull(),
    event: text("event").notNull(),
    body: text("body").notNull(),
    /** sent · simulated · failed · blocked_limit */
    status: text("status").notNull(),
    costP: bigint("cost_p", { mode: "bigint" }).notNull().default(sql`0`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_log_merchant_idx").on(t.merchantId, t.createdAt),
    index("notification_log_shipment_idx").on(t.shipmentId),
  ]
);

/**
 * الإشعارات الداخلية — لكل مستخدم (مندوب/تاجر/إدارة).
 * مختلفة عن notification_log (اللي للعميل عبر واتساب) — دي صندوق وارد
 * جوّه السيستم بيتقرا بالجرس والبولنج.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** المستلم */
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** دور المستلم وقت الإرسال (للفلترة والعرض) */
    role: text("role").notNull(),
    /** نوع الحدث: status_change · settlement_paid · pickup_assigned · commission · manual ... */
    event: text("event").notNull(),
    titleAr: text("title_ar").notNull(),
    bodyAr: text("body_ar").notNull(),
    /** ربط بكيان (shipment · settlement · pickup ...) للفتح المباشر */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    isRead: boolean("is_read").notNull().default(false),
    /** لو الإشعار متبعت يدويًا — مين بعته */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.isRead, t.createdAt)]
);

export const deliveryRatings = pgTable(
  "delivery_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("delivery_ratings_shipment_uq").on(t.shipmentId)]
);

/**
 * أجهزة المستخدم للإشعارات — **الواحد ليه كذا جهاز**.
 * المفتاح الفريد هو الـendpoint اللي المتصفح بيديه، مش المستخدم.
 * الاشتراك بيموت بصمت (شال التطبيق · مسح البيانات) — خدمة الدفع
 * بترد ٤٠٤/٤١٠ ساعتها وإحنا بنشيل الصف.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    /** اسم بيظهر للمستخدم: «فون سامسونج» / «لاب الشغل» */
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** أول فشل متتالي — بيتصفّر مع أول نجاح */
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ]
);

/**
 * تفضيلات الإشعارات. **غياب الصف = مفعّل** — الصف بيتكتب بس لما
 * المستخدم يقفل حاجة. كده أي حدث جديد بيشتغل لوحده من غير ما
 * نلمس صفوف قديمة.
 */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** اسم الحدث أو '*' لكل الأحداث */
    event: text("event").notNull(),
    /** 'inapp' جوّه السيستم · 'push' على الجهاز */
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event, t.channel] })]
);
