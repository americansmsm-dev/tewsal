import { describe, it, expect } from "vitest";
import {
  ACC,
  collectionAccount,
  buildDeliveryEntry,
  buildReturnEntry,
  buildHandoverEntry,
  buildBankDepositEntry,
  buildPayoutEntry,
  buildCompensationEntry,
  buildCancellationEntry,
  buildDisposalEntry,
  buildPickupFeeEntry,
  buildCommissionEntry,
  buildReversalEntry,
  totalDebits,
  netOnAccount,
  accountKey,
  type DraftEntry,
} from "./ledger";
import { poundsToPiastres as P, formatEGP, assertBalanced } from "@/lib/money";

const M = "m-142"; // تاجر
const C = "c-77";  // مندوب
const B = "br-cai"; // فرع
const S = "sh-001"; // شحنة
const AWB = "T26000001426";

/** كل قيد لازم يتوازن — القاعدة المقدسة */
function expectBalanced(e: DraftEntry) {
  expect(() => assertBalanced(e.lines)).not.toThrow();
}

// ---------------------------------------------------------------

describe("collectionAccount — ⚠️ طريقة الدفع بتحدد حساب مختلف", () => {
  it("الكاش بيدخل عهدة المندوب", () => {
    expect(accountKey(collectionAccount("cash", C))).toBe(`COURIER_CASH:${C}`);
  });

  it("⚠️ فودافون كاش بيروح للمحفظة — مش عهدة المندوب", () => {
    expect(accountKey(collectionAccount("vodafone_cash", C))).toBe("EWALLET_VODAFONE");
  });

  it("⚠️ إنستاباي بيروح للمحفظة", () => {
    expect(accountKey(collectionAccount("instapay", C))).toBe("EWALLET_INSTAPAY");
  });

  it("بيرفض طريقة دفع مش معروفة", () => {
    expect(() => collectionAccount("bitcoin", C)).toThrow(/غير معروفة/);
  });
});

