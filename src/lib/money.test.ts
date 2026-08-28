import { describe, it, expect } from "vitest";
import {
  poundsToPiastres,
  piastresToPounds,
  formatPiastres,
  formatEGP,
  pct,
  sum,
  calcCodFee,
  assertBalanced,
  type CodFeeConfig,
} from "./money";

describe("poundsToPiastres", () => {
  it("بيحوّل الجنيه لقروش صح", () => {
    expect(poundsToPiastres(100)).toBe(10000n);
    expect(poundsToPiastres("73.50")).toBe(7350n);
    expect(poundsToPiastres("0.01")).toBe(1n);
    expect(poundsToPiastres("7350")).toBe(735000n);
  });

  it("بيتعامل مع خانة عشرية واحدة", () => {
    expect(poundsToPiastres("73.5")).toBe(7350n);
  });

  it("بيتعامل مع السالب", () => {
    expect(poundsToPiastres("-50.25")).toBe(-5025n);
  });

  it("بيرفض المدخلات الغلط", () => {
    expect(() => poundsToPiastres("73.555")).toThrow();
    expect(() => poundsToPiastres("abc")).toThrow();
    expect(() => poundsToPiastres("")).toThrow();
  });

  it("مفيش خسارة دقة في المبالغ الكبيرة", () => {
    // 999,999,999.99 ج — رقم مستحيل يتمثل بدقة في float
    expect(poundsToPiastres("999999999.99")).toBe(99999999999n);
  });
});

describe("pct — النسبة المئوية", () => {
  it("بيحسب 1% صح", () => {
    expect(pct(735000n, 100)).toBe(7350n); // 1% من 7,350 ج = 73.50 ج
    expect(pct(1000000n, 100)).toBe(10000n); // 1% من 10,000 ج = 100 ج
  });

  it("بيقرّب نص لأعلى زي البشر", () => {
    // 1% من 1.005 ج = 0.01005 ج -> 1 قرش
    expect(pct(1005n, 100)).toBe(10n);
    // 0.5% من 101 قرش = 0.505 -> 1 (نص لأعلى)
    expect(pct(101n, 50)).toBe(1n);
  });

  it("بيتعامل مع الصفر", () => {
    expect(pct(0n, 100)).toBe(0n);
    expect(pct(735000n, 0)).toBe(0n);
  });

  it("بيرفض نقاط أساس غير صالحة", () => {
    expect(() => pct(100n, -1)).toThrow();
    expect(() => pct(100n, 1.5)).toThrow();
  });
});

describe("calcCodFee — رسوم التحصيل", () => {
  const cfg: CodFeeConfig = {
    flatFee: 10000n, // 100 ج
    threshold: 500000n, // 5,000 ج
    percentBp: 100, // 1%
    basis: "full_amount",
  };

  it("الرسم الثابت بس تحت الحد", () => {
    expect(calcCodFee(300000n, cfg)).toBe(10000n); // 3,000 ج -> 100 ج
    expect(calcCodFee(500000n, cfg)).toBe(10000n); // بالظبط عند الحد
  });

  it("ثابت + 1% من المبلغ كله فوق الحد", () => {
    // 7,350 ج -> 100 + 73.50 = 173.50 ج
    expect(calcCodFee(735000n, cfg)).toBe(17350n);
  });

  it("أساس excess_over_threshold بيدي نتيجة مختلفة", () => {
    const excessCfg: CodFeeConfig = { ...cfg, basis: "excess_over_threshold" };
    // 20,000 ج: full = 100 + 200 = 300 | excess = 100 + 150 = 250
    expect(calcCodFee(2000000n, cfg)).toBe(30000n);
    expect(calcCodFee(2000000n, excessCfg)).toBe(25000n);
  });

  it("صفر تحصيل = صفر رسوم", () => {
    expect(calcCodFee(0n, cfg)).toBe(0n);
  });
});

describe("assertBalanced — توازن القيد", () => {
  it("بيقبل القيد المتوازن", () => {
    expect(() =>
      assertBalanced([
        { debitP: 735000n, creditP: 0n },
        { debitP: 0n, creditP: 735000n },
      ])
    ).not.toThrow();
  });

  it("بيقبل قيد التسليم الكامل من الخطة", () => {
    expect(() =>
      assertBalanced([
        { debitP: 735000n, creditP: 0n }, // كاش المندوب
        { debitP: 0n, creditP: 735000n }, // مستحقات التاجر
        { debitP: 27350n, creditP: 0n }, // خصم الرسوم
        { debitP: 0n, creditP: 10000n }, // إيراد الشحن
        { debitP: 0n, creditP: 17350n }, // إيراد التحصيل
      ])
    ).not.toThrow();
  });

  it("بيرفض القيد غير المتوازن", () => {
    expect(() =>
      assertBalanced([
        { debitP: 735000n, creditP: 0n },
        { debitP: 0n, creditP: 700000n },
      ])
    ).toThrow(/غير متوازن/);
  });

  it("بيرفض المبالغ السالبة", () => {
    expect(() =>
      assertBalanced([
        { debitP: -100n, creditP: 0n },
        { debitP: 0n, creditP: -100n },
      ])
    ).toThrow(/سالبة/);
  });

  it("بيرفض سطر مدين ودائن في نفس الوقت", () => {
    expect(() =>
      assertBalanced([
        { debitP: 100n, creditP: 100n },
        { debitP: 0n, creditP: 0n },
      ])
    ).toThrow();
  });

  it("بيرفض القيد الفاضي", () => {
    expect(() => assertBalanced([])).toThrow(/فاضي/);
  });
});

describe("العرض", () => {
  it("formatPiastres", () => {
    expect(formatPiastres(7350n)).toBe("73.50");
    expect(formatPiastres(100n)).toBe("1.00");
    expect(formatPiastres(5n)).toBe("0.05");
    expect(formatPiastres(-7350n)).toBe("-73.50");
  });

  it("formatEGP بفواصل الآلاف", () => {
    expect(formatEGP(735000n)).toBe("7,350.00 ج");
    expect(formatEGP(100n)).toBe("1.00 ج");
    expect(formatEGP(123456789n)).toBe("1,234,567.89 ج");
  });
});

describe("رحلة الفلوس الكاملة — مثال الخطة", () => {
  it("شحنة الإسكندرية بتحسب بالظبط زي الخطة", () => {
    const cod = poundsToPiastres("7350"); // 735000n
    const shipping = poundsToPiastres("100"); // 10000n
    const codFee = calcCodFee(cod, {
      flatFee: 10000n,
      threshold: 500000n,
      percentBp: 100,
      basis: "full_amount",
    });

    expect(codFee).toBe(17350n); // 173.50 ج
    const totalFees = sum([shipping, codFee]);
    expect(totalFees).toBe(27350n); // 273.50 ج

    const merchantNet = cod - totalFees;
    expect(merchantNet).toBe(707650n); // 7,076.50 ج
    expect(formatEGP(merchantNet)).toBe("7,076.50 ج");

    // والقيد لازم يتوازن
    expect(() =>
      assertBalanced([
        { debitP: cod, creditP: 0n },
        { debitP: 0n, creditP: cod },
        { debitP: totalFees, creditP: 0n },
        { debitP: 0n, creditP: shipping },
        { debitP: 0n, creditP: codFee },
      ])
    ).not.toThrow();
  });
});
