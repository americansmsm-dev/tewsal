/**
 * ============================================================
 *  بيانات البذور — Seed Data
 * ------------------------------------------------------------
 *  المصدر: landing/js/pricing-data.js + landing/js/terms-data.js
 *          + قرارات العميل المسجّلة في DECISIONS.md
 *
 *  ⚠️ كل الأرقام هنا **قيم ابتدائية بس** — العميل بيعدّلها
 *     من شاشة الإعدادات بدون نشر. الملف ده بيتنفذ مرة واحدة
 *     عند تجهيز قاعدة بيانات جديدة.
 * ============================================================
 */
import { poundsToPiastres } from "@/lib/money";

const P = poundsToPiastres;

// ---------------------------------------------------------------
// مناطق التسعير
// ---------------------------------------------------------------

export const SEED_ZONES = [
  {
    code: "cairo_giza",
    nameAr: "القاهرة والجيزة",
    slaWorkingHours: 48,
    slaWorkingDaysMin: null,
    slaWorkingDaysMax: null,
    sortOrder: 1,
  },
  {
    code: "delta_canal",
    nameAr: "الدلتا والقناة",
    slaWorkingHours: null,
    slaWorkingDaysMin: 4,
    slaWorkingDaysMax: 5,
    sortOrder: 2,
  },
  {
    code: "saeed_redsea",
    nameAr: "الصعيد والبحر الأحمر",
    slaWorkingHours: null,
    slaWorkingDaysMin: 4,
    slaWorkingDaysMax: 5,
    sortOrder: 3,
  },
] as const;

// ---------------------------------------------------------------
// المحافظات المصرية الـ ٢٧
// ---------------------------------------------------------------

export const SEED_GOVERNORATES = [
  // --- القاهرة والجيزة ---
  { code: "CAI", nameAr: "القاهرة", nameEn: "Cairo", zone: "cairo_giza", codEnabled: true },
  { code: "GIZ", nameAr: "الجيزة", nameEn: "Giza", zone: "cairo_giza", codEnabled: true },
  { code: "QLY", nameAr: "القليوبية", nameEn: "Qalyubia", zone: "cairo_giza", codEnabled: false },

  // --- الدلتا والقناة ---
  // ⚠️ الإسكندرية: سعر الدلتا (قرار ٢) بس SLA ٤٨ ساعة والتحصيل مفعّل
  {
    code: "ALX",
    nameAr: "الإسكندرية",
    nameEn: "Alexandria",
    zone: "delta_canal",
    codEnabled: true,
    slaOverrideHours: 48,
  },
  { code: "GHR", nameAr: "الغربية", nameEn: "Gharbia", zone: "delta_canal", codEnabled: false },
  { code: "DAK", nameAr: "الدقهلية", nameEn: "Dakahlia", zone: "delta_canal", codEnabled: false },
  { code: "SHR", nameAr: "الشرقية", nameEn: "Sharqia", zone: "delta_canal", codEnabled: false },
  { code: "MNF", nameAr: "المنوفية", nameEn: "Monufia", zone: "delta_canal", codEnabled: false },
  { code: "KFS", nameAr: "كفر الشيخ", nameEn: "Kafr El Sheikh", zone: "delta_canal", codEnabled: false },
  { code: "DMT", nameAr: "دمياط", nameEn: "Damietta", zone: "delta_canal", codEnabled: false },
  { code: "PTS", nameAr: "بورسعيد", nameEn: "Port Said", zone: "delta_canal", codEnabled: false },
  { code: "ISM", nameAr: "الإسماعيلية", nameEn: "Ismailia", zone: "delta_canal", codEnabled: false },
  { code: "SUZ", nameAr: "السويس", nameEn: "Suez", zone: "delta_canal", codEnabled: false },
  { code: "BEH", nameAr: "البحيرة", nameEn: "Beheira", zone: "delta_canal", codEnabled: false },

  // --- الصعيد والبحر الأحمر ---
  { code: "BNS", nameAr: "بني سويف", nameEn: "Beni Suef", zone: "saeed_redsea", codEnabled: false },
  { code: "MIN", nameAr: "المنيا", nameEn: "Minya", zone: "saeed_redsea", codEnabled: false },
  { code: "AST", nameAr: "أسيوط", nameEn: "Asyut", zone: "saeed_redsea", codEnabled: false },
  { code: "SHG", nameAr: "سوهاج", nameEn: "Sohag", zone: "saeed_redsea", codEnabled: false },
  { code: "QNA", nameAr: "قنا", nameEn: "Qena", zone: "saeed_redsea", codEnabled: false },
  { code: "LXR", nameAr: "الأقصر", nameEn: "Luxor", zone: "saeed_redsea", codEnabled: false },
  { code: "ASW", nameAr: "أسوان", nameEn: "Aswan", zone: "saeed_redsea", codEnabled: false },
  { code: "RDS", nameAr: "البحر الأحمر", nameEn: "Red Sea", zone: "saeed_redsea", codEnabled: false },
  { code: "FYM", nameAr: "الفيوم", nameEn: "Fayoum", zone: "saeed_redsea", codEnabled: false },
  { code: "WAD", nameAr: "الوادي الجديد", nameEn: "New Valley", zone: "saeed_redsea", codEnabled: false, isRemote: true },
  { code: "MAT", nameAr: "مطروح", nameEn: "Matrouh", zone: "saeed_redsea", codEnabled: false, isRemote: true },
  { code: "NSI", nameAr: "شمال سيناء", nameEn: "North Sinai", zone: "saeed_redsea", codEnabled: false, isRemote: true },
  { code: "SSI", nameAr: "جنوب سيناء", nameEn: "South Sinai", zone: "saeed_redsea", codEnabled: false, isRemote: true },
] as const;

