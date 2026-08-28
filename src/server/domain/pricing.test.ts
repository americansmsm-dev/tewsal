import { describe, it, expect } from "vitest";
import {
  resolveBasePrice,
  resolveFee,
  calculateShipment,
  calculateReturnFees,
  computeTier,
  type PriceListEntry,
  type FeeDefinition,
  type FeeOverride,
  type ShipmentPricingInput,
} from "./pricing";
import { poundsToPiastres as P, formatEGP } from "@/lib/money";

// ---------------------------------------------------------------
// بيانات الاختبار — مطابقة للبذور الحقيقية
// ---------------------------------------------------------------

const LIST_ID = "pl-2026";
const Z_CAIRO = "z-cairo";
const Z_DELTA = "z-delta";
const Z_SAEED = "z-saeed";
const G_CAIRO = "g-cai";
const G_ALX = "g-alx";
const G_ASYUT = "g-ast";

const priceList: PriceListEntry[] = [
  { priceListId: LIST_ID, zoneId: Z_CAIRO, tier: "t1", priceP: P("90") },
  { priceListId: LIST_ID, zoneId: Z_CAIRO, tier: "t2", priceP: P("80") },
  { priceListId: LIST_ID, zoneId: Z_CAIRO, tier: "t3", priceP: P("70") },
  { priceListId: LIST_ID, zoneId: Z_DELTA, tier: "t1", priceP: P("110") },
  { priceListId: LIST_ID, zoneId: Z_DELTA, tier: "t2", priceP: P("100") },
  { priceListId: LIST_ID, zoneId: Z_DELTA, tier: "t3", priceP: P("90") },
  { priceListId: LIST_ID, zoneId: Z_SAEED, tier: "t1", priceP: P("150") },
  { priceListId: LIST_ID, zoneId: Z_SAEED, tier: "t2", priceP: P("135") },
  { priceListId: LIST_ID, zoneId: Z_SAEED, tier: "t3", priceP: P("125") },
];

const feeDefs: FeeDefinition[] = [
  {
    code: "COD", nameAr: "رسوم التحصيل", calcType: "flat_plus_percent",
    valueP: P("100"), percentBp: 100, thresholdP: P("5000"),
    basis: "full_amount", isAuto: true,
  },
  { code: "RETURN", nameAr: "رسوم المرتجع", calcType: "flat", valueP: P("100"), percentBp: 0, thresholdP: 0n, basis: "full_amount", isAuto: true },
  { code: "EXTRA_PIECE", nameAr: "قطعة زائدة", calcType: "per_unit", valueP: P("5"), percentBp: 0, thresholdP: 0n, basis: "full_amount", isAuto: true },
  { code: "OVERWEIGHT_KG", nameAr: "وزن زائد", calcType: "per_unit", valueP: P("10"), percentBp: 0, thresholdP: 0n, basis: "full_amount", isAuto: true },
  { code: "FRAGILE_INSURANCE", nameAr: "تأمين القابل للكسر", calcType: "flat", valueP: P("30"), percentBp: 0, thresholdP: 0n, basis: "full_amount", isAuto: false },
];

/** قرار ٧: المرتجع ٦٥ ج برا التغطية، والإسكندرية ١٠٠ ج */
const feeOverrides: FeeOverride[] = [
  { feeCode: "RETURN", zoneId: Z_DELTA, valueP: P("65") },
  { feeCode: "RETURN", zoneId: Z_SAEED, valueP: P("65") },
  { feeCode: "RETURN", governorateId: G_ALX, valueP: P("100") },
];

function input(over: Partial<ShipmentPricingInput> = {}): ShipmentPricingInput {
  return {
    merchantId: "m-142",
    tier: "t2",
    zoneId: Z_DELTA,
    governorateId: G_ALX,
    codAmountP: P("7350"),
    paymentMethod: "cash",
    piecesCount: 1,
    allowedOpenPieces: 2,
    weightRegisteredKg: null,
    weightActualKg: null,
    isFragile: false,
    fragileInsured: false,
    codEnabled: true,
    isRemoteArea: false,
    remoteSurchargeP: 0n,
    ...over,
  };
}

