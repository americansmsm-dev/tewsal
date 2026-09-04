/**
 * ============================================================
 *  آلة حالات الشحنة — Status Machine
 * ------------------------------------------------------------
 *  ⚠️ ده الملف الوحيد اللي بيعرّف إزاي الشحنة بتتنقل من حالة
 *     لحالة. مفيش أي مكان تاني في السيستم بيغيّر الحالة.
 *
 *  كل تحول بيتعرّف بـ:
 *    - مين مسموح له (الأدوار)
 *    - إيه المطلوب معاه (مبلغ، صورة، سبب...)
 *    - هل بيعمل قيد مالي؟
 *
 *  الحالات النهائية مقفولة — التغيير الوحيد المسموح هو
 *  "عكس" (reversal) من مدير النظام، وبيتسجّل كسطر جديد
 *  في التاريخ مع قيد محاسبي عكسي. مفيش تعديل في المكان أبدًا.
 * ============================================================
 */

// ---------------------------------------------------------------
// الحالات
// ---------------------------------------------------------------

export const SHIPMENT_STATUSES = [
  "draft",
  "awaiting_pickup",
  "pickup_assigned",
  "picked_up",
  "at_hub",
  "out_for_delivery",
  "delivery_failed",
  "delivered",
  "partially_delivered",
  "awaiting_return",
  "out_for_return",
  "returned_to_merchant",
  "disposed",
  "lost",
  "damaged",
  "cancelled",
  "on_hold",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** الأسماء العربية — دي اللي بتظهر في كل الشاشات والتقارير */
export const STATUS_LABELS_AR: Record<ShipmentStatus, string> = {
  draft: "مسودة",
  awaiting_pickup: "في انتظار الاستلام",
  pickup_assigned: "تم إسناد الاستلام",
  picked_up: "تم الاستلام من التاجر",
  at_hub: "في المخزن",
  out_for_delivery: "خرج للتسليم",
  delivery_failed: "تعذّر التسليم",
  delivered: "تم التسليم",
  partially_delivered: "تسليم جزئي",
  awaiting_return: "بانتظار الإرجاع للتاجر",
  out_for_return: "خرج للإرجاع للتاجر",
  returned_to_merchant: "تم الإرجاع للتاجر",
  disposed: "أُتلِفت",
  lost: "مفقود",
  damaged: "تالف",
  cancelled: "ملغي",
  on_hold: "موقوف",
};

/**
 * اللي العميل النهائي بيشوفه في صفحة التتبع.
 * مختلف عن الاسم الداخلي — بلغة العميل مش لغة العمليات.
 * الحالات اللي مش هنا مبتظهرش للعميل خالص.
 */
export const PUBLIC_STATUS_LABELS_AR: Partial<Record<ShipmentStatus, string>> = {
  awaiting_pickup: "تم تسجيل طلبك — جاري استلامه من التاجر",
  pickup_assigned: "تم تسجيل طلبك — جاري استلامه من التاجر",
  picked_up: "استلمنا شحنتك وهي في الطريق لمركز التوزيع",
  at_hub: "شحنتك في مركز توصّل — جاري تجهيزها للتوصيل",
  out_for_delivery: "شحنتك خرجت مع المندوب — هتوصلك النهاردة",
  delivery_failed: "حاولنا نوصلك ومقدرناش",
  delivered: "تم التسليم",
  partially_delivered: "تم التسليم جزئيًا",
  awaiting_return: "جاري إرجاع الشحنة للتاجر",
  out_for_return: "جاري إرجاع الشحنة للتاجر",
  returned_to_merchant: "تم إرجاع الشحنة للتاجر",
  cancelled: "تم إلغاء الشحنة",
};

/** الحالات النهائية — مقفولة، مفيش خروج منها إلا بعكس */
export const TERMINAL_STATUSES = [
  "delivered",
  "partially_delivered",
  "returned_to_merchant",
  "disposed",
  "lost",
  "damaged",
  "cancelled",
] as const satisfies readonly ShipmentStatus[];

export function isTerminal(s: ShipmentStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------
// الأدوار
// ---------------------------------------------------------------

export const ROLES = [
  "super_admin",
  "branch_manager",
  "ops",
  "data_entry",
  "courier",
  "merchant",
  "accountant",
  "support",
  "system",
] as const;

export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------
// المتطلبات المصاحبة للتحول
// ---------------------------------------------------------------

export type TransitionRequirement =
  | "cod_amount" // المبلغ المحصّل + طريقة الدفع
  | "reason_code" // سبب التعذّر
  | "photo" // صورة إثبات
  | "signature" // توقيع
  | "receiver_name" // اسم المستلم
  | "pickup" // لازم يكون فيه طلب استلام
  | "run_sheet" // لازم يكون على كشف مندوب
  | "ops_preauth" // موافقة مسبقة من العمليات
  | "note"; // ملاحظة مكتوبة إجبارية

export interface Transition {
  to: ShipmentStatus;
  /** مين يقدر ينفّذ التحول ده */
  roles: readonly Role[];
  /** إيه اللازم يتبعت معاه */
  requires?: readonly TransitionRequirement[];
  /** هل بيعمل قيد محاسبي؟ */
  financial?: boolean;
  /** وصف عربي للتوثيق وشاشات الإدارة */
  label: string;
}

// ---------------------------------------------------------------
// خريطة التحولات — قلب السيستم
// ---------------------------------------------------------------

const ALL_STAFF = ["super_admin", "branch_manager", "ops"] as const;

export const TRANSITIONS: Record<ShipmentStatus, readonly Transition[]> = {
  draft: [
    {
      to: "awaiting_pickup",
      roles: ["merchant", ...ALL_STAFF, "system"],
      label: "تأكيد الشحنة وإصدار البوليصة",
    },
    {
      to: "cancelled",
      roles: ["merchant", ...ALL_STAFF],
      label: "إلغاء قبل الاستلام (بدون رسوم)",
    },
  ],

  awaiting_pickup: [
    {
      to: "pickup_assigned",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["pickup"],
      label: "إسناد الاستلام لمندوب",
    },
    {
      to: "cancelled",
      roles: ["merchant", ...ALL_STAFF],
      label: "إلغاء قبل الاستلام (بدون رسوم)",
    },
  ],

  pickup_assigned: [
    {
      to: "picked_up",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      label: "المندوب استلم من التاجر",
    },
    {
      to: "awaiting_pickup",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["note"],
      label: "إلغاء الإسناد وإرجاعها لقائمة الانتظار",
    },
    {
      to: "cancelled",
      roles: [...ALL_STAFF],
      label: "إلغاء قبل الاستلام (بدون رسوم)",
    },
  ],

  picked_up: [
    {
      to: "at_hub",
      roles: ["ops", "branch_manager", "super_admin"],
      label: "مسح الوارد — دخول المخزن (هنا بيتحسب الموعد المتوقع)",
    },
    {
      to: "cancelled",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["note"],
      financial: true,
      label: "إلغاء بعد الاستلام (بيتحاسب عليه شحن)",
    },
  ],

  at_hub: [
    {
      to: "out_for_delivery",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["run_sheet"],
      label: "تحميل على كشف مندوب وخروج للتسليم",
    },
    {
      to: "awaiting_return",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["reason_code"],
      label: "تحويل للمرتجعات",
    },
    {
      to: "on_hold",
      roles: ["branch_manager", "super_admin"],
      requires: ["note"],
      label: "إيقاف مؤقت",
    },
    {
      to: "cancelled",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["note"],
      financial: true,
      label: "إلغاء من المخزن (بيتحاسب عليه شحن)",
    },
  ],

  out_for_delivery: [
    {
      to: "delivered",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      requires: ["cod_amount"],
      financial: true,
      label: "تم التسليم والتحصيل",
    },
    {
      to: "partially_delivered",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      requires: ["cod_amount", "ops_preauth", "note"],
      financial: true,
      label: "تسليم جزئي (بموافقة مسبقة من العمليات)",
    },
    {
      to: "delivery_failed",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      requires: ["reason_code"],
      label: "تعذّر التسليم",
    },
    {
      // المندوب يقدر يعلّم الأوردر مرتجع مباشرة (رفض العميل الاستلام كليًا).
      // مفيش قيد مالي هنا — الشحن بيتحاسب عند returned_to_merchant.
      to: "awaiting_return",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      requires: ["reason_code"],
      label: "مرتجع (رفض الاستلام)",
    },
    {
      to: "on_hold",
      roles: ["branch_manager", "super_admin"],
      requires: ["note"],
      label: "إيقاف مؤقت",
    },
  ],

  delivery_failed: [
    {
      to: "out_for_delivery",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["run_sheet"],
      label: "محاولة تسليم تانية",
    },
    {
      to: "at_hub",
      roles: ["ops", "branch_manager", "super_admin"],
      label: "المندوب رجّعها للمخزن",
    },
    {
      to: "awaiting_return",
      roles: ["ops", "branch_manager", "super_admin"],
      label: "تحويل للمرتجعات",
    },
    {
      to: "on_hold",
      roles: ["branch_manager", "super_admin"],
      requires: ["note"],
      label: "إيقاف مؤقت",
    },
  ],

  awaiting_return: [
    {
      to: "out_for_return",
      roles: ["ops", "branch_manager", "super_admin"],
      label: "تحميل للإرجاع مع البيك أب",
    },
    {
      to: "out_for_delivery",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["run_sheet", "note"],
      label: "إعادة محاولة التسليم (بطلب التاجر)",
    },
    {
      // إتلاف المرتجع اللي شاخ على الرف (التاجر مش بيستلمه) —
      // مدير النظام بس، بموافقة وسبب مكتوب، وبيتحاسب عليه شحن.
      to: "disposed",
      roles: ["super_admin"],
      requires: ["note"],
      financial: true,
      label: "إتلاف المرتجع بعد المدة (بموافقة مدير النظام)",
    },
  ],

  out_for_return: [
    {
      to: "returned_to_merchant",
      roles: ["courier", "ops", "branch_manager", "super_admin"],
      requires: ["receiver_name", "signature"],
      financial: true,
      label: "تم تسليم المرتجع للتاجر",
    },
    {
      to: "awaiting_return",
      roles: ["ops", "branch_manager", "super_admin"],
      requires: ["reason_code"],
      label: "التاجر مستلمش — رجوع للرف",
    },
  ],

  on_hold: [
    // العودة من الإيقاف بترجّع لآخر حالة — بتتحدد وقت التنفيذ
    {
      to: "at_hub",
      roles: ["branch_manager", "super_admin"],
      label: "إلغاء الإيقاف — رجوع للمخزن",
    },
    {
      to: "out_for_delivery",
      roles: ["branch_manager", "super_admin"],
      requires: ["run_sheet"],
      label: "إلغاء الإيقاف — خروج للتسليم",
    },
    {
      to: "awaiting_return",
      roles: ["branch_manager", "super_admin"],
      label: "إلغاء الإيقاف — تحويل للمرتجعات",
    },
    {
      to: "cancelled",
      roles: ["super_admin"],
      requires: ["note"],
      financial: true,
      label: "إلغاء نهائي",
    },
  ],

  // الحالات النهائية — مفيش خروج منها إلا بعكس من مدير النظام
  delivered: [],
  partially_delivered: [],
  returned_to_merchant: [],
  disposed: [],
  lost: [],
  damaged: [],
  cancelled: [],
};

/**
 * الفقد والتلف ممكن يحصلوا من أي حالة غير نهائية،
 * وبس من مدير النظام. بيفتحوا مطالبة تعويض.
 */
export const CATASTROPHIC_TRANSITIONS: readonly Transition[] = [
  {
    to: "lost",
    roles: ["super_admin"],
    requires: ["note"],
    financial: true,
    label: "تسجيل الشحنة كمفقودة (بيفتح مطالبة)",
  },
  {
    to: "damaged",
    roles: ["super_admin"],
    requires: ["note", "photo"],
    financial: true,
    label: "تسجيل الشحنة كتالفة (بيفتح مطالبة)",
  },
];

// ---------------------------------------------------------------
// الاستعلام والتحقق
// ---------------------------------------------------------------

/** كل التحولات المتاحة من حالة معيّنة (بما فيها الفقد والتلف) */
export function transitionsFrom(from: ShipmentStatus): readonly Transition[] {
  const base = TRANSITIONS[from] ?? [];
  if (isTerminal(from)) return base;
  return [...base, ...CATASTROPHIC_TRANSITIONS];
}

/** التحولات اللي دور معيّن يقدر ينفّذها — لبناء الأزرار في الواجهة */
export function allowedTransitions(
  from: ShipmentStatus,
  role: Role
): readonly Transition[] {
  return transitionsFrom(from).filter((t) => t.roles.includes(role));
}

export interface TransitionCheck {
  ok: boolean;
  /** رسالة الخطأ بالعربي — بتتعرض للمستخدم مباشرة */
  error?: string;
  transition?: Transition;
}

/**
 * التحقق من صلاحية تحول معيّن.
 * بيتنده **قبل** أي كتابة في قاعدة البيانات.
 *
 * ملاحظة: ده بيتحقق من القواعد المنطقية بس. التحقق من
 * التزامن (نفس الحالة المتوقعة) بيحصل في applyTransition
 * جوه transaction مع SELECT ... FOR UPDATE.
 */
export function canTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
  role: Role,
  provided: readonly TransitionRequirement[] = []
): TransitionCheck {
  if (from === to) {
    return { ok: false, error: "الشحنة في الحالة دي بالفعل" };
  }

  if (isTerminal(from)) {
    return {
      ok: false,
      error: `الشحنة في حالة نهائية (${STATUS_LABELS_AR[from]}) — التغيير الوحيد المسموح هو عكس العملية من مدير النظام`,
    };
  }

  const available = transitionsFrom(from);
  const transition = available.find((t) => t.to === to);

  if (!transition) {
    return {
      ok: false,
      error: `مينفعش تنقل من "${STATUS_LABELS_AR[from]}" لـ "${STATUS_LABELS_AR[to]}"`,
    };
  }

  if (!transition.roles.includes(role)) {
    return {
      ok: false,
      error: `دورك (${role}) مش مسموح له بالإجراء ده`,
      transition,
    };
  }

  const missing = (transition.requires ?? []).filter(
    (r) => !provided.includes(r)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `ناقص: ${missing.map(requirementLabelAr).join("، ")}`,
      transition,
    };
  }

  return { ok: true, transition };
}

export function requirementLabelAr(r: TransitionRequirement): string {
  const map: Record<TransitionRequirement, string> = {
    cod_amount: "المبلغ المحصّل وطريقة الدفع",
    reason_code: "سبب التعذّر",
    photo: "صورة إثبات",
    signature: "توقيع",
    receiver_name: "اسم المستلم",
    pickup: "طلب استلام",
    run_sheet: "كشف مندوب",
    ops_preauth: "موافقة مسبقة من العمليات",
    note: "ملاحظة مكتوبة",
  };
  return map[r];
}

/** هل التحول ده بيعمل قيد محاسبي؟ */
export function isFinancialTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  return transitionsFrom(from).find((t) => t.to === to)?.financial === true;
}
