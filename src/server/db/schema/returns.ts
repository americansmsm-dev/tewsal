/**
 * ============================================================
 *  دورة المرتجعات المفصّلة — Returns
 * ------------------------------------------------------------
 *  طبقة **فوق** آلة الحالات: الشحنة اللي بتدخل awaiting_return
 *  بتتحط على **رف مرتجعات** فيزيائي، بتشيخ هناك، وبتتصعّد
 *  (returns.escalate_after_days = [14, 30]). لو التاجر مستلمهاش
 *  بعد المدة، مدير النظام بيوافق على **إتلافها** (disposed).
 *
 *  ⚠️ حالة الشحنة نفسها هي مصدر الحقيقة (awaiting_return →
 *     out_for_return → returned_to_merchant / disposed). الجدول
 *     ده **إثراء** بس: الرف اللي عليه + وقت الدخول + بيانات
 *     الإتلاف. العمر والتصعيد بيتحسبوا من shipments.status_updated_at.
 *
 *  return_shelves — رفوف المخزن الفيزيائية (يقدر يضيفها من الشاشة).
 *  returns        — سجل المرتجعات، صف واحد لكل شحنة (فهرس فريد).
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users, branches } from "./identity";
import { merchants } from "./merchants";
import { shipments } from "./shipments";

/** رفوف المرتجعات الفيزيائية في المخزن */
export const returnShelves = pgTable(
  "return_shelves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** كود الرف — زي RS-A1 أو «رف ١» */
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    /** سعة الرف (اختياري — للعرض والتنبيه) */
    capacity: integer("capacity"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("return_shelves_code_uq").on(t.code),
    index("return_shelves_active_idx").on(t.isActive),
  ]
);

/** سجل المرتجعات — صف واحد لكل شحنة دخلت دورة المرتجعات */
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    awb: text("awb").notNull(),
    /** الرف اللي المرتجع عليه دلوقتي — null يعني لسه ما اتحطّش */
    shelfId: uuid("shelf_id").references(() => returnShelves.id, { onDelete: "set null" }),
    /** أول لحظة دخل فيها المرتجع — للعرض في السجل */
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    /** اتسلّم للتاجر */
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    /** اتأتلف بعد المدة (بموافقة مدير النظام) */
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    disposalReason: text("disposal_reason"),
    disposalApprovedBy: uuid("disposal_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // مرتجع واحد لكل شحنة
    uniqueIndex("returns_shipment_uq").on(t.shipmentId),
    index("returns_merchant_idx").on(t.merchantId),
    index("returns_shelf_idx").on(t.shelfId),
    index("returns_entered_idx").on(t.enteredAt),
  ]
);
