/**
 * ============================================================
 *  الدفتر المحاسبي المزدوج — Double-Entry Ledger
 * ------------------------------------------------------------
 *  ⚠️ ده أخطر ملف في السيستم كله.
 *
 *  المبدأ: كل عملية مالية بتكتب سطرين على الأقل، ومجموع
 *  المدين لازم يساوي مجموع الدائن. والقيد ده **مفروض من
 *  قاعدة البيانات** (constraint trigger)، مش من الكود.
 *
 *  يعني حتى لو الكود فيه بق، قاعدة البيانات هترفض القيد
 *  غير المتوازن وترمي الترانزاكشن كلها.
 *
 *  والقيود **متتعدلش أبدًا** — الغلط بيتصلّح بقيد عكسي
 *  جديد. ده بيخلي التاريخ كامل ومحدش يقدر يمسح أثره.
 * ============================================================
 */
import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  bigserial,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { shipments } from "./shipments";

/** أنواع الحسابات */
export const ACCOUNT_TYPES = ["asset", "liability", "revenue", "expense", "equity"] as const;
/** مالك الحساب — عشان يبقى فيه حساب مستقل لكل مندوب وكل تاجر */
export const ACCOUNT_OWNERS = ["company", "merchant", "courier", "branch"] as const;

/**
 * الحسابات.
 * الحسابات اللي isTemplate = true بيتعمل منها نسخة لكل
 * مندوب/تاجر/فرع — عشان العجز يبان على مين بالظبط.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    type: text("type").notNull(),
    ownerType: text("owner_type").notNull().default("company"),
    /** معرّف المندوب أو التاجر أو الفرع */
    ownerId: uuid("owner_id"),
    /** قالب بيتعمل منه نسخة لكل مالك */
    isTemplate: boolean("is_template").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // حسابات المناديب والتجار والفروع — مفتاحها (الكود + المالك)
    uniqueIndex("accounts_code_owner_uq").on(t.code, t.ownerId),
    // ⚠️ حسابات الشركة owner_id بتاعها NULL، و Postgres بيعتبر كل NULL
    //    مختلف عن التاني — يعني الفهرس اللي فوق **مبيمنعش** تكرارها.
    //    الفهرس الجزئي ده هو اللي بيمنع «إيراد الشحن» يتكرر مرتين
    //    (وأرصدة الشركة تتقسم على حسابين من غير ما حد ياخد باله).
    uniqueIndex("accounts_code_company_uq")
      .on(t.code)
      .where(sql`${t.ownerId} IS NULL`),
    index("accounts_owner_idx").on(t.ownerType, t.ownerId),
    index("accounts_type_idx").on(t.type),
  ]
);

/**
 * قيود اليومية.
 *
 * ⚠️ الفهرس الفريد تحت هو اللي بيمنع القيد المكرر:
 *    التسليم الواحد يتقيّد **مرة واحدة بس، للأبد**.
 *    حتى لو المندوب زامن نفس الحدث ١٠٠ مرة.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** رقم متسلسل مقروء للمحاسب */
    entryNo: bigserial("entry_no", { mode: "bigint" }).notNull(),
    entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
    descriptionAr: text("description_ar").notNull(),
    /** shipment · run_sheet · cash_handover · settlement · claim · manual */
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    /** delivery · return · payout · handover · commission ... */
    kind: text("kind").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    /** لو ده قيد عكسي، بيشاور على الأصلي */
    reversedByEntryId: uuid("reversed_by_entry_id"),
    reversesEntryId: uuid("reverses_entry_id"),
    isReversal: boolean("is_reversal").notNull().default(false),
    reversalReason: text("reversal_reason"),
  },
  (t) => [
    // ⚠️ أهم قيد في السيستم: العملية الواحدة تتقيّد مرة واحدة بس
    uniqueIndex("je_source_kind_uq")
      .on(t.sourceType, t.sourceId, t.kind)
      .where(sql`${t.isReversal} = false`),
    index("je_source_idx").on(t.sourceType, t.sourceId),
    index("je_date_idx").on(t.entryDate),
    index("je_kind_idx").on(t.kind, t.entryDate),
  ]
);

/**
 * سطور القيد.
 *
 * ⚠️ قيدين على مستوى قاعدة البيانات:
 *  ١) كل سطر إما مدين أو دائن — مش الاتنين ولا ولا واحد
 *  ٢) (في migration منفصل) constraint trigger DEFERRABLE
 *     بيتأكد إن SUM(debit) = SUM(credit) لكل قيد عند COMMIT
 */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    debitP: bigint("debit_p", { mode: "bigint" }).notNull().default(sql`0`),
    creditP: bigint("credit_p", { mode: "bigint" }).notNull().default(sql`0`),
    /** للتتبع والتقارير */
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    merchantId: uuid("merchant_id"),
    courierId: uuid("courier_id"),
    memo: text("memo"),
  },
  (t) => [
    index("jl_entry_idx").on(t.entryId),
    index("jl_account_idx").on(t.accountId),
    index("jl_shipment_idx").on(t.shipmentId),
    index("jl_merchant_idx").on(t.merchantId),
    index("jl_courier_idx").on(t.courierId),
    // ⚠️ مفيش مبالغ سالبة، وكل سطر إما مدين أو دائن
    check(
      "jl_debit_xor_credit",
      sql`${t.debitP} >= 0 AND ${t.creditP} >= 0 AND (${t.debitP} = 0) <> (${t.creditP} = 0)`
    ),
  ]
);

/**
 * تسليم العهد النقدية.
 * المندوب -> خزنة الفرع -> البنك
 */
