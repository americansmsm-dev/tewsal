/**
 * ============================================================
 *  الشحنات — قلب السيستم
 * ------------------------------------------------------------
 *  ⚠️ ٤ مبادئ محفورة في التصميم:
 *
 *  ١) **السعر مُثبّت** — price_p و tier_snapshot و zone_id
 *     بتتسجّل عند الإنشاء ومتتحسبش تاني أبدًا. تعديل سعر
 *     النهاردة مستحيل يغيّر تسوية الأسبوع اللي فات.
 *
 *  ٢) **التاريخ إضافة فقط** — shipment_status_history عمرها
 *     ما بتتعدّل. الغلط بيتصلّح بسطر جديد + قيد عكسي.
 *
 *  ٣) **٣ فهارس بتمنع التكرار** — البوليصة، ومرجع التاجر،
 *     ومعرّف الطلب في المتجر الخارجي.
 *
 *  ٤) **ساعة السيرفر للمالية** — recorded_at هي اللي التسويات
 *     بتقراها. occurred_at (ساعة الموبايل) للعرض بس.
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
  numeric,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { governorates, areas, zones } from "./geography";
import { users, branches } from "./identity";
import { priceLists } from "./pricing";

/** نوع الخدمة */
export const SERVICE_TYPES = [
  "deliver", // توصيل عادي
  "exchange", // استبدال
  "return_to_merchant", // إرجاع للتاجر
  "cash_collection", // تحصيل بدون بضاعة
] as const;

/** طريقة الدفع من العميل — ⚠️ بتحدد حساب مختلف في الدفتر */
export const PAYMENT_METHODS = [
  "cash", // كاش -> كاش المندوب
  "vodafone_cash", // -> محفظة فودافون (مبيدخلش عهدة المندوب)
  "instapay", // -> محفظة إنستاباي
  "card", // -> بوابة الدفع
  "prepaid", // مدفوع مقدمًا — مفيش تحصيل
] as const;

export const PAYMENT_METHOD_LABELS_AR: Record<string, string> = {
  cash: "كاش",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستاباي",
  card: "فيزا",
  prepaid: "مدفوع مقدمًا",
};

/** مين بيتحمل الشحن */
export const SHIPPING_PAYERS = ["merchant", "customer", "split"] as const;

