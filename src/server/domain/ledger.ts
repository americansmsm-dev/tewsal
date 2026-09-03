/**
 * ============================================================
 *  بناء القيود المحاسبية — Ledger Entries
 * ------------------------------------------------------------
 *  ⚠️ الملف ده بيبني القيود بس (منطق خالص، بدون قاعدة بيانات)
 *     عشان نقدر نختبره بدقة. الكتابة الفعلية في
 *     services/ledger.ts جوه ترانزاكشن.
 *
 *  ٣ قواعد مقدسة:
 *   ١) كل قيد لازم يتوازن — والدالة بترفض غير المتوازن
 *   ٢) طريقة الدفع بتحدد **حساب مختلف** (كاش vs محفظة)
 *   ٣) القيود متتعدلش — الغلط بقيد عكسي
 * ============================================================
 */
import { assertBalanced, sum, type Piastres } from "@/lib/money";

// ---------------------------------------------------------------
// أنواع الحسابات
// ---------------------------------------------------------------

/** مرجع حساب — الكود + المالك (عشان يبقى حساب مستقل لكل مندوب/تاجر) */
export interface AccountRef {
  code: string;
  ownerId?: string | null;
}

export const ACC = {
  courierCash: (courierId: string): AccountRef => ({ code: "COURIER_CASH", ownerId: courierId }),
  courierReceivable: (courierId: string): AccountRef => ({ code: "COURIER_RECEIVABLE", ownerId: courierId }),
  courierCommissionPayable: (courierId: string): AccountRef => ({ code: "COURIER_COMMISSION_PAYABLE", ownerId: courierId }),
  branchCash: (branchId: string): AccountRef => ({ code: "BRANCH_CASH", ownerId: branchId }),
  merchantPayable: (merchantId: string): AccountRef => ({ code: "MERCHANT_PAYABLE", ownerId: merchantId }),
  /** محفظة التاجر — رصيد مدفوع مقدمًا بيغطّي شحن الأوردرات اللي من غير تحصيل */
  merchantWallet: (merchantId: string): AccountRef => ({ code: "MERCHANT_WALLET", ownerId: merchantId }),
  companyBank: (acct = "main"): AccountRef => ({ code: "COMPANY_BANK", ownerId: acct }),
  walletVodafone: (): AccountRef => ({ code: "EWALLET_VODAFONE", ownerId: null }),
  walletInstapay: (): AccountRef => ({ code: "EWALLET_INSTAPAY", ownerId: null }),
  cashOverSuspense: (): AccountRef => ({ code: "CASH_OVER_SUSPENSE", ownerId: null }),
  revenueShipping: (): AccountRef => ({ code: "REVENUE_SHIPPING", ownerId: null }),
  revenueCodFee: (): AccountRef => ({ code: "REVENUE_COD_FEE", ownerId: null }),
  revenueReturnFee: (): AccountRef => ({ code: "REVENUE_RETURN_FEE", ownerId: null }),
  revenueOther: (): AccountRef => ({ code: "REVENUE_OTHER", ownerId: null }),
  compensationExpense: (): AccountRef => ({ code: "COMPENSATION_EXPENSE", ownerId: null }),
  cashVariance: (): AccountRef => ({ code: "CASH_VARIANCE", ownerId: null }),
  commissionExpense: (): AccountRef => ({ code: "COMMISSION_EXPENSE", ownerId: null }),
  fleetExpense: (): AccountRef => ({ code: "FLEET_EXPENSE", ownerId: null }),
  operatingExpense: (): AccountRef => ({ code: "OPERATING_EXPENSE", ownerId: null }),
  /** حساب مصروف بالكود (لبنود المصروفات) */
  expenseByCode: (code: string): AccountRef => ({ code, ownerId: null }),
} as const;

/**
 * ⚠️ أهم دالة في التصميم المالي.
 * طريقة الدفع بتحدد **حساب مختلف تمامًا**:
 *  - كاش      -> يدخل عهدة المندوب (لازم يسلّمه للفرع)
 *  - محفظة    -> يروح للشركة مباشرة (المندوب مالوش علاقة)
 *
 * تسجيل تحويل محفظة على إنه كاش = المندوب هيبان عليه عجز
 * بمبلغ مش مسؤول عنه. ده أشهر سبب لخلافات المناديب.
 */