// ---------------------------------------------------------------

describe("resolveBasePrice — اختيار السعر", () => {
  it("بياخد من قائمة الأسعار لما مفيش سعر خاص", () => {
    const r = resolveBasePrice({ tier: "t2", zoneId: Z_CAIRO }, priceList, []);
    expect(r.priceP).toBe(P("80"));
    expect(r.source).toBe("price_list");
    expect(r.priceListId).toBe(LIST_ID);
  });

  it("⚠️ السعر الخاص بالتاجر بيتفوق على القائمة", () => {
    const r = resolveBasePrice({ tier: "t2", zoneId: Z_CAIRO }, priceList, [
      { zoneId: Z_CAIRO, tier: null, priceP: P("65"), effectiveFrom: new Date(2020, 0), effectiveTo: null },
    ]);
    expect(r.priceP).toBe(P("65"));
    expect(r.source).toBe("merchant_override");
  });

  it("السعر الخاص بشريحة محددة بيتفوق على العام", () => {
    const r = resolveBasePrice({ tier: "t2", zoneId: Z_CAIRO }, priceList, [
      { zoneId: Z_CAIRO, tier: null, priceP: P("75"), effectiveFrom: new Date(2020, 0), effectiveTo: null },
      { zoneId: Z_CAIRO, tier: "t2", priceP: P("60"), effectiveFrom: new Date(2020, 0), effectiveTo: null },
    ]);
    expect(r.priceP).toBe(P("60"));
  });

  it("السعر الخاص المنتهي مبيتطبقش", () => {
    const r = resolveBasePrice({ tier: "t2", zoneId: Z_CAIRO }, priceList, [
      { zoneId: Z_CAIRO, tier: null, priceP: P("50"), effectiveFrom: new Date(2020, 0), effectiveTo: new Date(2021, 0) },
    ]);
    expect(r.priceP).toBe(P("80"));
  });

  it("السعر الخاص اللي لسه مبدأش مبيتطبقش", () => {
    const r = resolveBasePrice({ tier: "t2", zoneId: Z_CAIRO }, priceList, [
      { zoneId: Z_CAIRO, tier: null, priceP: P("50"), effectiveFrom: new Date(2099, 0), effectiveTo: null },
    ]);
    expect(r.priceP).toBe(P("80"));
  });

  it("بيرمي خطأ واضح لو مفيش سعر", () => {
    expect(() =>
      resolveBasePrice({ tier: "t2", zoneId: "z-unknown" }, priceList, [])
    ).toThrow(/مفيش سعر معرّف/);
  });
});

describe("resolveFee — تجاوزات الرسوم (قرار ٧)", () => {
  const ret = feeDefs.find((f) => f.code === "RETURN")!;

  it("القاهرة بتاخد الرسم الأساسي ١٠٠ ج", () => {
    expect(resolveFee(ret, feeOverrides, Z_CAIRO, G_CAIRO).valueP).toBe(P("100"));
  });

  it("أسيوط بتاخد تجاوز المنطقة ٦٥ ج", () => {
    expect(resolveFee(ret, feeOverrides, Z_SAEED, G_ASYUT).valueP).toBe(P("65"));
  });

  it("⚠️ الإسكندرية بتاخد ١٠٠ ج — تجاوز المحافظة بيكسب تجاوز المنطقة", () => {
    expect(resolveFee(ret, feeOverrides, Z_DELTA, G_ALX).valueP).toBe(P("100"));
  });
});