/** مصدر إنشاء الشحنة */
export const SHIPMENT_SOURCES = [
  "portal_manual", // التاجر يدوي
  "portal_bulk", // رفع Excel
  "staff", // موظف نيابة عن التاجر
  "shopify",
  "woocommerce",
  "api",
] as const;

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- التعريف ---
    /** ⚠️ من SEQUENCE + check digit — مش MAX()+1 */
    awb: text("awb").notNull(),
    merchantId: uuid("merchant_id").notNull(),
    /** رقم الأوردر عند التاجر — بيمنع التكرار */
    merchantReference: text("merchant_reference"),
    pickupAddressId: uuid("pickup_address_id"),
    serviceType: text("service_type").notNull().default("deliver"),

    // --- المستلم ---
    recipientName: text("recipient_name").notNull(),
    /** مطبّع لـ 01XXXXXXXXX عبر lib/phone.ts */
    recipientPhone: text("recipient_phone").notNull(),
    recipientPhoneAlt: text("recipient_phone_alt"),

    // --- العنوان ---
    governorateId: uuid("governorate_id")
      .notNull()
      .references(() => governorates.id, { onDelete: "restrict" }),
    areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
    addressLine: text("address_line").notNull(),
    landmark: text("landmark"),
    geoLat: doublePrecision("geo_lat"),
    geoLng: doublePrecision("geo_lng"),

    /** ⚠️ مُثبّتة عند الإنشاء — مش reference حية */
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),

    // --- الفلوس ---
    codAmountP: bigint("cod_amount_p", { mode: "bigint" }).notNull().default(sql`0`),
    paymentMethod: text("payment_method").notNull().default("cash"),
    shippingPayer: text("shipping_payer").notNull().default("merchant"),
    /** أوردر محفظة: تحصيل صفر + الشحن على التاجر → شحنه بيتخصم من محفظته
     *  والشحنة محجوز شحنها وقت الإنشاء (ماتتعملش لو الرصيد مايكفّيش) */
    isWalletOrder: boolean("is_wallet_order").notNull().default(false),
    /** القيمة المعلنة — بتتسجّل عند الإنشاء عشان متتضخّمش بعد الفقد */
    declaredValueP: bigint("declared_value_p", { mode: "bigint" }).notNull().default(sql`0`),

    // --- الطرد ---
    piecesCount: integer("pieces_count").notNull().default(1),
    allowedOpenPieces: integer("allowed_open_pieces").notNull().default(2),
    weightRegisteredKg: numeric("weight_registered_kg", { precision: 6, scale: 2 }),
    weightActualKg: numeric("weight_actual_kg", { precision: 6, scale: 2 }),
    /** ⚠️ عمودين منفصلين — الشركة غير مسؤولة عن الكسر إلا لو التأمين مدفوع */
    isFragile: boolean("is_fragile").notNull().default(false),
    fragileInsured: boolean("fragile_insured").notNull().default(false),
    allowOpen: boolean("allow_open").notNull().default(false),
    notesToCourier: text("notes_to_courier"),

    // --- الحالة ---
    status: text("status").notNull().default("draft"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastReasonCode: text("last_reason_code"),
    attemptsCount: integer("attempts_count").notNull().default(0),
    /** قفل تفاؤلي — بيمنع تعارض التحديث المتزامن */
    version: integer("version").notNull().default(1),
    /** الحالة اللي نرجع لها من on_hold */
    statusBeforeHold: text("status_before_hold"),

    // --- المواعيد ---
    /** بتتحسب مرة واحدة عند دخول المخزن بـ addWorkingTime() */
    promisedAt: timestamp("promised_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** تاريخ إعادة المحاولة لو المندوب أجّل التسليم */
    rescheduledAt: timestamp("rescheduled_at", { withTimezone: true }),
    firstAssignedAt: timestamp("first_assigned_at", { withTimezone: true }),

    // --- التشغيل ---
    currentCourierId: uuid("current_courier_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentRunSheetId: uuid("current_run_sheet_id"),
    currentPickupId: uuid("current_pickup_id"),

    // --- التسعير المُثبّت ---
    /** ⚠️ السعر وقت الإنشاء — متتحسبش تاني أبدًا */
    priceP: bigint("price_p", { mode: "bigint" }).notNull().default(sql`0`),
    priceListId: uuid("price_list_id").references(() => priceLists.id, {
      onDelete: "set null",
    }),
    tierSnapshot: text("tier_snapshot"),

    // --- المحاسبة ---
    totalFeesP: bigint("total_fees_p", { mode: "bigint" }).notNull().default(sql`0`),
    merchantNetP: bigint("merchant_net_p", { mode: "bigint" }).notNull().default(sql`0`),
    codCollectedP: bigint("cod_collected_p", { mode: "bigint" }),
    codMethod: text("cod_method"),
    settlementId: uuid("settlement_id"),
    isSettled: boolean("is_settled").notNull().default(false),

    // --- المصدر ---
    source: text("source").notNull().default("staff"),
    integrationId: uuid("integration_id"),
    externalOrderId: text("external_order_id"),
    importBatchId: uuid("import_batch_id"),

    /** الشحنة المرتبطة — طرف الاستبدال أو رجل المرتجع */
    linkedShipmentId: uuid("linked_shipment_id"),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ⚠️ الفهارس الثلاثة اللي بتمنع التكرار
    uniqueIndex("shipments_awb_uq").on(t.awb),
    uniqueIndex("shipments_integration_order_uq")
      .on(t.integrationId, t.externalOrderId)
      .where(sql`${t.integrationId} IS NOT NULL`),
    uniqueIndex("shipments_merchant_ref_uq")
      .on(t.merchantId, t.merchantReference)
      .where(sql`${t.merchantReference} IS NOT NULL`),

    // فهارس الأداء — مبنية على أنماط الاستعلام الفعلية
    index("shipments_merchant_created_idx").on(t.merchantId, t.createdAt.desc()),
    index("shipments_status_branch_idx").on(t.status, t.branchId),
    index("shipments_courier_status_idx").on(t.currentCourierId, t.status),
    index("shipments_settlement_idx").on(t.settlementId),
    index("shipments_recipient_phone_idx").on(t.recipientPhone),
    index("shipments_governorate_idx").on(t.governorateId, t.status),
    // فهرس جزئي — أصغر وأسرع لاستعلام التسويات
    index("shipments_unsettled_idx")
      .on(t.deliveredAt)
      .where(sql`${t.isSettled} = false`),
    index("shipments_promised_idx")
      .on(t.promisedAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  ]
);

/**
 * تاريخ الحالات — ⚠️ إضافة فقط، عمره ما بيتعدّل ولا بيتمسح.
 *
 * الفرق بين الوقتين حرج:
 *  - occurred_at: ساعة الجهاز (المندوب) — للعرض
 *  - recorded_at: ساعة السيرفر — ⚠️ **دي اللي المالية بتقراها**
 *
 * device_event_id: uuidv7 من العميل — بيمنع تكرار الحدث
 * لما المندوب يعيد المزامنة (وده بيحصل كتير على داتا مصرية).
 */
export const shipmentStatusHistory = pgTable(
  "shipment_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reasonCode: text("reason_code"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role"),
    actorName: text("actor_name"),
    /** ساعة الجهاز — للعرض بس */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** ⚠️ ساعة السيرفر — المالية بتقرا دي بس */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("web"),
    /** uuidv7 من العميل — بيمنع التكرار عند إعادة المزامنة */
    deviceEventId: uuid("device_event_id"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    wasOffline: boolean("was_offline").notNull().default(false),
  },
  (t) => [
    index("ssh_shipment_idx").on(t.shipmentId, t.recordedAt),
    // ⚠️ أهم فهرس في تصميم الـ PWA — بيمنع تكرار الحدث
    uniqueIndex("ssh_device_event_uq")
      .on(t.shipmentId, t.deviceEventId)
      .where(sql`${t.deviceEventId} IS NOT NULL`),
    index("ssh_recorded_idx").on(t.recordedAt),
    index("ssh_actor_idx").on(t.actorUserId, t.recordedAt),
  ]
);

/** أسباب التعذّر — قابلة للتعديل من الشاشة */
export const shipmentReasonCodes = pgTable(
  "shipment_reason_codes",
  {
    code: text("code").primaryKey(),
    nameAr: text("name_ar").notNull(),
    appliesToStatus: text("applies_to_status").notNull().default("delivery_failed"),
    requiresNote: boolean("requires_note").notNull().default(false),
    requiresPhoto: boolean("requires_photo").notNull().default(false),
    countsAsAttempt: boolean("counts_as_attempt").notNull().default(true),
    isCustomerFault: boolean("is_customer_fault").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("reason_codes_status_idx").on(t.appliesToStatus, t.isActive)]
);

/**
 * بنود الرسوم لكل شحنة.
 * ⚠️ متتمسحش أبدًا — الإلغاء بـ voided_at + سطر جديد.
 * is_estimate = true معناه تقدير للعرض بس، ملوش قيد محاسبي.
 */
export const shipmentFees = pgTable(
  "shipment_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    feeCode: text("fee_code").notNull(),
    descriptionAr: text("description_ar").notNull(),
    qty: numeric("qty", { precision: 10, scale: 2 }).notNull().default("1"),
    unitValueP: bigint("unit_value_p", { mode: "bigint" }).notNull(),
    /** موجب = بيتحاسب على التاجر · سالب = بيترد له */
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    /** تقدير للعرض — مش مقيّد في الدفتر */
    isEstimate: boolean("is_estimate").notNull().default(true),
    isAuto: boolean("is_auto").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    settlementId: uuid("settlement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_fees_shipment_idx").on(t.shipmentId),
    index("shipment_fees_settlement_idx").on(t.settlementId),
    // الرسوم الفعالة بس (غير الملغاة)
    index("shipment_fees_active_idx")
      .on(t.shipmentId, t.feeCode)
      .where(sql`${t.voidedAt} IS NULL`),
  ]
);

