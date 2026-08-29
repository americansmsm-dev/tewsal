/**
 * ============================================================
 *  كشوف المناديب — Run Sheets
 * ------------------------------------------------------------
 *  كشف تحميل يومي: العمليات بتفتح كشف لمندوب، تحطّ عليه شحنات
 *  في المخزن (at_hub)، وتـ«تنزّل» الكشف → كل شحنة تخرج للتسليم
 *  (out_for_delivery) عبر البوابة applyTransition (متطلب run_sheet).
 *  عند إغلاق الكشف بتتقيّد عمولة المندوب مرة واحدة على عدد
 *  الشحنات المسلَّمة (buildCommissionEntry).
 *
 *  دورة الحالة: open → dispatched → closed (أو cancelled).
 *  الشحنة ممكن تكون على أكتر من كشف عبر الزمن (لو رجعت وخرجت
 *  تاني) — فالفريد على (كشف, شحنة) مش على الشحنة لوحدها.
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
import { users, branches } from "./identity";
import { shipments } from "./shipments";
import { journalEntries } from "./ledger";

export const runSheets = pgTable(
  "run_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** open · dispatched · closed · cancelled */
    status: text("status").notNull().default("open"),
    shipmentsCount: integer("shipments_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    /** إجمالي عمولة المندوب المقيّدة عند الإغلاق */
    commissionP: bigint("commission_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** قيد العمولة (بيتقيّد مرة واحدة عند الإغلاق) */
    commissionEntryId: uuid("commission_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("run_sheets_code_uq").on(t.code),
    index("run_sheets_courier_idx").on(t.courierId, t.status),
    index("run_sheets_status_idx").on(t.status, t.createdAt),
  ]
);

export const runSheetItems = pgTable(
  "run_sheet_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runSheetId: uuid("run_sheet_id")
      .notNull()
      .references(() => runSheets.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
  },
  (t) => [
    // الشحنة مرة واحدة بس على نفس الكشف
    uniqueIndex("run_sheet_items_uq").on(t.runSheetId, t.shipmentId),
    index("run_sheet_items_shipment_idx").on(t.shipmentId),
  ]
);