export function collectionAccount(paymentMethod: string, courierId: string): AccountRef {
  switch (paymentMethod) {
    case "cash":
      return ACC.courierCash(courierId);
    case "vodafone_cash":
      return ACC.walletVodafone();
    case "instapay":
      return ACC.walletInstapay();
    case "card":
      return ACC.companyBank("gateway");
    default:
      throw new Error(`طريقة دفع غير معروفة: "${paymentMethod}"`);
  }
}

// ---------------------------------------------------------------
// بنية القيد
// ---------------------------------------------------------------

export interface DraftLine {
  account: AccountRef;
  debitP: Piastres;
  creditP: Piastres;
  memo?: string;
  shipmentId?: string;
  merchantId?: string;
  courierId?: string;
}

export interface DraftEntry {
  descriptionAr: string;
  sourceType: "shipment" | "pickup" | "run_sheet" | "cash_handover" | "settlement" | "claim" | "manual";
  sourceId: string;
  /** delivery · return · payout · handover · commission · compensation */
  kind: string;
  lines: DraftLine[];
}

/** بناء قيد مع التحقق من توازنه فورًا */
function entry(e: DraftEntry): DraftEntry {
  assertBalanced(e.lines);
  return e;
}

// ---------------------------------------------------------------
// ١) التسليم والتحصيل
// ---------------------------------------------------------------

export interface DeliveryInput {
  shipmentId: string;
  merchantId: string;
  courierId: string;
  awb: string;
  /** المبلغ المحصّل فعليًا */
  codCollectedP: Piastres;
  paymentMethod: string;
  /** سعر الشحن المُثبّت */
  shippingP: Piastres;
  /** رسوم التحصيل */
  codFeeP: Piastres;
  /** أي رسوم إضافية (قطع زائدة، وزن، تأمين...) */
  otherFeesP: Piastres;
  /** الحساب اللي الرسوم تتخصم منه — افتراضي مستحقات التاجر.
   *  في الأوردر الـwallet (تحصيل صفر) بيبقى محفظة التاجر. */
  chargeAccount?: AccountRef;
}

/**
 * قيد التسليم — المثال المحسوب في الخطة.
 *
 * تحصيل ٧٣٥٠ ج · شحن ١٠٠ ج · تحصيل ١٧٣.٥٠ ج:
 *   مدين  كاش المندوب        735,000
 *       دائن  مستحقات التاجر     735,000
 *   مدين  مستحقات التاجر      27,350
 *       دائن  إيراد الشحن        10,000
 *       دائن  إيراد التحصيل      17,350
 */
export function buildDeliveryEntry(i: DeliveryInput): DraftEntry {
  const totalFees = i.shippingP + i.codFeeP + i.otherFeesP;
  const charge = i.chargeAccount ?? ACC.merchantPayable(i.merchantId);
  const lines: DraftLine[] = [];

  // التحصيل: بيدخل حساب حسب طريقة الدفع
  if (i.codCollectedP > 0n) {
    lines.push({
      account: collectionAccount(i.paymentMethod, i.courierId),
      debitP: i.codCollectedP,
      creditP: 0n,
      memo: `تحصيل ${i.awb}`,
      shipmentId: i.shipmentId,
      courierId: i.paymentMethod === "cash" ? i.courierId : undefined,
    });
    lines.push({
      account: ACC.merchantPayable(i.merchantId),
      debitP: 0n,
      creditP: i.codCollectedP,
      memo: `مستحق للتاجر — ${i.awb}`,
      shipmentId: i.shipmentId,
      merchantId: i.merchantId,
    });
  }

  // الرسوم: بتتخصم من مستحقات التاجر (أو محفظته في الأوردر الـwallet) وتتحول لإيراد
  if (totalFees > 0n) {
    lines.push({
      account: charge,
      debitP: totalFees,
      creditP: 0n,
      memo: `رسوم ${i.awb}`,
      shipmentId: i.shipmentId,
      merchantId: i.merchantId,
    });
    if (i.shippingP > 0n) {
      lines.push({
        account: ACC.revenueShipping(),
        debitP: 0n,
        creditP: i.shippingP,
        memo: `شحن ${i.awb}`,
        shipmentId: i.shipmentId,
      });
    }
    if (i.codFeeP > 0n) {
      lines.push({
        account: ACC.revenueCodFee(),
        debitP: 0n,
        creditP: i.codFeeP,
        memo: `تحصيل ${i.awb}`,
        shipmentId: i.shipmentId,
      });
    }
    if (i.otherFeesP > 0n) {
      lines.push({
        account: ACC.revenueOther(),
        debitP: 0n,
        creditP: i.otherFeesP,
        memo: `رسوم إضافية ${i.awb}`,
        shipmentId: i.shipmentId,
      });
    }
  }

  return entry({
    descriptionAr: `تسليم الشحنة ${i.awb}`,
    sourceType: "shipment",
    sourceId: i.shipmentId,
    kind: "delivery",
    lines,
  });
}