// ---------------------------------------------------------------
// جدول الأسعار — من pricing-data.js
// ---------------------------------------------------------------

export const SEED_PRICES = [
  // القاهرة والجيزة
  { zone: "cairo_giza", tier: "t1", priceP: P("90") },
  { zone: "cairo_giza", tier: "t2", priceP: P("80") },
  { zone: "cairo_giza", tier: "t3", priceP: P("70") },
  // الدلتا والقناة (الإسكندرية معاها — قرار ٢)
  { zone: "delta_canal", tier: "t1", priceP: P("110") },
  { zone: "delta_canal", tier: "t2", priceP: P("100") },
  { zone: "delta_canal", tier: "t3", priceP: P("90") },
  // الصعيد والبحر الأحمر
  { zone: "saeed_redsea", tier: "t1", priceP: P("150") },
  { zone: "saeed_redsea", tier: "t2", priceP: P("135") },
  { zone: "saeed_redsea", tier: "t3", priceP: P("125") },
] as const;

// ---------------------------------------------------------------
// تعريفات الرسوم
// ---------------------------------------------------------------

export const SEED_FEES = [
  {
    code: "COD",
    nameAr: "رسوم التحصيل",
    calcType: "flat_plus_percent",
    valueP: P("100"),
    percentBp: 100, // 1%
    thresholdP: P("5000"),
    basis: "full_amount", // ← قرار العميل رقم ١
    appliesTo: "shipment",
    isAuto: true,
    notes: "١٠٠ ج ثابتة + ١٪ من المبلغ كله لو عدى ٥٠٠٠ ج",
  },
  {
    code: "RETURN",
    nameAr: "رسوم المرتجع",
    calcType: "flat",
    valueP: P("100"),
    appliesTo: "shipment",
    isAuto: true,
    notes: "١٠٠ ج للقاهرة/الجيزة/الإسكندرية · ٦٥ ج لباقي المحافظات (قرار ٧)",
  },
  {
    code: "EXCHANGE",
    nameAr: "رسوم الاستبدال",
    calcType: "flat",
    valueP: P("15"),
    appliesTo: "shipment",
    isAuto: true,
  },
  {
    code: "EXTRA_PIECE",
    nameAr: "قطعة زائدة عن قطعتين",
    calcType: "per_unit",
    valueP: P("5"),
    appliesTo: "shipment",
    isAuto: true,
  },
  {
    code: "OVERWEIGHT_KG",
    nameAr: "وزن زائد (لكل كيلو)",
    calcType: "per_unit",
    valueP: P("10"),
    appliesTo: "shipment",
    isAuto: true,
  },
  {
    code: "CASH_PAYOUT",
    nameAr: "مصاريف مندوب — استلام المستحقات كاش",
    calcType: "flat",
    valueP: P("50"),
    appliesTo: "payout",
    isAuto: true,
  },
  {
    code: "FRAGILE_INSURANCE",
    nameAr: "تأمين القابل للكسر",
    calcType: "flat",
    valueP: 0n,
    appliesTo: "shipment",
    isAuto: false,
    notes: "بيتحدد بالاتفاق مع التاجر — بدونه الشركة غير مسؤولة عن الكسر",
  },
  {
    code: "EXTRA_PACKAGING",
    nameAr: "تغليف إضافي",
    calcType: "flat",
    valueP: 0n,
    appliesTo: "shipment",
    isAuto: false,
  },
  {
    code: "REMOTE_AREA",
    nameAr: "رسم منطقة نائية",
    calcType: "flat",
    valueP: 0n,
    appliesTo: "shipment",
    isAuto: true,
  },
  {
    code: "EXPEDITE",
    nameAr: "تسريع التحصيل أو التحويل",
    calcType: "flat",
    valueP: 0n,
    appliesTo: "payout",
    isAuto: false,
  },
  {
    code: "PICKUP_SERVICE",
    nameAr: "خدمة استلام (أقل من الحد المجاني)",
    calcType: "flat",
    valueP: P("50"),
    appliesTo: "pickup",
    isAuto: true,
    notes: "٥٠ ج على طلب الاستلام لو عدد الأوردرات أقل من pickup.free_threshold — قرار ١٠",
  },
] as const;