describe("calculateShipment — المثال الكامل من الخطة", () => {
  it("شحنة الإسكندرية ٧٣٥٠ ج — الأرقام بالظبط", () => {
    const r = calculateShipment(input(), priceList, [], feeDefs, feeOverrides);

    expect(formatEGP(r.priceP)).toBe("100.00 ج");         // شحن دلتا t2
    expect(formatEGP(r.totalFeesP)).toBe("273.50 ج");     // 100 + 173.50
    expect(formatEGP(r.merchantNetP)).toBe("7,076.50 ج"); // 7350 - 273.50
    expect(r.tierSnapshot).toBe("t2");
  });

  it("بنود الرسوم مفصّلة", () => {
    const r = calculateShipment(input(), priceList, [], feeDefs, feeOverrides);
    const codes = r.feeLines.map((l) => l.code);
    expect(codes).toEqual(["SHIPPING", "COD"]);
    expect(formatEGP(r.feeLines[1]!.amountP)).toBe("173.50 ج");
  });

  it("مجموع البنود = إجمالي الرسوم دايمًا", () => {
    const cases = [
      input(),
      input({ piecesCount: 5 }),
      input({ weightRegisteredKg: 2, weightActualKg: 5.5 }),
      input({ isFragile: true, fragileInsured: true }),
      input({ isRemoteArea: true, remoteSurchargeP: P("40") }),
    ];
    for (const c of cases) {
      const r = calculateShipment(c, priceList, [], feeDefs, feeOverrides);
      const total = r.feeLines.reduce((a, l) => a + l.amountP, 0n);
      expect(total).toBe(r.totalFeesP);
    }
  });
});

describe("الرسوم الإضافية", () => {
  it("قطع زائدة: ٥ قطع = ٣ زيادة × ٥ ج", () => {
    const r = calculateShipment(input({ piecesCount: 5 }), priceList, [], feeDefs, feeOverrides);
    const line = r.feeLines.find((l) => l.code === "EXTRA_PIECE")!;
    expect(line.qty).toBe(3);
    expect(formatEGP(line.amountP)).toBe("15.00 ج");
  });

  it("قطعتين = مفيش رسم زيادة", () => {
    const r = calculateShipment(input({ piecesCount: 2 }), priceList, [], feeDefs, feeOverrides);
    expect(r.feeLines.find((l) => l.code === "EXTRA_PIECE")).toBeUndefined();
  });

  it("وزن زائد بيتقرّب لأعلى: 5.5 - 2 = 3.5 -> ٤ كيلو", () => {
    const r = calculateShipment(
      input({ weightRegisteredKg: 2, weightActualKg: 5.5 }),
      priceList, [], feeDefs, feeOverrides
    );
    const line = r.feeLines.find((l) => l.code === "OVERWEIGHT_KG")!;
    expect(line.qty).toBe(4);
    expect(formatEGP(line.amountP)).toBe("40.00 ج");
  });

  it("وزن أقل من المسجّل = مفيش رسم", () => {
    const r = calculateShipment(
      input({ weightRegisteredKg: 5, weightActualKg: 3 }),
      priceList, [], feeDefs, feeOverrides
    );
    expect(r.feeLines.find((l) => l.code === "OVERWEIGHT_KG")).toBeUndefined();
  });

  it("⚠️ تأمين القابل للكسر بيتحاسب بس لو مدفوع", () => {
    const insured = calculateShipment(
      input({ isFragile: true, fragileInsured: true }), priceList, [], feeDefs, feeOverrides
    );
    expect(insured.feeLines.find((l) => l.code === "FRAGILE_INSURANCE")).toBeDefined();

    const notInsured = calculateShipment(
      input({ isFragile: true, fragileInsured: false }), priceList, [], feeDefs, feeOverrides
    );
    expect(notInsured.feeLines.find((l) => l.code === "FRAGILE_INSURANCE")).toBeUndefined();
  });
});

