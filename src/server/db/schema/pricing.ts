/**
 * ============================================================
 *  التسعير والرسوم
 * ------------------------------------------------------------
 *  ⚠️ مبدأين أساسيين:
 *
 *  ١) **قوائم الأسعار بإصدارات** — القائمة اللي اتستعملت في
 *     شحنة عمرها ما تتعدّل. أي تغيير = قائمة جديدة بتاريخ
 *     سريان. ده اللي بيمنع إن تعديل سعر النهاردة يغيّر
 *     تسوية التاجر بتاعة الأسبوع اللي فات.
 *
 *  ٢) **كل حاجة قابلة للتعديل من الشاشة** (طلب العميل) —
 *     أسعار، رسوم، عمولات، مناطق جديدة. بدون نشر.
 *
 *  كل المبالغ bigint بالقروش بلاحقة _p.
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
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { zones, governorates } from "./geography";

/** شرائح حجم التاجر الشهري */
export const MERCHANT_TIERS = ["t1", "t2", "t3"] as const;
export type MerchantTier = (typeof MERCHANT_TIERS)[number];

export const TIER_LABELS_AR: Record<MerchantTier, string> = {
  t1: "أقل من ١٠٠ شحنة",
  t2: "من ١٠٠ إلى ٤٠٠ شحنة",
  t3: "أكتر من ٤٠٠ شحنة",
};

/**
 * قائمة أسعار — بإصدار وتاريخ سريان.
 * القائمة اللي اتربطت بشحنة **متتعدلش أبدًا**.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** global = للكل · merchant = مخصصة لتاجر */
    scope: text("scope").notNull().default("global"),
    merchantId: uuid("merchant_id"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_lists_scope_idx").on(t.scope, t.isActive),
    index("price_lists_merchant_idx").on(t.merchantId),
  ]
);

/**
 * بنود القائمة: سعر لكل (منطقة × شريحة)
 * البذور من pricing-data.js:
 *   القاهرة والجيزة    90 / 80 / 70
 *   الدلتا والقناة     110 / 100 / 90   (والإسكندرية معاها — قرار ٢)
 *   الصعيد والبحر الأحمر 150 / 135 / 125
 */
export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    tier: text("tier").notNull(),
    priceP: bigint("price_p", { mode: "bigint" }).notNull(),
  },
  (t) => [uniqueIndex("price_list_items_uq").on(t.priceListId, t.zoneId, t.tier)]
);

/** سعر خاص لتاجر في منطقة معيّنة — بيتفوق على قائمة الأسعار */
export const merchantPriceOverrides = pgTable(
  "merchant_price_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    /** لو null = ينطبق على كل الشرائح */
    tier: text("tier"),
    priceP: bigint("price_p", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    reason: text("reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchant_price_ovr_idx").on(t.merchantId, t.zoneId)]
);

/**
 * تعريفات الرسوم — كل رسم في السيستم متعرّف هنا،
 * وقابل للتعديل من شاشة الإعدادات.
 */
export const feeDefinitions = pgTable(
  "fee_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    /** flat = مبلغ ثابت · per_unit = لكل وحدة · percent = نسبة · flat_plus_percent */
    calcType: text("calc_type").notNull(),
    /** المبلغ الثابت بالقروش */
    valueP: bigint("value_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** النسبة بنقاط الأساس (1% = 100) */
    percentBp: integer("percent_bp").notNull().default(0),
    /** الحد اللي فوقه بتتحسب النسبة (بالقروش) */
    thresholdP: bigint("threshold_p", { mode: "bigint" }).notNull().default(sql`0`),
    /**
     * النسبة بتتحسب على إيه؟
     * full_amount = المبلغ كله  ← قرار العميل رقم ١
     * excess_over_threshold = الزيادة فوق الحد بس
     */
    basis: text("basis").notNull().default("full_amount"),
    /** بينطبق على إيه: shipment · payout · pickup */
    appliesTo: text("applies_to").notNull().default("shipment"),
    /** بيتحسب تلقائي ولا بيتضاف يدوي؟ */
    isAuto: boolean("is_auto").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fee_definitions_code_uq").on(t.code)]
);

/**
 * تجاوز رسم لمنطقة معيّنة.
 * مثال (قرار ٧): المرتجع ١٠٠ ج في القاهرة/الجيزة/الإسكندرية
 *                و ٦٥ ج في باقي المحافظات.
 */
export const feeZoneOverrides = pgTable(
  "fee_zone_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feeCode: text("fee_code").notNull(),
    /** إما منطقة تسعير أو محافظة بعينها */
    zoneId: uuid("zone_id").references(() => zones.id, { onDelete: "cascade" }),
    governorateId: uuid("governorate_id").references(() => governorates.id, {
      onDelete: "cascade",
    }),
    valueP: bigint("value_p", { mode: "bigint" }).notNull(),
    percentBp: integer("percent_bp"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fee_zone_ovr_code_idx").on(t.feeCode),
    index("fee_zone_ovr_zone_idx").on(t.zoneId),
    index("fee_zone_ovr_gov_idx").on(t.governorateId),
  ]
);

/** تجاوز رسم لتاجر معيّن (اتفاق خاص) */
export const merchantFeeOverrides = pgTable(
  "merchant_fee_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull(),
    feeCode: text("fee_code").notNull(),
    valueP: bigint("value_p", { mode: "bigint" }),
    percentBp: integer("percent_bp"),
    thresholdP: bigint("threshold_p", { mode: "bigint" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    reason: text("reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_fee_ovr_uq").on(t.merchantId, t.feeCode, t.effectiveFrom)]
);

/**
 * قواعد عمولة المندوب — قرار ٩
 * الافتراضي: ٥٠ ج لكل شحنة مُسلَّمة، أي منطقة.
 * قابلة للتعديل لكل منطقة ولكل مندوب.
 */
export const courierCommissionRules = pgTable(
  "courier_commission_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = القاعدة الافتراضية للكل */
    courierId: uuid("courier_id"),
    zoneId: uuid("zone_id").references(() => zones.id, { onDelete: "cascade" }),
    governorateId: uuid("governorate_id").references(() => governorates.id, {
      onDelete: "cascade",
    }),
    /** per_delivery = لكل شحنة · per_pickup · daily_target · success_rate */
    basis: text("basis").notNull().default("per_delivery"),
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    /** شروط إضافية (هدف يومي، نسبة نجاح...) */
    conditions: jsonb("conditions"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commission_courier_idx").on(t.courierId),
    index("commission_zone_idx").on(t.zoneId),
    index("commission_active_idx").on(t.isActive, t.priority),
  ]
);

/**
 * الإعدادات العامة — كل قاعدة عمل قابلة للتعديل بدون نشر.
 * القيمة jsonb عشان تستحمل أرقام ونصوص ومصفوفات.
 */
export const settings = pgTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    nameAr: text("name_ar").notNull(),
    description: text("description"),
    /** التصنيف في شاشة الإعدادات */
    category: text("category").notNull().default("general"),
    /** نوع القيمة للتحقق في الواجهة: number · money · string · boolean · array */
    valueType: text("value_type").notNull().default("string"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settings_category_idx").on(t.category)]
);