describe("قيد التسليم — المثال المحسوب في الخطة", () => {
  const e = buildDeliveryEntry({
    shipmentId: S, merchantId: M, courierId: C, awb: AWB,
    codCollectedP: P("7350"),
    paymentMethod: "cash",
    shippingP: P("100"),
    codFeeP: P("173.50"),
    otherFeesP: 0n,
  });

  it("القيد متوازن", () => expectBalanced(e));

  it("إجمالي المدين ٧٦٢٣.٥٠ ج زي الخطة", () => {
    expect(formatEGP(totalDebits(e))).toBe("7,623.50 ج");
  });

  it("كاش المندوب زاد ٧٣٥٠ ج", () => {
    expect(formatEGP(netOnAccount(e, ACC.courierCash(C)))).toBe("7,350.00 ج");
  });

  it("مستحقات التاجر صافيها ٧٠٧٦.٥٠ ج (دائن)", () => {
    // مدين 273.50 - دائن 7350 = -7076.50 (التزام علينا)
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("-7,076.50 ج");
  });

  it("إيراد الشحن ١٠٠ ج وإيراد التحصيل ١٧٣.٥٠ ج", () => {
    expect(formatEGP(-netOnAccount(e, ACC.revenueShipping()))).toBe("100.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueCodFee()))).toBe("173.50 ج");
  });

  it("النوع والمصدر مظبوطين (للفهرس الفريد)", () => {
    expect(e.sourceType).toBe("shipment");
    expect(e.sourceId).toBe(S);
    expect(e.kind).toBe("delivery");
  });
});

describe("قيد التسليم — طرق دفع مختلفة", () => {
  const base = {
    shipmentId: S, merchantId: M, courierId: C, awb: AWB,
    codCollectedP: P("7350"), shippingP: P("100"),
    codFeeP: P("173.50"), otherFeesP: 0n,
  };

  it("⚠️ فودافون كاش: عهدة المندوب متتأثرش", () => {
    const e = buildDeliveryEntry({ ...base, paymentMethod: "vodafone_cash" });
    expectBalanced(e);
    expect(netOnAccount(e, ACC.courierCash(C))).toBe(0n);
    expect(formatEGP(netOnAccount(e, ACC.walletVodafone()))).toBe("7,350.00 ج");
  });

  it("إنستاباي: نفس الكلام", () => {
    const e = buildDeliveryEntry({ ...base, paymentMethod: "instapay" });
    expectBalanced(e);
    expect(netOnAccount(e, ACC.courierCash(C))).toBe(0n);
    expect(formatEGP(netOnAccount(e, ACC.walletInstapay()))).toBe("7,350.00 ج");
  });

  it("التاجر بياخد نفس الصافي مهما كانت طريقة الدفع", () => {
    for (const m of ["cash", "vodafone_cash", "instapay"]) {
      const e = buildDeliveryEntry({ ...base, paymentMethod: m });
      expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("-7,076.50 ج");
    }
  });
});

describe("شحنة بدون تحصيل (مدفوعة مقدمًا)", () => {
  it("الرسوم بس بتتقيّد", () => {
    const e = buildDeliveryEntry({
      shipmentId: S, merchantId: M, courierId: C, awb: AWB,
      codCollectedP: 0n, paymentMethod: "cash",
      shippingP: P("100"), codFeeP: 0n, otherFeesP: 0n,
    });
    expectBalanced(e);
    expect(netOnAccount(e, ACC.courierCash(C))).toBe(0n);
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("100.00 ج");
  });
});

describe("قيد الإرجاع — قرار ٤: الشحن بيتحاسب", () => {
  const e = buildReturnEntry({
    shipmentId: S, merchantId: M, awb: AWB,
    shippingP: P("100"), returnFeeP: P("100"),
  });

  it("متوازن", () => expectBalanced(e));

  it("⚠️ الشحن + المرتجع بيتخصموا من التاجر", () => {
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("200.00 ج");
  });

  it("مفيش سطور تحصيل", () => {
    expect(netOnAccount(e, ACC.courierCash(C))).toBe(0n);
    expect(netOnAccount(e, ACC.revenueCodFee())).toBe(0n);
  });

  it("الإيرادات مفصولة", () => {
    expect(formatEGP(-netOnAccount(e, ACC.revenueShipping()))).toBe("100.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueReturnFee()))).toBe("100.00 ج");
  });
});

describe("تسليم العهدة", () => {
  it("مطابق تمامًا", () => {
    const e = buildHandoverEntry({
      handoverId: "h-1", courierId: C, branchId: B,
      expectedP: P("4230"), receivedP: P("4230"),
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.branchCash(B)))).toBe("4,230.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.courierCash(C)))).toBe("-4,230.00 ج");
    expect(netOnAccount(e, ACC.courierReceivable(C))).toBe(0n);
  });

  it("⚠️ عجز ٥٠ ج بيتحوّل ذمة على المندوب", () => {
    const e = buildHandoverEntry({
      handoverId: "h-2", courierId: C, branchId: B,
      expectedP: P("4230"), receivedP: P("4180"),
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.branchCash(B)))).toBe("4,180.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.courierReceivable(C)))).toBe("50.00 ج");
    // عهدة المندوب اتصفّت بالكامل
    expect(formatEGP(netOnAccount(e, ACC.courierCash(C)))).toBe("-4,230.00 ج");
  });

  it("⚠️ الزيادة بتروح لالتزام مش إيراد", () => {
    const e = buildHandoverEntry({
      handoverId: "h-3", courierId: C, branchId: B,
      expectedP: P("4230"), receivedP: P("4280"),
    });
    expectBalanced(e);
    expect(formatEGP(-netOnAccount(e, ACC.cashOverSuspense()))).toBe("50.00 ج");
    // ⚠️ مش إيراد
    expect(netOnAccount(e, ACC.revenueOther())).toBe(0n);
  });

  it("الوصف بيوضح العجز والزيادة", () => {
    const ok = buildHandoverEntry({ handoverId: "a", courierId: C, branchId: B, expectedP: P("100"), receivedP: P("100") });
    const short = buildHandoverEntry({ handoverId: "b", courierId: C, branchId: B, expectedP: P("100"), receivedP: P("90") });
    const over = buildHandoverEntry({ handoverId: "c", courierId: C, branchId: B, expectedP: P("100"), receivedP: P("110") });
    expect(ok.descriptionAr).not.toMatch(/عجز|زيادة/);
    expect(short.descriptionAr).toMatch(/عجز/);
    expect(over.descriptionAr).toMatch(/زيادة/);
  });
});

describe("الإيداع البنكي", () => {
  it("من الخزنة للبنك", () => {
    const e = buildBankDepositEntry({ handoverId: "d-1", branchId: B, amountP: P("4230") });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.companyBank()))).toBe("4,230.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.branchCash(B)))).toBe("-4,230.00 ج");
  });
});

