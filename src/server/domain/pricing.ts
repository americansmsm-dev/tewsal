/**
 * ============================================================
 *  حساب سعر الشحنة والرسوم
 * ------------------------------------------------------------
 *  ⚠️ السعر بيتحسب **مرة واحدة عند إنشاء الشحنة** ويتخزن
 *     في price_p + price_list_id + tier_snapshot.
 *     بعد كده عمره ما يتحسب تاني — حتى لو الأسعار اتغيرت.
 *
 *     ده اللي بيمنع إن تعديل سعر النهاردة يغيّر تسوية
 *     التاجر بتاعة الأسبوع اللي فات.
 *
 *  ترتيب الأولوية في السعر:
 *    ١) سعر خاص للتاجر في المنطقة دي (merchant_price_overrides)
 *    ٢) قائمة الأسعار السارية (price_list_items)
 *    ٣) خطأ — مفيش سعر معرّف
 * ============================================================
 */
import {
  calcCodFee,
  sum,
  type Piastres,
  type CodPercentBasis,
} from "@/lib/money";
import type { MerchantTier } from "../db/schema/pricing";

// ---------------------------------------------------------------
// المدخلات
// ---------------------------------------------------------------

export interface PriceListEntry {
  priceListId: string;
  zoneId: string;
  tier: MerchantTier;
  priceP: Piastres;
}