/** المرفقات — صور الإثبات والتوقيعات على R2 */
export const shipmentAttachments = pgTable(
  "shipment_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    /** pod_photo · signature · damage · id_photo · packaging */
    kind: text("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    sha256: text("sha256"),
    sizeBytes: integer("size_bytes"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_attachments_idx").on(t.shipmentId, t.kind)]
);

/** ملاحظات داخلية وخارجية على الشحنة */
export const shipmentNotes = pgTable(
  "shipment_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** داخلية = التاجر مش شايفها */
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_notes_idx").on(t.shipmentId, t.createdAt)]
);

/**
 * سجل المسح الخام — للتحقيق الجنائي لو حصلت مشكلة.
 * بيسجّل كل مسحة حتى اللي اترفضت.
 */
export const scanEvents = pgTable(
  "scan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    awb: text("awb").notNull(),
    shipmentId: uuid("shipment_id"),
    /** inbound · outbound · sort · load · unload · pickup */
    scanType: text("scan_type").notNull(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    deviceId: text("device_id"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    resultingStatus: text("resulting_status"),
    wasRejected: boolean("was_rejected").notNull().default(false),
    rejectReason: text("reject_reason"),
  },
  (t) => [
    index("scan_events_awb_idx").on(t.awb, t.scannedAt),
    index("scan_events_user_idx").on(t.userId, t.scannedAt),
    index("scan_events_rejected_idx").on(t.wasRejected, t.scannedAt),
  ]
);

// ---------------------------------------------------------------
// قطع الأوردر — للتسليم/الاستلام الجزئي بالقطعة
// ---------------------------------------------------------------

/**
 * قطع الأوردر (بنطلون، تيشيرت، كاب...) بسعر لكل قطعة.
 * العميل يقدر يستلم بعضها ويرجّع الباقي — المندوب بيعلّم كل قطعة.
 * التحصيل الفعلي = مجموع أسعار القطع المتسلّمة.
 */
export const shipmentItems = pgTable(
  "shipment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    nameAr: text("name_ar").notNull(),
    sku: text("sku"),
    qty: integer("qty").notNull().default(1),
    /** سعر القطعة (جزء من التحصيل) بالقروش */
    unitPriceP: bigint("unit_price_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** pending · delivered · returned */
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_items_shipment_idx").on(t.shipmentId),
  ]
);
