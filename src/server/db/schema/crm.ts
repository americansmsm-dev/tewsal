/**
 * ============================================================
 *  CRM التاجر والعميل — مرحلة ج
 * ------------------------------------------------------------
 *  customer_blacklist       — أرقام عملاء ممنوعة (رفض متكرر...)
 *  merchant_point_events     — حركة نقاط الولاء (الرصيد على merchants.points)
 *  merchant_pickup_addresses — عناوين استلام متعددة لكل تاجر
 *  merchant_documents        — وثائق التاجر بتواريخ انتهاء وتنبيهات
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { merchants } from "./merchants";
import { governorates } from "./geography";

/** قائمة سوداء لأرقام العملاء */
export const customerBlacklist = pgTable(
  "customer_blacklist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** مطبّع 01XXXXXXXXX */
    phone: text("phone").notNull(),
    reasonAr: text("reason_ar").notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_blacklist_phone_uq").on(t.phone)]
);

/** حركة نقاط الولاء — الرصيد المخزّن على merchants.points */
export const merchantPointEvents = pgTable(
  "merchant_point_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    /** موجب = اكتساب · سالب = استبدال */
    delta: bigint("delta", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    reasonAr: text("reason_ar").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchant_point_events_idx").on(t.merchantId, t.createdAt)]
);

/** عناوين استلام متعددة للتاجر (الراسل الفرعي) */
export const merchantPickupAddresses = pgTable(
  "merchant_pickup_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: text("address").notNull(),
    governorateId: uuid("governorate_id").references(() => governorates.id, { onDelete: "set null" }),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchant_pickup_addresses_idx").on(t.merchantId, t.isActive)]
);

/** وثائق التاجر بتواريخ انتهاء */
export const merchantDocuments = pgTable(
  "merchant_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    /** national_id · commercial_register · tax_card · contract */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    r2Key: text("r2_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchant_documents_idx").on(t.merchantId, t.expiresAt)]
);