/** تجاوز رسم المرتجع خارج التغطية — قرار ٧ */
export const SEED_FEE_ZONE_OVERRIDES = [
  {
    feeCode: "RETURN",
    zone: "delta_canal",
    valueP: P("65"),
    notes: "المرتجع خارج القاهرة/الجيزة/الإسكندرية — الإسكندرية مستثناة بتجاوز محافظة",
  },
  {
    feeCode: "RETURN",
    zone: "saeed_redsea",
    valueP: P("65"),
    notes: "المرتجع من الصعيد والبحر الأحمر",
  },
] as const;

/** الإسكندرية بتاخد رسم المرتجع الكامل رغم إنها في منطقة الدلتا */
export const SEED_FEE_GOV_OVERRIDES = [
  {
    feeCode: "RETURN",
    governorate: "ALX",
    valueP: P("100"),
    notes: "الإسكندرية ضمن نطاق التغطية الكامل",
  },
] as const;

// ---------------------------------------------------------------
// عمولات المناديب — قرار ٩
// ---------------------------------------------------------------

export const SEED_COMMISSION_RULES = [
  {
    courierId: null,
    zone: null,
    governorate: null,
    basis: "per_delivery",
    amountP: P("50"),
    priority: 0,
    notes: "الافتراضي: ٥٠ ج لكل شحنة مُسلَّمة في أي منطقة — قابل للتعديل لكل منطقة ومندوب",
  },
] as const;

// ---------------------------------------------------------------
// الإعدادات العامة
// ---------------------------------------------------------------