describe("دفع التسوية", () => {
  it("تحويل بنكي", () => {
    const e = buildPayoutEntry({
      settlementId: "st-1", merchantId: M, code: "STL-2026-0142",
      netPayableP: P("4071.60"), method: "bank",
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("4,071.60 ج");
    expect(formatEGP(netOnAccount(e, ACC.companyBank()))).toBe("-4,071.60 ج");
  });

  it("فودافون كاش بيخرج من المحفظة", () => {
    const e = buildPayoutEntry({
      settlementId: "st-2", merchantId: M, code: "STL-2",
      netPayableP: P("1000"), method: "vodafone_cash",
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.walletVodafone()))).toBe("-1,000.00 ج");
  });

  it("⚠️ الاستلام كاش بيضيف ٥٠ ج مصاريف مندوب", () => {
    const e = buildPayoutEntry({
      settlementId: "st-3", merchantId: M, code: "STL-3",
      netPayableP: P("1000"), method: "cash",
      cashFeeP: P("50"), branchId: B,
    });
    expectBalanced(e);
    // التاجر اتخصم منه ١٠٥٠ (١٠٠٠ تحويل + ٥٠ رسم)
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("1,050.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueOther()))).toBe("50.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.branchCash(B)))).toBe("-1,000.00 ج");
  });

  it("رسم التسريع بيتخصم إضافي ويتحوّل إيراد", () => {
    const e = buildPayoutEntry({
      settlementId: "st-4", merchantId: M, code: "STL-4",
      netPayableP: P("1000"), method: "bank", expediteFeeP: P("25"),
    });
    expectBalanced(e);
    // التاجر اتخصم منه ١٠٢٥ (١٠٠٠ تحويل + ٢٥ تسريع)
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("1,025.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueOther()))).toBe("25.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.companyBank()))).toBe("-1,000.00 ج");
  });

  it("الاستلام كاش + تسريع مع بعض", () => {
    const e = buildPayoutEntry({
      settlementId: "st-5", merchantId: M, code: "STL-5",
      netPayableP: P("1000"), method: "cash", cashFeeP: P("50"), expediteFeeP: P("25"), branchId: B,
    });
    expectBalanced(e);
    // ١٠٠٠ + ٥٠ + ٢٥ = ١٠٧٥
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("1,075.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueOther()))).toBe("75.00 ج");
  });

  it("⚠️ بيرفض التحويل بصافي صفر أو سالب", () => {
    expect(() =>
      buildPayoutEntry({ settlementId: "x", merchantId: M, code: "C", netPayableP: 0n, method: "bank" })
    ).toThrow(/صفر أو سالب/);
    expect(() =>
      buildPayoutEntry({ settlementId: "x", merchantId: M, code: "C", netPayableP: P("-100"), method: "bank" })
    ).toThrow(/carry forward/);
  });
});

describe("التعويض", () => {
  it("مصروف تعويضات مقابل مستحقات التاجر", () => {
    const e = buildCompensationEntry({
      claimId: "cl-1", merchantId: M, shipmentId: S, awb: AWB, amountP: P("600"),
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.compensationExpense()))).toBe("600.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("-600.00 ج");
  });
});

describe("رسم خدمة الاستلام — قرار ١٠", () => {
  it("بيحاسب ٥٠ ج على التاجر مقابل إيرادات أخرى", () => {
    const e = buildPickupFeeEntry({ pickupId: S, merchantId: M, code: "PU-1", feeP: P("50") });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("50.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueOther()))).toBe("50.00 ج");
    expect(e.kind).toBe("pickup_fee");
    expect(e.sourceType).toBe("pickup");
  });
  it("بيرفض رسم صفر (ضمن الحد المجاني)", () => {
    expect(() => buildPickupFeeEntry({ pickupId: S, merchantId: M, code: "PU-1", feeP: 0n })).toThrow(/المجاني/);
  });
});

describe("قيد الإلغاء بعد المخزن — قرار ٥", () => {
  it("بيحاسب الشحن على التاجر", () => {
    const e = buildCancellationEntry({ shipmentId: S, merchantId: M, awb: AWB, shippingP: P("100") });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("100.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueShipping()))).toBe("100.00 ج");
    expect(e.kind).toBe("cancellation");
  });

  it("بيرفض الإلغاء بشحن صفر (الإلغاء المبكر مجاني)", () => {
    expect(() => buildCancellationEntry({ shipmentId: S, merchantId: M, awb: AWB, shippingP: 0n })).toThrow(/مجاني/);
  });
});

describe("قيد الإتلاف — المرتجع اللي اتخلّى عنه", () => {
  it("بيحاسب الشحن بس (بدون رسم مرتجع)", () => {
    const e = buildDisposalEntry({ shipmentId: S, merchantId: M, awb: AWB, shippingP: P("100") });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.merchantPayable(M)))).toBe("100.00 ج");
    expect(formatEGP(-netOnAccount(e, ACC.revenueShipping()))).toBe("100.00 ج");
    // مفيش رسم مرتجع في الإتلاف
    expect(netOnAccount(e, ACC.revenueReturnFee())).toBe(0n);
    expect(e.kind).toBe("disposal");
  });

  it("بيرفض الإتلاف بشحن صفر", () => {
    expect(() => buildDisposalEntry({ shipmentId: S, merchantId: M, awb: AWB, shippingP: 0n })).toThrow();
  });
});

