/**
 * ============================================================
 *  الإشعارات والتواصل — مرحلة د
 * ------------------------------------------------------------
 *  notification_templates — قوالب تتعدّل من الشاشة بدون نشر
 *  notification_log       — سجل كل إشعار بالتكلفة والحالة
 *  delivery_ratings       — تقييم العميل بعد التسليم (NPS)
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants";
import { shipments } from "./shipments";

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