export const SEED_SETTINGS = [
  // --- الاستلام ---
  {
    key: "pickup.free_threshold",
    value: 5,
    nameAr: "الحد المجاني لعدد الأوردرات في طلب الاستلام",
    description: "الطلبات بعدد أقل من كده عليها رسم خدمة استلام (PICKUP_SERVICE) — قرار ١٠",
    category: "operations",
    valueType: "number",
  },
  // --- الفوترة (قرارات ٤ و ٥) ---
  {
    key: "billing.charge_shipping_on_return",
    value: true,
    nameAr: "احتساب الشحن على المرتجع",
    description: "الشحن بيستحق بمجرد دخول المخزن، بغض النظر عن نتيجة التسليم",
    category: "billing",
    valueType: "boolean",
  },
  {
    key: "billing.charge_shipping_on_cancel_after_hub",
    value: true,
    nameAr: "احتساب الشحن على الإلغاء بعد دخول المخزن",
    category: "billing",
    valueType: "boolean",
  },
  // --- التسويات (قرارات ٣ و ٦) ---
  {
    key: "payout.days",
    value: ["monday", "thursday"],
    nameAr: "أيام تحويل مستحقات التجار",
    category: "settlement",
    valueType: "array",
  },
  {
    key: "payout.cutoff_hour",
    value: 12,
    nameAr: "ساعة إغلاق دفعة التحويل",
    description: "أي تحصيل اتأكد بعد الساعة دي بيروح للدفعة الجاية",
    category: "settlement",
    valueType: "number",
  },
  {
    key: "settlement.require_cash_confirmed",
    value: true,
    nameAr: "اشتراط تأكيد استلام الكاش قبل التحويل",
    description: "⚠️ تغييره لـ false معناه احتمال تحويل فلوس لسه محصّلتهاش",
    category: "settlement",
    valueType: "boolean",
  },
  {
    key: "settlement.two_person_approval_threshold_p",
    value: 2000000, // ٢٠,٠٠٠ ج بالقروش
    nameAr: "حد اعتماد الشخصين للتسوية",
    category: "settlement",
    valueType: "money",
  },
  // --- التعويضات ---
  {
    key: "compensation.max_p",
    value: 60000, // ٦٠٠ ج
    nameAr: "أقصى تعويض عن فقد أو تلف",
    description: "بشرط التغليف الجيد — والقابل للكسر بيحتاج تأمين مدفوع",
    category: "claims",
    valueType: "money",
  },
  // --- المناديب ---
  {
    key: "courier.max_cash_hold_days",
    value: 2,
    nameAr: "أقصى مدة يحتفظ فيها المندوب بالكاش",
    description: "بعدها بيتمنع من فتح كشف جديد",
    category: "operations",
    valueType: "number",
  },
  {
    key: "commission.default_per_delivery_p",
    value: 5000, // ٥٠ ج
    nameAr: "عمولة المندوب الافتراضية لكل شحنة",
    category: "operations",
    valueType: "money",
  },
  // --- الشحنات ---
  {
    key: "shipment.allowed_open_pieces",
    value: 2,
    nameAr: "عدد القطع المسموح بفتحها",
    description: "أكتر من كده بيتحسب ٥ ج للقطعة الزائدة",
    category: "operations",
    valueType: "number",
  },
  {
    key: "shipment.max_delivery_attempts",
    value: 3,
    nameAr: "أقصى عدد محاولات تسليم",
    category: "operations",
    valueType: "number",
  },
  {
    key: "returns.escalate_after_days",
    value: [14, 30],
    nameAr: "أيام تصعيد المرتجعات القديمة",
    category: "operations",
    valueType: "array",
  },
  // --- الضرائب (قرار ٨ — مؤجّل) ---
  {
    key: "tax.vat_percent_bp",
    value: 1400, // ١٤٪
    nameAr: "نسبة ضريبة القيمة المضافة",
    category: "tax",
    valueType: "number",
  },
  {
    key: "tax.eta_enabled",
    value: false,
    nameAr: "تفعيل الإرسال لمنظومة الفاتورة الإلكترونية",
    description: "مقفول لحد ما يتوفر الرقم الضريبي وتوكن التوقيع",
    category: "tax",
    valueType: "boolean",
  },
] as const;

// ---------------------------------------------------------------
// أسباب تعذّر التسليم
// ---------------------------------------------------------------

export interface SeedReasonCode {
  readonly code: string;
  readonly nameAr: string;
  readonly requiresPhoto: boolean;
  readonly requiresNote: boolean;
  /** بيتحسب محاولة تسليم؟ التأجيل بطلب العميل مش محاولة */
  readonly countsAsAttempt: boolean;
  /** خطأ العميل ولا خطأ الشركة؟ بيدخل في تقييم المندوب */
  readonly isCustomerFault: boolean;
}