describe("عمولة المندوب — قرار ٩", () => {
  it("١٢ شحنة × ٥٠ ج = ٦٠٠ ج", () => {
    const e = buildCommissionEntry({
      runSheetId: "rs-1", courierId: C, deliveredCount: 12, amountPerDeliveryP: P("50"),
    });
    expectBalanced(e);
    expect(formatEGP(netOnAccount(e, ACC.commissionExpense()))).toBe("600.00 ج");
    expect(formatEGP(netOnAccount(e, ACC.courierCommissionPayable(C)))).toBe("-600.00 ج");
  });

  it("بيرفض صفر شحنات", () => {
    expect(() =>
      buildCommissionEntry({ runSheetId: "x", courierId: C, deliveredCount: 0, amountPerDeliveryP: P("50") })
    ).toThrow();
  });
});

describe("القيد العكسي — الطريقة الوحيدة للتصحيح", () => {
  const original = buildDeliveryEntry({
    shipmentId: S, merchantId: M, courierId: C, awb: AWB,
    codCollectedP: P("7350"), paymentMethod: "cash",
    shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: 0n,
  });

  it("العكسي متوازن", () => {
    expectBalanced(buildReversalEntry(original, "تسليم اتسجّل بالغلط"));
  });

  it("⚠️ كل حساب بيرجع لصفر بعد العكس", () => {
    const rev = buildReversalEntry(original, "خطأ إدخال");
    for (const a of [ACC.courierCash(C), ACC.merchantPayable(M), ACC.revenueShipping(), ACC.revenueCodFee()]) {
      expect(netOnAccount(original, a) + netOnAccount(rev, a)).toBe(0n);
    }
  });

  it("النوع بيتعلّم كـ reversal", () => {
    expect(buildReversalEntry(original, "سبب").kind).toBe("delivery_reversal");
  });

  it("⚠️ بيرفض العكس بدون سبب مكتوب", () => {
    expect(() => buildReversalEntry(original, "")).toThrow(/سبب مكتوب/);
    expect(() => buildReversalEntry(original, "   ")).toThrow();
  });
});

describe("⚠️ كل القيود لازم تتوازن — فحص شامل", () => {
  it("كل الأنواع بتنتج قيود متوازنة", () => {
    const entries: DraftEntry[] = [
      buildDeliveryEntry({ shipmentId: S, merchantId: M, courierId: C, awb: AWB, codCollectedP: P("7350"), paymentMethod: "cash", shippingP: P("100"), codFeeP: P("173.50"), otherFeesP: P("15") }),
      buildDeliveryEntry({ shipmentId: S, merchantId: M, courierId: C, awb: AWB, codCollectedP: P("1"), paymentMethod: "instapay", shippingP: P("0.01"), codFeeP: 0n, otherFeesP: 0n }),
      buildReturnEntry({ shipmentId: S, merchantId: M, awb: AWB, shippingP: P("135"), returnFeeP: P("65") }),
      buildHandoverEntry({ handoverId: "h", courierId: C, branchId: B, expectedP: P("999.99"), receivedP: P("1000.01") }),
      buildBankDepositEntry({ handoverId: "d", branchId: B, amountP: P("0.01") }),
      buildPayoutEntry({ settlementId: "s", merchantId: M, code: "C", netPayableP: P("0.01"), method: "bank" }),
      buildCompensationEntry({ claimId: "c", merchantId: M, shipmentId: S, awb: AWB, amountP: P("600") }),
      buildCommissionEntry({ runSheetId: "r", courierId: C, deliveredCount: 1, amountPerDeliveryP: P("50") }),
    ];
    for (const e of entries) {
      expect(() => assertBalanced(e.lines), `فشل: ${e.descriptionAr}`).not.toThrow();
      expect(e.lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("مفيش سطر مدين ودائن في نفس الوقت", () => {
    const e = buildDeliveryEntry({ shipmentId: S, merchantId: M, courierId: C, awb: AWB, codCollectedP: P("100"), paymentMethod: "cash", shippingP: P("10"), codFeeP: 0n, otherFeesP: 0n });
    for (const l of e.lines) {
      expect((l.debitP === 0n) !== (l.creditP === 0n)).toBe(true);
    }
  });
});
