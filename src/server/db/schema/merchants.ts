/**
 * ============================================================
 *  التجار
 * ------------------------------------------------------------
 *  الإدارة هي اللي بتفتح حساب التاجر (مفيش تسجيل ذاتي — قرار
 *  في الخطة). الشريحة بتحدد السعر، وقابلة للتعديل يدويًا أو
 *  تلقائيًا من عدد شحنات الشهر اللي فات (computeTier).
 *
 *  ⚠️ ده الحد الأدنى اللي يخلّي إنشاء الشحنة والتسوية يشتغلوا.
 *     الوثائق والعقود والمحافظ بتتضاف في مرحلة التجار الكاملة.
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** كود مقروء زي M-0142 */
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    /** مطبّع لـ 01XXXXXXXXX */
    phone: text("phone"),
    email: text("email"),
    /** t1 · t2 · t3 — بتحدد السعر */
    tier: text("tier").notNull().default("t1"),
    /** التاجر ده بيستخدم خدمة التحصيل؟ */
    codEnabled: boolean("cod_enabled").notNull().default(true),
    /** مين بيتحمّل الشحن افتراضيًا: merchant · customer */
    defaultShippingPayer: text("default_shipping_payer").notNull().default("merchant"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchants_code_uq").on(t.code),
    index("merchants_phone_idx").on(t.phone),
    index("merchants_active_idx").on(t.isActive),
  ]
);