export const SEED_REASON_CODES: readonly SeedReasonCode[] = [
  { code: "refused", nameAr: "رفض الاستلام", requiresPhoto: true, requiresNote: false, countsAsAttempt: true, isCustomerFault: true },
  { code: "no_answer", nameAr: "العميل لا يرد", requiresPhoto: false, requiresNote: false, countsAsAttempt: true, isCustomerFault: true },
  { code: "wrong_address", nameAr: "عنوان خاطئ", requiresPhoto: true, requiresNote: false, countsAsAttempt: true, isCustomerFault: true },
  { code: "postponed", nameAr: "تأجيل بطلب العميل", requiresPhoto: false, requiresNote: true, countsAsAttempt: false, isCustomerFault: true },
  { code: "no_cash", nameAr: "المبلغ غير متوفر", requiresPhoto: false, requiresNote: false, countsAsAttempt: true, isCustomerFault: true },
  { code: "out_of_coverage", nameAr: "خارج نطاق التغطية", requiresPhoto: false, requiresNote: true, countsAsAttempt: false, isCustomerFault: false },
  { code: "damaged_in_transit", nameAr: "الشحنة تالفة", requiresPhoto: true, requiresNote: true, countsAsAttempt: false, isCustomerFault: false },
  { code: "duplicate_order", nameAr: "أوردر مكرر", requiresPhoto: false, requiresNote: true, countsAsAttempt: false, isCustomerFault: false },
] as const;

// ---------------------------------------------------------------
// دليل الحسابات
// ---------------------------------------------------------------

export const SEED_ACCOUNTS = [
  // أصول
  { code: "COURIER_CASH", nameAr: "كاش المندوب", type: "asset", ownerType: "courier", isTemplate: true },
  { code: "BRANCH_CASH", nameAr: "خزنة الفرع", type: "asset", ownerType: "branch", isTemplate: true },
  { code: "COMPANY_BANK", nameAr: "الحساب البنكي", type: "asset", ownerType: "company", isTemplate: true },
  { code: "EWALLET_VODAFONE", nameAr: "محفظة فودافون كاش", type: "asset", ownerType: "company" },
  { code: "EWALLET_INSTAPAY", nameAr: "محفظة إنستاباي", type: "asset", ownerType: "company" },
  { code: "COURIER_RECEIVABLE", nameAr: "ذمم على المندوب", type: "asset", ownerType: "courier", isTemplate: true },
  // التزامات
  { code: "MERCHANT_PAYABLE", nameAr: "مستحقات التاجر", type: "liability", ownerType: "merchant", isTemplate: true },
  { code: "CASH_OVER_SUSPENSE", nameAr: "زيادة نقدية غير محددة", type: "liability", ownerType: "company" },
  { code: "VAT_PAYABLE", nameAr: "ضريبة القيمة المضافة المستحقة", type: "liability", ownerType: "company" },
  { code: "COURIER_COMMISSION_PAYABLE", nameAr: "عمولات مستحقة للمناديب", type: "liability", ownerType: "courier", isTemplate: true },
  // إيرادات
  { code: "REVENUE_SHIPPING", nameAr: "إيراد الشحن", type: "revenue", ownerType: "company" },
  { code: "REVENUE_COD_FEE", nameAr: "إيراد التحصيل", type: "revenue", ownerType: "company" },
  { code: "REVENUE_RETURN_FEE", nameAr: "إيراد المرتجع", type: "revenue", ownerType: "company" },
  { code: "REVENUE_OTHER", nameAr: "إيرادات أخرى", type: "revenue", ownerType: "company" },
  // مصروفات
  { code: "COMPENSATION_EXPENSE", nameAr: "مصروف تعويضات", type: "expense", ownerType: "company" },
  { code: "CASH_VARIANCE", nameAr: "فروقات نقدية", type: "expense", ownerType: "company" },
  { code: "COMMISSION_EXPENSE", nameAr: "مصروف عمولات المناديب", type: "expense", ownerType: "company" },
  { code: "FLEET_EXPENSE", nameAr: "مصروف الأسطول (بنزين وصيانة)", type: "expense", ownerType: "company" },
] as const;

// ---------------------------------------------------------------
// ساعات العمل الافتراضية (الجمعة إجازة)
// ---------------------------------------------------------------

export const SEED_WORKING_HOURS = [
  { dayOfWeek: 0, nameAr: "الأحد", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
  { dayOfWeek: 1, nameAr: "الاثنين", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
  { dayOfWeek: 2, nameAr: "الثلاثاء", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
  { dayOfWeek: 3, nameAr: "الأربعاء", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
  { dayOfWeek: 4, nameAr: "الخميس", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
  { dayOfWeek: 5, nameAr: "الجمعة", openTime: null, closeTime: null, isWorkingDay: false },
  { dayOfWeek: 6, nameAr: "السبت", openTime: "09:00", closeTime: "18:00", isWorkingDay: true },
] as const;