describe("التحصيل", () => {
  it("مفيش رسوم تحصيل لو الدفع مقدمًا", () => {
    const r = calculateShipment(
      input({ paymentMethod: "prepaid" }), priceList, [], feeDefs, feeOverrides
    );
    expect(r.feeLines.find((l) => l.code === "COD")).toBeUndefined();
    expect(formatEGP(r.totalFeesP)).toBe("100.00 ج"); // الشحن بس
  });

  it("مفيش رسوم تحصيل لو المبلغ صفر", () => {
    const r = calculateShipment(input({ codAmountP: 0n }), priceList, [], feeDefs, feeOverrides);
    expect(r.feeLines.find((l) => l.code === "COD")).toBeUndefined();
  });

  it("⚠️ بيرفض التحصيل في محافظة مش مغطاة", () => {
    expect(() =>
      calculateShipment(input({ codEnabled: false }), priceList, [], feeDefs, feeOverrides)
    ).toThrow(/التحصيل مش متاحة/);
  });

  it("التحصيل تحت ٥٠٠٠ = ١٠٠ ج بس", () => {
    const r = calculateShipment(input({ codAmountP: P("3000") }), priceList, [], feeDefs, feeOverrides);
    const cod = r.feeLines.find((l) => l.code === "COD")!;
    expect(formatEGP(cod.amountP)).toBe("100.00 ج");
  });
});

describe("calculateReturnFees — قرار ٤", () => {
  it("⚠️ الشحن بيتحاسب على المرتجع + رسم المرتجع", () => {
    const r = calculateReturnFees(P("100"), Z_CAIRO, G_CAIRO, feeDefs, feeOverrides, true);
    expect(formatEGP(r.totalP)).toBe("200.00 ج"); // 100 شحن + 100 مرتجع
    expect(r.feeLines.map((l) => l.code)).toEqual(["SHIPPING", "RETURN"]);
  });

  it("المرتجع من أسيوط = شحن + ٦٥ ج", () => {
    const r = calculateReturnFees(P("135"), Z_SAEED, G_ASYUT, feeDefs, feeOverrides, true);
    expect(formatEGP(r.totalP)).toBe("200.00 ج"); // 135 + 65
  });

  it("المرتجع من الإسكندرية = شحن + ١٠٠ ج", () => {
    const r = calculateReturnFees(P("100"), Z_DELTA, G_ALX, feeDefs, feeOverrides, true);
    expect(formatEGP(r.totalP)).toBe("200.00 ج"); // 100 + 100
  });

  it("لو الشحن مش بيتحاسب = رسم المرتجع بس", () => {
    const r = calculateReturnFees(P("100"), Z_CAIRO, G_CAIRO, feeDefs, feeOverrides, false);
    expect(formatEGP(r.totalP)).toBe("100.00 ج");
    expect(r.feeLines.map((l) => l.code)).toEqual(["RETURN"]);
  });
});

describe("computeTier — الشريحة من حجم الشهر اللي فات", () => {
  it.each([
    [0, "t1"], [50, "t1"], [99, "t1"],
    [100, "t2"], [250, "t2"], [400, "t2"],
    [401, "t3"], [1000, "t3"],
  ])("%i شحنة -> %s", (count, tier) => {
    expect(computeTier(count)).toBe(tier);
  });
});

describe("ثبات السعر — أهم ضمان", () => {
  it("نفس المدخلات = نفس السعر دايمًا", () => {
    const i = input();
    const a = calculateShipment(i, priceList, [], feeDefs, feeOverrides);
    const b = calculateShipment(i, priceList, [], feeDefs, feeOverrides);
    expect(a.priceP).toBe(b.priceP);
    expect(a.totalFeesP).toBe(b.totalFeesP);
    expect(a.merchantNetP).toBe(b.merchantNetP);
  });

  it("الشريحة الأعلى = سعر أقل في كل المناطق", () => {
    for (const zoneId of [Z_CAIRO, Z_DELTA, Z_SAEED]) {
      const gov = zoneId === Z_DELTA ? G_ALX : G_CAIRO;
      const t1 = calculateShipment(input({ tier: "t1", zoneId, governorateId: gov, codEnabled: true }), priceList, [], feeDefs, feeOverrides);
      const t3 = calculateShipment(input({ tier: "t3", zoneId, governorateId: gov, codEnabled: true }), priceList, [], feeDefs, feeOverrides);
      expect(t3.priceP).toBeLessThan(t1.priceP);
      expect(t3.merchantNetP).toBeGreaterThan(t1.merchantNetP);
    }
  });
});