// ---------------------------------------------------------------
// ٢) الإرجاع للتاجر (قرار ٤: الشحن بيتحاسب)
// ---------------------------------------------------------------

export interface ReturnInput {
  shipmentId: string;
  merchantId: string;
  awb: string;
  shippingP: Piastres;
  returnFeeP: Piastres;
  /** الحساب اللي الرسوم تتخصم منه — افتراضي مستحقات التاجر (محفظته في الأوردر الـwallet) */
  chargeAccount?: AccountRef;
}

export function buildReturnEntry(i: ReturnInput): DraftEntry {
  const total = i.shippingP + i.returnFeeP;
  const charge = i.chargeAccount ?? ACC.merchantPayable(i.merchantId);
  const lines: DraftLine[] = [
    {
      account: charge,
      debitP: total,
      creditP: 0n,
      memo: `رسوم إرجاع ${i.awb}`,
      shipmentId: i.shipmentId,
      merchantId: i.merchantId,
    },
  ];
  if (i.shippingP > 0n) {
    lines.push({
      account: ACC.revenueShipping(),
      debitP: 0n,
      creditP: i.shippingP,
      memo: `شحن مستحق ${i.awb}`,
      shipmentId: i.shipmentId,
    });
  }
  if (i.returnFeeP > 0n) {
    lines.push({
      account: ACC.revenueReturnFee(),
      debitP: 0n,
      creditP: i.returnFeeP,
      memo: `رسم مرتجع ${i.awb}`,
      shipmentId: i.shipmentId,
    });
  }
  return entry({
    descriptionAr: `إرجاع الشحنة ${i.awb} للتاجر`,
    sourceType: "shipment",
    sourceId: i.shipmentId,
    kind: "return",
    lines,
  });
}

// ---------------------------------------------------------------
// ٢.١) الإلغاء بعد دخول المخزن (قرار ٥: الشحن بيتحاسب)
// ---------------------------------------------------------------

/**
 * إلغاء بعد الاستلام أو دخول المخزن — الشحن بيستحق.
 * ⚠️ الإلغاء قبل الاستلام مجاني ومبيعملش قيد أصلًا.
 */
export function buildCancellationEntry(i: {
  shipmentId: string;
  merchantId: string;
  awb: string;
  shippingP: Piastres;
  chargeAccount?: AccountRef;
}): DraftEntry {
  if (i.shippingP <= 0n) {
    throw new Error("إلغاء بشحن صفر مبيعملش قيد — الإلغاء قبل الاستلام مجاني");
  }
  return entry({
    descriptionAr: `إلغاء الشحنة ${i.awb} بعد دخول المخزن`,
    sourceType: "shipment",
    sourceId: i.shipmentId,
    kind: "cancellation",
    lines: [
      {
        account: i.chargeAccount ?? ACC.merchantPayable(i.merchantId),
        debitP: i.shippingP,
        creditP: 0n,
        memo: `شحن مستحق على الإلغاء ${i.awb}`,
        shipmentId: i.shipmentId,
        merchantId: i.merchantId,
      },
      {
        account: ACC.revenueShipping(),
        debitP: 0n,
        creditP: i.shippingP,
        memo: `شحن ${i.awb}`,
        shipmentId: i.shipmentId,
      },
    ],
  });
}

