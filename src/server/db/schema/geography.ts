/**
 * ============================================================
 *  الجغرافيا — المناطق والمحافظات والمساحات
 * ------------------------------------------------------------
 *  ٤ مستويات:
 *    منطقة تسعير (zone) → محافظة → منطقة فرعية (area) → علامة مميزة
 *
 *  ⚠️ مبدأ أساسي (طلب صريح من العميل):
 *     كل حاجة هنا **قابلة للإضافة والتعديل من الشاشة** —
 *     مناطق جديدة، أسعار، عمولات، تغطية المناديب.
 *     مفيش حاجة متحطوطة في الكود.
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

/**
 * منطقة التسعير — بتحدد السعر و SLA
 * البذور: cairo_giza · delta_canal · saeed_redsea
 * العميل يقدر يضيف مناطق جديدة من الشاشة.
 */
export const zones = pgTable(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    /** مدة التسليم بساعات العمل (للقاهرة والإسكندرية: 48) */
    slaWorkingHours: integer("sla_working_hours"),
    /** أو بأيام العمل (لباقي المحافظات: 4-5) */
    slaWorkingDaysMin: integer("sla_working_days_min"),
    slaWorkingDaysMax: integer("sla_working_days_max"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("zones_code_uq").on(t.code)]
);

/**
 * المحافظة — ٢٧ محافظة مصرية
 * كل محافظة مربوطة بمنطقة تسعير.
 *
 * ⚠️ الإسكندرية صف مستقل مربوط بـ delta_canal (قرار ٢) —
 *    تقدر تنقلها لمنطقة تانية بتغيير zone_id بس، بدون هجرة.
 */
export const governorates = pgTable(
  "governorates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    /** بنخدم المحافظة دي؟ لو لأ، التاجر مش هيقدر يعمل عليها شحنة */
    isServed: boolean("is_served").notNull().default(true),
    /** تجاوز SLA المنطقة — الإسكندرية ٤٨ ساعة رغم إنها دلتا */
    slaOverrideHours: integer("sla_override_hours"),
    /** خدمات التحصيل والمرتجعات متاحة هنا؟ (القاهرة/الجيزة/الإسكندرية) */
    codEnabled: boolean("cod_enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("governorates_code_uq").on(t.code),
    index("governorates_zone_idx").on(t.zoneId),
  ]
);

/**
 * المنطقة الفرعية — الحي أو المركز
 * دي اللي بتحدد تغطية المندوب والفرز الفعلي.
 * بتتضاف تدريجيًا مع الشغل — العميل بيضيفها من الشاشة.
 */
export const areas = pgTable(
  "areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    governorateId: uuid("governorate_id")
      .notNull()
      .references(() => governorates.id, { onDelete: "restrict" }),
    nameAr: text("name_ar").notNull(),
    isServed: boolean("is_served").notNull().default(true),
    /** منطقة نائية؟ بتاخد رسم إضافي و SLA أطول */
    isRemote: boolean("is_remote").notNull().default(false),
    /** رسم إضافي للمنطقة النائية بالقروش */
    remoteSurchargeP: integer("remote_surcharge_p").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("areas_gov_idx").on(t.governorateId),
    uniqueIndex("areas_gov_name_uq").on(t.governorateId, t.nameAr),
  ]
);

/**
 * أيام العطلات الرسمية — بتدخل في حساب الـ SLA
 * «٤٨ ساعة عمل» مش معناها +48 ساعة على الساعة —
 * لازم نتخطى الجمع والأعياد.
 */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** التاريخ بصيغة YYYY-MM-DD */
    date: text("date").notNull(),
    nameAr: text("name_ar").notNull(),
    /** أحيانًا بنشتغل في العطلة — الحقل ده بيسمح بده */
    isWorkingDay: boolean("is_working_day").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("holidays_date_uq").on(t.date)]
);

/**
 * ساعات العمل الأسبوعية — 0=الأحد … 6=السبت
 * بتحدد إمتى «ساعة العمل» بتتحسب في الـ SLA.
 */
export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayOfWeek: integer("day_of_week").notNull(),
    openTime: text("open_time"),
    closeTime: text("close_time"),
    isWorkingDay: boolean("is_working_day").notNull().default(true),
  },
  (t) => [uniqueIndex("working_hours_dow_uq").on(t.dayOfWeek)]
);
