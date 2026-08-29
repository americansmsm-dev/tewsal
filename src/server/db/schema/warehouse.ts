/**
 * ============================================================
 *  المخزن وتعدد الفروع — مرحلة و
 * ------------------------------------------------------------
 *  inventory_counts + scans — الجرد بالباركود (مطابقة الموجود بالنظام)
 *  transfer_sheets + items  — شيتات السفر (تحويل شحنات بين الفروع)
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users, branches } from "./identity";
import { shipments } from "./shipments";

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** open · closed */
    status: text("status").notNull().default("open"),
    expectedCount: integer("expected_count").notNull().default(0),
    countedCount: integer("counted_count").notNull().default(0),
    missingCount: integer("missing_count").notNull().default(0),
    unexpectedCount: integer("unexpected_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_counts_code_uq").on(t.code),
    index("inventory_counts_status_idx").on(t.status),
  ]
);

export const inventoryCountScans = pgTable(
  "inventory_count_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id").notNull().references(() => inventoryCounts.id, { onDelete: "cascade" }),
    awb: text("awb").notNull(),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    /** matched · unexpected */
    result: text("result").notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_count_scans_uq").on(t.countId, t.awb)]
);

export const transferSheets = pgTable(
  "transfer_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    fromBranchId: uuid("from_branch_id").references(() => branches.id, { onDelete: "set null" }),
    toBranchId: uuid("to_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    /** open · dispatched · received · cancelled */
    status: text("status").notNull().default("open"),
    shipmentsCount: integer("shipments_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transfer_sheets_code_uq").on(t.code),
    index("transfer_sheets_status_idx").on(t.status),
  ]
);

export const transferSheetItems = pgTable(
  "transfer_sheet_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferSheetId: uuid("transfer_sheet_id").notNull().references(() => transferSheets.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("transfer_sheet_items_uq").on(t.transferSheetId, t.shipmentId)]
);