// ---------------------------------------------------------------
// ٢.١ب) إتلاف المرتجع بعد المدة (البضاعة اتخلّى عنها)
// ---------------------------------------------------------------

/**
 * إتلاف مرتجع شاخ على الرف — التاجر مش بيستلمه.
 * الشحن بيستحق (البضاعة دخلت المقر واتشحنت) زي المرتجع بالظبط،
 * بس **من غير رسم مرتجع** لأن مفيش رحلة إرجاع فعلية حصلت.
 *
 * ⚠️ زي الإلغاء بعد المخزن، لو الشحن صفر مفيش قيد.
 */
export function buildDisposalEntry(i: {
  shipmentId: string;
  merchantId: string;
  awb: string;
  shippingP: Piastres;
  chargeAccount?: AccountRef;
}): DraftEntry {
  if (i.shippingP <= 0n) {
    throw new Error("إتلاف بشحن صفر مبيعملش قيد");
  }
  return entry({
    descriptionAr: `إتلاف المرتجع ${i.awb} بعد المدة`,
    sourceType: "shipment",
    sourceId: i.shipmentId,
    kind: "disposal",
    lines: [
      {
        account: i.chargeAccount ?? ACC.merchantPayable(i.merchantId),
        debitP: i.shippingP,
        creditP: 0n,
        memo: `شحن مستحق على الإتلاف ${i.awb}`,
        shipmentId: i.shipmentId,
        merchantId: i.merchantId,
      },
      {
        account: ACC.revenueShipping(),
        debitP: 0n,
        creditP: i.shippingP,
        memo: `شحن ${i.awb}`,
        shipmentId: i.shipmentId,
      },
    ],
  });
}

// ---------------------------------------------------------------
// ٢.٢) رسم خدمة الاستلام (قرار ١٠: أقل من ٥ أوردرات → ٥٠ ج)
// ---------------------------------------------------------------

/**
 * رسم خدمة الاستلام — بيتقيّد على التاجر عند تأكيد الاستلام
 * لو عدد الأوردرات أقل من الحد المجاني.
 */
export function buildPickupFeeEntry(i: {
  pickupId: string;
  merchantId: string;
  code: string;
  feeP: Piastres;
}): DraftEntry {
  if (i.feeP <= 0n) {
    throw new Error("رسم استلام صفر مبيعملش قيد — الطلب ضمن الحد المجاني");
  }
  return entry({
    descriptionAr: `رسم خدمة استلام — ${i.code}`,
    sourceType: "pickup",
    sourceId: i.pickupId,
    kind: "pickup_fee",
    lines: [
      {
        account: ACC.merchantPayable(i.merchantId),
        debitP: i.feeP,
        creditP: 0n,
        memo: `رسم استلام ${i.code}`,
        merchantId: i.merchantId,
      },
      {
        account: ACC.revenueOther(),
        debitP: 0n,
        creditP: i.feeP,
        memo: `رسم استلام ${i.code}`,
      },
    ],
  });
}

// ---------------------------------------------------------------
// ٣) تسليم العهدة النقدية
// ---------------------------------------------------------------

export interface HandoverInput {
  handoverId: string;
  courierId: string;
  branchId: string;
  /** المتوقع حسب الدفتر */
  expectedP: Piastres;
  /** اللي اتسلّم فعلًا */
  receivedP: Piastres;
}

/**
 * تسليم العهدة — مع التعامل مع العجز والزيادة.
 *
 * ⚠️ الزيادة بتروح لحساب **التزام** (زيادة نقدية غير محددة)
 *    مش لإيراد — لأننا لسه معرفناش مصدرها. تسجيلها إيراد
 *    بالساكت بيخفي مشكلة حقيقية.
 */
