/**
 * ============================================================
 *  المطالبات والتعويض — Claims
 * ------------------------------------------------------------
 *  لما شحنة تبقى مفقودة/تالفة (lost/damaged — super_admin فقط)
 *  بتتفتح **مطالبة** تلقائيًا (بدون قيد مالي فوري). المالية
 *  بتراجعها وتعتمدها → يتقيّد التعويض للتاجر بحد:
 *    min(القيمة المعلنة, compensation.max_p = 600 ج)
 *
 *  ⚠️ ممنوع التعويض لو الشحنة قابلة للكسر (is_fragile) ومش
 *     مؤمّنة (fragile_insured) — إلا بتجاوز صريح من super_admin.
 *
 *  دورة الحالة: open → approved (بقيد) · أو → rejected.
 *  مطالبة واحدة لكل شحنة (فهرس فريد).
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { merchants } from "./merchants";
import { shipments } from "./shipments";
import { journalEntries } from "./ledger";

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    awb: text("awb").notNull(),
    /** lost · damaged */
    type: text("type").notNull(),
    /** open · approved · rejected */
    status: text("status").notNull().default("open"),
    /** القيمة المعلنة وقت الفقد */
    declaredValueP: bigint("declared_value_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** التعويض المقترح = min(المعلنة, الحد) */
    suggestedAmountP: bigint("suggested_amount_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** التعويض المعتمد فعلًا (بعد المراجعة) */
    approvedAmountP: bigint("approved_amount_p", { mode: "bigint" }),
    isFragile: boolean("is_fragile").notNull().default(false),
    fragileInsured: boolean("fragile_insured").notNull().default(false),
    /** قابلة للكسر ومش مؤمّنة → محظور إلا بتجاوز */
    fragileBlocked: boolean("fragile_blocked").notNull().default(false),
    /** قيد التعويض (بيتقيّد مرة واحدة عند الاعتماد) */
    compensationEntryId: uuid("compensation_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    rejectReason: text("reject_reason"),
    notes: text("notes"),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("claims_code_uq").on(t.code),
    // مطالبة واحدة لكل شحنة
    uniqueIndex("claims_shipment_uq").on(t.shipmentId),
    index("claims_status_idx").on(t.status, t.createdAt),
    index("claims_merchant_idx").on(t.merchantId),
  ]
);
