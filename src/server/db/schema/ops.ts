/**
 * ============================================================
 *  أدوات التشغيل الداخلي — مرحلة هـ
 * ------------------------------------------------------------
 *  tasks              — تكليفات داخلية، ممكن مربوطة بشحنة
 *  tickets            — تذاكر/شكاوى/طلبات العملاء + رسائلها
 *  expense_categories — بنود المصروفات (لكل بند حساب مصروف)
 *  expenses           — مصروفات فعلية (بتقيّد في الدفتر)
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
import { users, branches } from "./identity";
import { merchants } from "./merchants";
import { shipments } from "./shipments";
import { journalEntries } from "./ledger";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** task · followup · call */
    type: text("type").notNull().default("task"),
    /** low · normal · high */
    priority: text("priority").notNull().default("normal"),
    /** open · in_progress · done · cancelled */
    status: text("status").notNull().default("open"),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_code_uq").on(t.code),
    index("tasks_status_idx").on(t.status, t.priority),
    index("tasks_assignee_idx").on(t.assigneeId, t.status),
  ]
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    /** complaint · request · inquiry */
    category: text("category").notNull().default("inquiry"),
    subject: text("subject").notNull(),
    /** low · normal · high · urgent */
    priority: text("priority").notNull().default("normal"),
    /** open · pending · resolved · closed */
    status: text("status").notNull().default("open"),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    customerPhone: text("customer_phone"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_code_uq").on(t.code),
    index("tickets_status_idx").on(t.status, t.priority),
    index("tickets_merchant_idx").on(t.merchantId),
  ]
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_messages_idx").on(t.ticketId, t.createdAt)]
);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    /** كود حساب المصروف اللي بيتخصم عليه */
    accountCode: text("account_code").notNull().default("OPERATING_EXPENSE"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("expense_categories_code_uq").on(t.code)]
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    categoryId: uuid("category_id").notNull().references(() => expenseCategories.id, { onDelete: "restrict" }),
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    descriptionAr: text("description_ar").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** مرجع العربية/الموتوسيكل (نص حر لحد ما نبني الأسطول) */
    vehicleRef: text("vehicle_ref"),
    /** الدفع من: branch_cash · bank */
    paidFrom: text("paid_from").notNull().default("branch_cash"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expenses_code_uq").on(t.code),
    index("expenses_category_idx").on(t.categoryId, t.createdAt),
  ]
);