export function buildHandoverEntry(i: HandoverInput): DraftEntry {
  const variance = i.receivedP - i.expectedP;
  const lines: DraftLine[] = [
    {
      account: ACC.branchCash(i.branchId),
      debitP: i.receivedP,
      creditP: 0n,
      memo: "استلام عهدة",
    },
  ];

  if (variance < 0n) {
    // عجز — بيتحوّل ذمة على المندوب
    lines.push({
      account: ACC.courierReceivable(i.courierId),
      debitP: -variance,
      creditP: 0n,
      memo: "عجز في العهدة",
      courierId: i.courierId,
    });
  } else if (variance > 0n) {
    // زيادة — التزام لحد ما نعرف مصدرها
    lines.push({
      account: ACC.cashOverSuspense(),
      debitP: 0n,
      creditP: variance,
      memo: "زيادة نقدية غير محددة",
      courierId: i.courierId,
    });
  }

  lines.push({
    account: ACC.courierCash(i.courierId),
    debitP: 0n,
    creditP: i.expectedP,
    memo: "تصفية عهدة المندوب",
    courierId: i.courierId,
  });

  return entry({
    descriptionAr:
      variance === 0n
        ? "تسليم عهدة نقدية"
        : variance < 0n
          ? "تسليم عهدة نقدية (بعجز)"
          : "تسليم عهدة نقدية (بزيادة)",
    sourceType: "cash_handover",
    sourceId: i.handoverId,
    kind: "handover",
    lines,
  });
}

// ---------------------------------------------------------------
// ٤) الإيداع البنكي
// ---------------------------------------------------------------

export function buildBankDepositEntry(i: {
  handoverId: string;
  branchId: string;
  amountP: Piastres;
  bankAccount?: string;
}): DraftEntry {
  return entry({
    descriptionAr: "إيداع بنكي من خزنة الفرع",
    sourceType: "cash_handover",
    sourceId: i.handoverId,
    kind: "bank_deposit",
    lines: [
      { account: ACC.companyBank(i.bankAccount ?? "main"), debitP: i.amountP, creditP: 0n, memo: "إيداع" },
      { account: ACC.branchCash(i.branchId), debitP: 0n, creditP: i.amountP, memo: "خروج من الخزنة" },
    ],
  });
}

// ---------------------------------------------------------------
// ٤.١) شحن محفظة التاجر (إيداع مقدم)
// ---------------------------------------------------------------

/**
 * التاجر بيشحن محفظته فلوس عشان يغطّي شحن الأوردرات اللي من غير
 * تحصيل. الفلوس بتدخل خزنة الفرع (أو البنك) وتتسجّل رصيد للتاجر.
 *   مدين  خزنة الفرع / البنك
 *       دائن  محفظة التاجر (التزام علينا)
 */
export function buildWalletDepositEntry(i: {
  depositId: string;
  merchantId: string;
  amountP: Piastres;
  /** cash → خزنة الفرع · bank/instapay/vodafone_cash → حساب مناسب */
  method: string;
  branchId?: string;
}): DraftEntry {
  if (i.amountP <= 0n) throw new Error("إيداع محفظة بمبلغ صفر مبيعملش قيد");
  const source: AccountRef =
    i.method === "vodafone_cash"
      ? ACC.walletVodafone()
      : i.method === "instapay"
        ? ACC.walletInstapay()
        : i.method === "bank"
          ? ACC.companyBank()
          : ACC.branchCash(i.branchId ?? "main");
  return entry({
    descriptionAr: "شحن محفظة التاجر",
    sourceType: "manual",
    sourceId: i.depositId,
    kind: "wallet_deposit",
    lines: [
      { account: source, debitP: i.amountP, creditP: 0n, memo: "استلام شحن محفظة", merchantId: i.merchantId },
      { account: ACC.merchantWallet(i.merchantId), debitP: 0n, creditP: i.amountP, memo: "رصيد محفظة", merchantId: i.merchantId },
    ],
  });
}

// ---------------------------------------------------------------
// ٥) دفع التسوية للتاجر
// ---------------------------------------------------------------

export interface PayoutInput {
  settlementId: string;
  merchantId: string;
  code: string;
  netPayableP: Piastres;
  /** vodafone_cash · instapay · bank · cash */
  method: string;
  /** رسم مصاريف المندوب لو الاستلام كاش (٥٠ ج) */
  cashFeeP?: Piastres;
  /** رسم تسريع التحصيل/التحويل (اختياري، بطلب التاجر) */
  expediteFeeP?: Piastres;
  branchId?: string;
}

