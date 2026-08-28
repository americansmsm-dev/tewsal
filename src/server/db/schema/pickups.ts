/**
 * ============================================================
 *  طلبات الاستلام من التجار — Pickups
 * ------------------------------------------------------------
 *  التاجر يطلب استلام لأي عدد أوردرات؛ أقل من الحد المجاني
 *  (settings['pickup.free_threshold']) عليه رسم خدمة ٥٠ ج
 *  (fee PICKUP_SERVICE) بيتقيّد عند تأكيد الاستلام — قرار ١٠.
 *
 *  دورة الحالة: requested → assigned → collected (أو cancelled).
 *  كل شحنة في طلب استلام واحد بس (فهرس فريد).
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { merchants } from "./merchants";
import { governorates } from "./geography";
import { shipments } from "./shipments";
import { journalEntries } from "./ledger";

export const pickups = pgTable(
  "pickups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    pickupAddress: text("pickup_address").notNull(),
    governorateId: uuid("governorate_id").references(() => governorates.id, { onDelete: "set null" }),
    contactPhone: text("contact_phone"),
    /** YYYY-MM-DD */
    scheduledDate: text("scheduled_date"),
    /** morning · evening */
    timeWindow: text("time_window"),
    courierId: uuid("courier_id").references(() => users.id, { onDelete: "set null" }),
    /** requested · assigned · collected · cancelled */
    status: text("status").notNull().default("requested"),
    ordersCount: integer("orders_count").notNull().default(0),
    /** رسم خدمة الاستلام المحسوب (٠ لو ضمن الحد المجاني) */
    serviceFeeP: bigint("service_fee_p", { mode: "bigint" }).notNull().default(sql`0`),
    notes: text("notes"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** قيد رسم الاستلام لو اتحاسب */
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pickups_code_uq").on(t.code),
    index("pickups_merchant_idx").on(t.merchantId, t.createdAt),
    index("pickups_status_idx").on(t.status, t.scheduledDate),
    index("pickups_courier_idx").on(t.courierId, t.status),
  ]
);

export const pickupShipments = pgTable(
  "pickup_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pickupId: uuid("pickup_id")
      .notNull()
      .references(() => pickups.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
  },
  (t) => [
    // ⚠️ الشحنة في طلب استلام واحد بس
    uniqueIndex("pickup_shipments_shipment_uq").on(t.shipmentId),
    index("pickup_shipments_pickup_idx").on(t.pickupId),
  ]
);