export interface MerchantPriceOverride {
  zoneId: string;
  /** null = ينطبق على كل الشرائح */
  tier: MerchantTier | null;
  priceP: Piastres;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface FeeDefinition {
  code: string;
  nameAr: string;
  calcType: "flat" | "per_unit" | "percent" | "flat_plus_percent";
  valueP: Piastres;
  percentBp: number;
  thresholdP: Piastres;
  basis: CodPercentBasis;
  isAuto: boolean;
}

/** تجاوز رسم لمنطقة أو محافظة — الأخص بيكسب */
export interface FeeOverride {
  feeCode: string;
  zoneId?: string | null;
  governorateId?: string | null;
  valueP: Piastres;
  percentBp?: number | null;
}

export interface ShipmentPricingInput {
  merchantId: string;
  tier: MerchantTier;
  zoneId: string;
  governorateId: string;
  codAmountP: Piastres;
  paymentMethod: string;
  piecesCount: number;
  allowedOpenPieces: number;
  weightRegisteredKg: number | null;
  weightActualKg: number | null;
  isFragile: boolean;
  fragileInsured: boolean;
  /** نوع الخدمة — «exchange» بيحاسب رسم استبدال */
  serviceType?: string;
  /** المحافظة دي بتدعم التحصيل؟ */
  codEnabled: boolean;
  /** لو true: رسوم التحصيل مبتتحسبش على الأوردر — بتتحسب مرة واحدة على إجمالي التسوية */
  codFeeAtSettlement?: boolean;
  isRemoteArea: boolean;
  remoteSurchargeP: Piastres;
}

export interface FeeLine {
  code: string;
  descriptionAr: string;
  qty: number;
  unitValueP: Piastres;
  amountP: Piastres;
  isAuto: boolean;
}

export interface PricingResult {
  /** سعر الشحن الأساسي — بيتثبّت على الشحنة */
  priceP: Piastres;
  priceListId: string | null;
  /** مصدر السعر — للشفافية مع التاجر */
  priceSource: "merchant_override" | "price_list";
  tierSnapshot: MerchantTier;
  /** بنود الرسوم */
  feeLines: FeeLine[];
  totalFeesP: Piastres;
  /** صافي التاجر = التحصيل − (الشحن + الرسوم) */
  merchantNetP: Piastres;
}

// ---------------------------------------------------------------
// اختيار السعر
// ---------------------------------------------------------------

/**
 * سعر الشحن الأساسي.
 * السعر الخاص بالتاجر بيتفوق على قائمة الأسعار.
 */
export function resolveBasePrice(
  input: Pick<ShipmentPricingInput, "tier" | "zoneId">,
  priceList: readonly PriceListEntry[],
  overrides: readonly MerchantPriceOverride[],
  now = new Date()
): { priceP: Piastres; priceListId: string | null; source: "merchant_override" | "price_list" } {
  // ١) سعر خاص للتاجر — الأخص (بشريحة محددة) بيكسب
  const active = overrides.filter(
    (o) =>
      o.zoneId === input.zoneId &&
      o.effectiveFrom <= now &&
      (o.effectiveTo === null || o.effectiveTo > now) &&
      (o.tier === null || o.tier === input.tier)
  );
  if (active.length > 0) {
    const exact = active.find((o) => o.tier === input.tier) ?? active[0]!;
    return { priceP: exact.priceP, priceListId: null, source: "merchant_override" };
  }

  // ٢) قائمة الأسعار
  const entry = priceList.find(
    (p) => p.zoneId === input.zoneId && p.tier === input.tier
  );
  if (!entry) {
    throw new Error(
      `مفيش سعر معرّف للمنطقة دي مع شريحة ${input.tier} — راجع قائمة الأسعار`
    );
  }
  return { priceP: entry.priceP, priceListId: entry.priceListId, source: "price_list" };
}

// ---------------------------------------------------------------
// تطبيق تجاوزات الرسوم
// ---------------------------------------------------------------

/**
 * الرسم الفعّال بعد تطبيق التجاوزات.
 * الأولوية: تجاوز محافظة > تجاوز منطقة > التعريف الأساسي.
 *
 * مثال (قرار ٧): المرتجع ١٠٠ ج أساسي، تجاوز منطقة الدلتا ٦٥ ج،
 * وتجاوز محافظة الإسكندرية ١٠٠ ج → الإسكندرية بتاخد ١٠٠.
 */
export function resolveFee(
  def: FeeDefinition,
  overrides: readonly FeeOverride[],
  zoneId: string,
  governorateId: string
): FeeDefinition {
  const forCode = overrides.filter((o) => o.feeCode === def.code);

  const govOvr = forCode.find((o) => o.governorateId === governorateId);
  if (govOvr) {
    return {
      ...def,
      valueP: govOvr.valueP,
      percentBp: govOvr.percentBp ?? def.percentBp,
    };
  }

  const zoneOvr = forCode.find((o) => o.zoneId === zoneId && !o.governorateId);
  if (zoneOvr) {
    return {
      ...def,
      valueP: zoneOvr.valueP,
      percentBp: zoneOvr.percentBp ?? def.percentBp,
    };
  }

  return def;
}

// ---------------------------------------------------------------
// حساب الشحنة الكامل
// ---------------------------------------------------------------

/**
 * حساب سعر الشحنة وكل رسومها.
 *
 * ⚠️ بيتنده عند إنشاء الشحنة (رسوم تقديرية للعرض)
 *    وعند التسليم (رسوم فعلية بتتقيّد في الدفتر).
 */
export function calculateShipment(
  input: ShipmentPricingInput,
  priceList: readonly PriceListEntry[],
  priceOverrides: readonly MerchantPriceOverride[],
  feeDefs: readonly FeeDefinition[],
  feeOverrides: readonly FeeOverride[],
  now = new Date()
): PricingResult {
  const base = resolveBasePrice(input, priceList, priceOverrides, now);
  const feeLines: FeeLine[] = [];

  const findFee = (code: string) => {
    const def = feeDefs.find((f) => f.code === code);
    if (!def) return null;
    return resolveFee(def, feeOverrides, input.zoneId, input.governorateId);
  };

  // --- سعر الشحن نفسه ---
  feeLines.push({
    code: "SHIPPING",
    descriptionAr: "رسوم الشحن",
    qty: 1,
    unitValueP: base.priceP,
    amountP: base.priceP,
    isAuto: true,
  });

  // --- رسوم التحصيل ---
  // بتتحسب بس لو فيه مبلغ تحصيل فعلي والدفع مش مقدمًا
  if (input.codAmountP > 0n && input.paymentMethod !== "prepaid") {
    if (!input.codEnabled) {
      throw new Error("خدمة التحصيل مش متاحة في المحافظة دي");
    }
    const cod = findFee("COD");
    // رسوم التحصيل بتتحسب على إجمالي التسوية (ميعاد الفاتورة) مش على كل أوردر
    if (cod && !input.codFeeAtSettlement) {
      const amount = calcCodFee(input.codAmountP, {
        flatFee: cod.valueP,
        threshold: cod.thresholdP,
        percentBp: cod.percentBp,
        basis: cod.basis,
      });
      feeLines.push({
        code: "COD",
        descriptionAr: cod.nameAr,
        qty: 1,
        unitValueP: amount,
        amountP: amount,
        isAuto: true,
      });
    }
  }

  // --- قطع زائدة ---
  const extraPieces = Math.max(0, input.piecesCount - input.allowedOpenPieces);
  if (extraPieces > 0) {
    const f = findFee("EXTRA_PIECE");
    if (f) {
      const amount = f.valueP * BigInt(extraPieces);
      feeLines.push({
        code: "EXTRA_PIECE",
        descriptionAr: `${f.nameAr} (${extraPieces} قطعة)`,
        qty: extraPieces,
        unitValueP: f.valueP,
        amountP: amount,
        isAuto: true,
      });
    }
  }

  // --- وزن زائد ---
  if (input.weightActualKg && input.weightRegisteredKg) {
    const extraKg = Math.ceil(input.weightActualKg - input.weightRegisteredKg);
    if (extraKg > 0) {
      const f = findFee("OVERWEIGHT_KG");
      if (f) {
        const amount = f.valueP * BigInt(extraKg);
        feeLines.push({
          code: "OVERWEIGHT_KG",
          descriptionAr: `${f.nameAr} (${extraKg} كيلو)`,
          qty: extraKg,
          unitValueP: f.valueP,
          amountP: amount,
          isAuto: true,
        });
      }
    }
  }

  // --- رسم الاستبدال ---
  // بيتحاسب على شحنات الاستبدال (العميل بيرجّع حاجة وياخد بدلها)
  if (input.serviceType === "exchange") {
    const f = findFee("EXCHANGE");
    if (f && f.valueP > 0n) {
      feeLines.push({
        code: "EXCHANGE",
        descriptionAr: f.nameAr,
        qty: 1,
        unitValueP: f.valueP,
        amountP: f.valueP,
        isAuto: true,
      });
    }
  }

  // --- تأمين القابل للكسر ---
  if (input.isFragile && input.fragileInsured) {
    const f = findFee("FRAGILE_INSURANCE");
    if (f && f.valueP > 0n) {
      feeLines.push({
        code: "FRAGILE_INSURANCE",
        descriptionAr: f.nameAr,
        qty: 1,
        unitValueP: f.valueP,
        amountP: f.valueP,
        isAuto: false,
      });
    }
  }

  // --- منطقة نائية ---
  if (input.isRemoteArea && input.remoteSurchargeP > 0n) {
    feeLines.push({
      code: "REMOTE_AREA",
      descriptionAr: "رسم منطقة نائية",
      qty: 1,
      unitValueP: input.remoteSurchargeP,
      amountP: input.remoteSurchargeP,
      isAuto: true,
    });
  }

  const totalFeesP = sum(feeLines.map((l) => l.amountP));

  return {
    priceP: base.priceP,
    priceListId: base.priceListId,
    priceSource: base.source,
    tierSnapshot: input.tier,
    feeLines,
    totalFeesP,
    merchantNetP: input.codAmountP - totalFeesP,
  };
}

// ---------------------------------------------------------------
// رسوم المرتجع
// ---------------------------------------------------------------

/**
 * رسوم إرجاع الشحنة للتاجر.
 * ⚠️ قرار ٤: الشحن **بيتحاسب** على المرتجع كمان،
 *    لأنه بيستحق بمجرد دخول المخزن.
 */
export function calculateReturnFees(
  shippingPriceP: Piastres,
  zoneId: string,
  governorateId: string,
  feeDefs: readonly FeeDefinition[],
  feeOverrides: readonly FeeOverride[],
  chargeShipping = true
): { feeLines: FeeLine[]; totalP: Piastres } {
  const lines: FeeLine[] = [];

  if (chargeShipping && shippingPriceP > 0n) {
    lines.push({
      code: "SHIPPING",
      descriptionAr: "رسوم الشحن (مستحقة بدخول المخزن)",
      qty: 1,
      unitValueP: shippingPriceP,
      amountP: shippingPriceP,
      isAuto: true,
    });
  }

  const def = feeDefs.find((f) => f.code === "RETURN");
  if (def) {
    const fee = resolveFee(def, feeOverrides, zoneId, governorateId);
    lines.push({
      code: "RETURN",
      descriptionAr: fee.nameAr,
      qty: 1,
      unitValueP: fee.valueP,
      amountP: fee.valueP,
      isAuto: true,
    });
  }

  return { feeLines: lines, totalP: sum(lines.map((l) => l.amountP)) };
}

/** حساب شريحة التاجر من عدد شحنات الشهر اللي فات */
export function computeTier(lastMonthShipments: number): MerchantTier {
  if (lastMonthShipments > 400) return "t3";
  if (lastMonthShipments >= 100) return "t2";
  return "t1";
}