export function buildPayoutEntry(i: PayoutInput): DraftEntry {
  if (i.netPayableP <= 0n) {
    throw new Error("مينفعش تحويل بصافي صفر أو سالب — استخدم ترحيل رصيد (carry forward)");
  }

  const cashFee = i.cashFeeP ?? 0n;
  const lines: DraftLine[] = [
    {
      account: ACC.merchantPayable(i.merchantId),
      debitP: i.netPayableP,
      creditP: 0n,
      memo: `تحويل مستحقات — ${i.code}`,
      merchantId: i.merchantId,
    },
  ];

  const source: AccountRef =
    i.method === "vodafone_cash"
      ? ACC.walletVodafone()
      : i.method === "instapay"
        ? ACC.walletInstapay()
        : i.method === "cash"
          ? ACC.branchCash(i.branchId ?? "main")
          : ACC.companyBank();

  lines.push({
    account: source,
    debitP: 0n,
    creditP: i.netPayableP,
    memo: `صرف — ${i.code}`,
    merchantId: i.merchantId,
  });

  // رسم الاستلام كاش (٥٠ ج) — بيتخصم إضافي ويتحول إيراد
  if (cashFee > 0n) {
    lines.push({
      account: ACC.merchantPayable(i.merchantId),
      debitP: cashFee,
      creditP: 0n,
      memo: "مصاريف مندوب — استلام كاش",
      merchantId: i.merchantId,
    });
    lines.push({
      account: ACC.revenueOther(),
      debitP: 0n,
      creditP: cashFee,
      memo: "إيراد مصاريف مندوب",
      merchantId: i.merchantId,
    });
  }

  // رسم التسريع (بطلب التاجر) — بيتخصم إضافي ويتحول إيراد
  const expediteFee = i.expediteFeeP ?? 0n;
  if (expediteFee > 0n) {
    lines.push({
      account: ACC.merchantPayable(i.merchantId),
      debitP: expediteFee,
      creditP: 0n,
      memo: "رسم تسريع",
      merchantId: i.merchantId,
    });
    lines.push({
      account: ACC.revenueOther(),
      debitP: 0n,
      creditP: expediteFee,
      memo: "إيراد تسريع",
      merchantId: i.merchantId,
    });
  }

  return entry({
    descriptionAr: `تحويل مستحقات التاجر — ${i.code}`,
    sourceType: "settlement",
    sourceId: i.settlementId,
    kind: "payout",
    lines,
  });
}

// ---------------------------------------------------------------
// ٦) التعويض عن فقد أو تلف
// ---------------------------------------------------------------

export function buildCompensationEntry(i: {
  claimId: string;
  merchantId: string;
  shipmentId: string;
  awb: string;
  amountP: Piastres;
}): DraftEntry {
  return entry({
    descriptionAr: `تعويض عن الشحنة ${i.awb}`,
    sourceType: "claim",
    sourceId: i.claimId,
    kind: "compensation",
    lines: [
      { account: ACC.compensationExpense(), debitP: i.amountP, creditP: 0n, memo: `تعويض ${i.awb}`, shipmentId: i.shipmentId },
      { account: ACC.merchantPayable(i.merchantId), debitP: 0n, creditP: i.amountP, memo: `تعويض ${i.awb}`, merchantId: i.merchantId, shipmentId: i.shipmentId },
    ],
  });
}

// ---------------------------------------------------------------
// ٧) عمولة المندوب (قرار ٩: ٥٠ ج لكل شحنة)
// ---------------------------------------------------------------

export function buildCommissionEntry(i: {
  runSheetId: string;
  courierId: string;
  deliveredCount: number;
  amountPerDeliveryP: Piastres;
}): DraftEntry {
  const total = i.amountPerDeliveryP * BigInt(i.deliveredCount);
  if (total <= 0n) throw new Error("مفيش عمولة تتقيّد");

  return entry({
    descriptionAr: `عمولة ${i.deliveredCount} شحنة`,
    sourceType: "run_sheet",
    sourceId: i.runSheetId,
    kind: "commission",
    lines: [
      { account: ACC.commissionExpense(), debitP: total, creditP: 0n, memo: "عمولات مناديب", courierId: i.courierId },
      { account: ACC.courierCommissionPayable(i.courierId), debitP: 0n, creditP: total, memo: "مستحق للمندوب", courierId: i.courierId },
    ],
  });
}