export const cashHandovers = pgTable(
  "cash_handovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    /** courier · branch */
    fromType: text("from_type").notNull(),
    fromId: uuid("from_id").notNull(),
    /** branch · company · bank · wallet */
    toType: text("to_type").notNull(),
    toId: uuid("to_id"),
    /** المتوقع حسب الدفتر */
    expectedP: bigint("expected_p", { mode: "bigint" }).notNull(),
    /** اللي اتسلّم فعلًا */
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    /** موجب = زيادة · سالب = عجز */
    varianceP: bigint("variance_p", { mode: "bigint" }).notNull().default(sql`0`),
    method: text("method").notNull().default("cash"),
    runSheetId: uuid("run_sheet_id"),
    receiptNo: text("receipt_no"),
    evidenceR2Key: text("evidence_r2_key"),
    /** pending · confirmed · disputed */
    status: text("status").notNull().default("pending"),
    varianceNote: text("variance_note"),
    varianceApprovedBy: uuid("variance_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cash_handovers_code_uq").on(t.code),
    index("cash_handovers_from_idx").on(t.fromType, t.fromId, t.status),
    index("cash_handovers_status_idx").on(t.status, t.createdAt),
  ]
);

/**
 * التسويات — دفعة تحويل مستحقات تاجر.
 * بتتولّد الاثنين والخميس (قرار ٣).
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    merchantId: uuid("merchant_id").notNull(),
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    /** ⚠️ ساعة الإغلاق — بتتقارن بـ recorded_at (ساعة السيرفر) */
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
    /** draft · approved · paid · failed · cancelled */
    status: text("status").notNull().default("draft"),

    grossCodP: bigint("gross_cod_p", { mode: "bigint" }).notNull().default(sql`0`),
    totalFeesP: bigint("total_fees_p", { mode: "bigint" }).notNull().default(sql`0`),
    adjustmentsP: bigint("adjustments_p", { mode: "bigint" }).notNull().default(sql`0`),
    netPayableP: bigint("net_payable_p", { mode: "bigint" }).notNull().default(sql`0`),

    payoutMethodId: uuid("payout_method_id"),
    payoutReference: text("payout_reference"),
    proofR2Key: text("proof_r2_key"),
    pdfR2Key: text("pdf_r2_key"),

    /** ⚠️ اعتماد شخصين فوق ٢٠ ألف ج (قرار ٦) */
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    secondApprovedBy: uuid("second_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    secondApprovedAt: timestamp("second_approved_at", { withTimezone: true }),
    requiresTwoApprovals: boolean("requires_two_approvals").notNull().default(false),

    paidBy: uuid("paid_by").references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("settlements_code_uq").on(t.code),
    index("settlements_merchant_idx").on(t.merchantId, t.createdAt),
    index("settlements_status_idx").on(t.status, t.cutoffAt),
  ]
);

/**
 * بنود التسوية.
 * ⚠️ UNIQUE(shipment_id) — الشحنة مستحيل تدخل تسويتين.
 */
export const settlementItems = pgTable(
  "settlement_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    codCollectedP: bigint("cod_collected_p", { mode: "bigint" }).notNull().default(sql`0`),
    feesP: bigint("fees_p", { mode: "bigint" }).notNull().default(sql`0`),
    netP: bigint("net_p", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    // ⚠️ الشحنة في تسوية واحدة بس، للأبد
    uniqueIndex("settlement_items_shipment_uq").on(t.shipmentId),
    index("settlement_items_settlement_idx").on(t.settlementId),
  ]
);

/** تسويات يدوية — تعويضات، غرامات، ترحيل رصيد سالب */
export const settlementAdjustments = pgTable(
  "settlement_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "cascade" }),
    /** compensation · penalty · discount · carry_forward · manual */
    type: text("type").notNull(),
    descriptionAr: text("description_ar").notNull(),
    /** موجب = لصالح التاجر · سالب = عليه */
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    evidenceR2Key: text("evidence_r2_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settlement_adj_idx").on(t.settlementId)]
);

/**
 * أرصدة التجار المخزّنة مؤقتًا (cache).
 * ⚠️ بتتكتب في نفس الترانزاكشن بتاعة القيد،
 *    وبتتقارن ليلًا بالمشتق من الدفتر (فحص I4).
 *    أي اختلاف = تجميد التسويات + تنبيه فوري.
 */
export const merchantBalances = pgTable("merchant_balances", {
  merchantId: uuid("merchant_id").primaryKey(),
  /** ✅ مؤكد وجاهز للتحويل — الكاش وصل الخزنة */
  payableConfirmedP: bigint("payable_confirmed_p", { mode: "bigint" }).notNull().default(sql`0`),
  /** ⏳ تحت التحصيل — اتسلّم بس الكاش لسه مع المندوب */
  payableInCollectionP: bigint("payable_in_collection_p", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  lastRecomputedAt: timestamp("last_recomputed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** خصومات المناديب من العجز */
export const courierDeductions = pgTable(
  "courier_deductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id").notNull(),
    sourceRunSheetId: uuid("source_run_sheet_id"),
    sourceHandoverId: uuid("source_handover_id").references(() => cashHandovers.id, {
      onDelete: "set null",
    }),
    amountP: bigint("amount_p", { mode: "bigint" }).notNull(),
    reasonAr: text("reason_ar").notNull(),
    /** pending · recovering · recovered · waived */
    status: text("status").notNull().default("pending"),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    waivedBy: uuid("waived_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("courier_deductions_idx").on(t.courierId, t.status)]
);

/** جدول أيام التحويل — الاثنين والخميس (قرار ٣) */
export const payoutSchedule = pgTable("payout_schedule", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 0=الأحد … 6=السبت */
  dayOfWeek: bigint("day_of_week", { mode: "number" }).notNull(),
  cutoffHour: bigint("cutoff_hour", { mode: "number" }).notNull().default(12),
  isActive: boolean("is_active").notNull().default(true),
});