// ---------------------------------------------------------------
// ١٠) رسم على التاجر (تخزين/فُلفيلمنت) — إيراد إضافي
// ---------------------------------------------------------------

/** رسم بيتحاسب على التاجر ويتحوّل إيراد (رسوم متجر إلكتروني/تخزين). */
export function buildMerchantChargeEntry(i: {
  sourceId: string;
  merchantId: string;
  amountP: Piastres;
  kind: string;
  memo: string;
  /** حساب الإيراد — افتراضي إيرادات أخرى (مثال: إيراد التحصيل للرسم الدوري) */
  revenueAccount?: AccountRef;
}): DraftEntry {
  if (i.amountP <= 0n) throw new Error("رسم صفر مبيعملش قيد");
  return entry({
    descriptionAr: i.memo,
    sourceType: "manual",
    sourceId: i.sourceId,
    kind: i.kind,
    lines: [
      { account: ACC.merchantPayable(i.merchantId), debitP: i.amountP, creditP: 0n, memo: i.memo, merchantId: i.merchantId },
      { account: i.revenueAccount ?? ACC.revenueOther(), debitP: 0n, creditP: i.amountP, memo: i.memo, merchantId: i.merchantId },
    ],
  });
}

// ---------------------------------------------------------------
// ٩) مصروف تشغيلي (بند مصروفات / أسطول)
// ---------------------------------------------------------------

/**
 * مصروف فعلي: مدين حساب المصروف / دائن مصدر الدفع (خزنة الفرع أو البنك).
 */
export function buildExpenseEntry(i: {
  expenseId: string;
  code: string;
  expenseAccountCode: string;
  amountP: Piastres;
  paidFrom: "branch_cash" | "bank";
  branchId: string;
}): DraftEntry {
  if (i.amountP <= 0n) throw new Error("مصروف بمبلغ صفر مبيعملش قيد");
  const source: AccountRef = i.paidFrom === "bank" ? ACC.companyBank() : ACC.branchCash(i.branchId);
  return entry({
    descriptionAr: `مصروف — ${i.code}`,
    sourceType: "manual",
    sourceId: i.expenseId,
    kind: "expense",
    lines: [
      { account: ACC.expenseByCode(i.expenseAccountCode), debitP: i.amountP, creditP: 0n, memo: `مصروف ${i.code}` },
      { account: source, debitP: 0n, creditP: i.amountP, memo: `دفع مصروف ${i.code}` },
    ],
  });
}

// ---------------------------------------------------------------
// ٨) القيد العكسي — الطريقة الوحيدة لتصحيح غلط
// ---------------------------------------------------------------

/**
 * ⚠️ القيود متتعدلش أبدًا. الغلط بيتصلّح بقيد عكسي:
 *    كل سطر بيتقلب (المدين يبقى دائن والعكس).
 *    التاريخ بيفضل كامل ومحدش يقدر يمسح أثره.
 */
export function buildReversalEntry(
  original: DraftEntry,
  reason: string
): DraftEntry {
  if (!reason.trim()) {
    throw new Error("القيد العكسي لازم يكون له سبب مكتوب");
  }
  return entry({
    descriptionAr: `عكس: ${original.descriptionAr} — ${reason}`,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    kind: `${original.kind}_reversal`,
    lines: original.lines.map((l) => ({
      ...l,
      debitP: l.creditP,
      creditP: l.debitP,
      memo: l.memo ? `عكس: ${l.memo}` : "عكس",
    })),
  });
}

// ---------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------

/** إجمالي المدين — للتحقق والتقارير */
export function totalDebits(e: DraftEntry): Piastres {
  return sum(e.lines.map((l) => l.debitP));
}

/** مفتاح الحساب الفريد */
export function accountKey(a: AccountRef): string {
  return a.ownerId ? `${a.code}:${a.ownerId}` : a.code;
}

/** صافي الحركة على حساب معيّن في القيد */
export function netOnAccount(e: DraftEntry, a: AccountRef): Piastres {
  const key = accountKey(a);
  return e.lines
    .filter((l) => accountKey(l.account) === key)
    .reduce<Piastres>((acc, l) => acc + l.debitP - l.creditP, 0n);
}
