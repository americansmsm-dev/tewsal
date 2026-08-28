import { describe, it, expect } from "vitest";
import {
  SEED_ZONES,
  SEED_GOVERNORATES,
  SEED_PRICES,
  SEED_FEES,
  SEED_FEE_ZONE_OVERRIDES,
  SEED_FEE_GOV_OVERRIDES,
  SEED_COMMISSION_RULES,
  SEED_SETTINGS,
  SEED_REASON_CODES,
  SEED_ACCOUNTS,
  SEED_WORKING_HOURS,
} from "./seed-data";
import { calcCodFee, formatEGP, poundsToPiastres } from "@/lib/money";
import { MERCHANT_TIERS } from "./schema/pricing";

describe("المحافظات", () => {
  it("٢٧ محافظة مصرية", () => {
    expect(SEED_GOVERNORATES).toHaveLength(27);
  });

  it("أكواد المحافظات مفيهاش تكرار", () => {
    const codes = SEED_GOVERNORATES.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("كل محافظة مربوطة بمنطقة موجودة", () => {
    const zoneCodes = SEED_ZONES.map((z) => z.code);
    for (const g of SEED_GOVERNORATES) {
      expect(zoneCodes).toContain(g.zone);
    }
  });

  it("التحصيل مفعّل في القاهرة والجيزة والإسكندرية بس", () => {
    const codEnabled = SEED_GOVERNORATES.filter((g) => g.codEnabled).map((g) => g.code);
    expect(codEnabled.sort()).toEqual(["ALX", "CAI", "GIZ"]);
  });
});

describe("قرار ٢ — الإسكندرية", () => {
  const alx = SEED_GOVERNORATES.find((g) => g.code === "ALX")!;

  it("موجودة كصف مستقل", () => {
    expect(alx).toBeDefined();
    expect(alx.nameAr).toBe("الإسكندرية");
  });

  it("مربوطة بمنطقة الدلتا (سعر الدلتا)", () => {
    expect(alx.zone).toBe("delta_canal");
  });

  it("بس ليها SLA ٤٨ ساعة زي القاهرة", () => {
    expect(alx.slaOverrideHours).toBe(48);
  });

  it("والتحصيل مفعّل فيها", () => {
    expect(alx.codEnabled).toBe(true);
  });
});

describe("الأسعار — مطابقة pricing-data.js", () => {
  const priceOf = (zone: string, tier: string) =>
    SEED_PRICES.find((p) => p.zone === zone && p.tier === tier)?.priceP;

  it("كل منطقة ليها ٣ شرائح", () => {
    expect(SEED_PRICES).toHaveLength(SEED_ZONES.length * MERCHANT_TIERS.length);
  });

  it("القاهرة والجيزة: ٩٠ / ٨٠ / ٧٠", () => {
    expect(priceOf("cairo_giza", "t1")).toBe(poundsToPiastres("90"));
    expect(priceOf("cairo_giza", "t2")).toBe(poundsToPiastres("80"));
    expect(priceOf("cairo_giza", "t3")).toBe(poundsToPiastres("70"));
  });

  it("الدلتا والقناة: ١١٠ / ١٠٠ / ٩٠", () => {
    expect(priceOf("delta_canal", "t1")).toBe(poundsToPiastres("110"));
    expect(priceOf("delta_canal", "t2")).toBe(poundsToPiastres("100"));
    expect(priceOf("delta_canal", "t3")).toBe(poundsToPiastres("90"));
  });

  it("الصعيد والبحر الأحمر: ١٥٠ / ١٣٥ / ١٢٥", () => {
    expect(priceOf("saeed_redsea", "t1")).toBe(poundsToPiastres("150"));
    expect(priceOf("saeed_redsea", "t2")).toBe(poundsToPiastres("135"));
    expect(priceOf("saeed_redsea", "t3")).toBe(poundsToPiastres("125"));
  });

  it("السعر بيقل كل ما الشريحة تكبر — في كل المناطق", () => {
    for (const z of SEED_ZONES) {
      const t1 = priceOf(z.code, "t1")!;
      const t2 = priceOf(z.code, "t2")!;
      const t3 = priceOf(z.code, "t3")!;
      expect(t1).toBeGreaterThan(t2);
      expect(t2).toBeGreaterThanOrEqual(t3);
    }
  });
});

describe("قرار ١ — رسوم التحصيل ١٪ على المبلغ كله", () => {
  const cod = SEED_FEES.find((f) => f.code === "COD")!;

  it("الأساس full_amount", () => {
    expect(cod.basis).toBe("full_amount");
  });

  it("١٠٠ ج ثابتة + ١٪ فوق ٥٠٠٠ ج", () => {
    expect(cod.valueP).toBe(poundsToPiastres("100"));
    expect(cod.percentBp).toBe(100);
    expect(cod.thresholdP).toBe(poundsToPiastres("5000"));
  });

  it("أوردر ٢٠ ألف = ٣٠٠ ج بالظبط (زي ما اتفقنا)", () => {
    const fee = calcCodFee(poundsToPiastres("20000"), {
      flatFee: cod.valueP,
      threshold: cod.thresholdP,
      percentBp: cod.percentBp,
      basis: "full_amount",
    });
    expect(formatEGP(fee)).toBe("300.00 ج");
  });

  it("أوردر ٧٣٥٠ = ١٧٣.٥٠ ج", () => {
    const fee = calcCodFee(poundsToPiastres("7350"), {
      flatFee: cod.valueP,
      threshold: cod.thresholdP,
      percentBp: cod.percentBp,
      basis: "full_amount",
    });
    expect(formatEGP(fee)).toBe("173.50 ج");
  });

  it("أوردر ٣٠٠٠ = ١٠٠ ج بس (تحت الحد)", () => {
    const fee = calcCodFee(poundsToPiastres("3000"), {
      flatFee: cod.valueP,
      threshold: cod.thresholdP,
      percentBp: cod.percentBp,
      basis: "full_amount",
    });
    expect(formatEGP(fee)).toBe("100.00 ج");
  });
});

describe("قرار ٧ — رسوم المرتجع", () => {
  it("الافتراضي ١٠٠ ج", () => {
    const ret = SEED_FEES.find((f) => f.code === "RETURN")!;
    expect(ret.valueP).toBe(poundsToPiastres("100"));
  });

  it("٦٥ ج للدلتا والصعيد", () => {
    for (const zone of ["delta_canal", "saeed_redsea"]) {
      const ovr = SEED_FEE_ZONE_OVERRIDES.find(
        (o) => o.feeCode === "RETURN" && o.zone === zone
      );
      expect(ovr?.valueP).toBe(poundsToPiastres("65"));
    }
  });

  it("الإسكندرية مستثناة — بتاخد ١٠٠ ج", () => {
    const alx = SEED_FEE_GOV_OVERRIDES.find(
      (o) => o.feeCode === "RETURN" && o.governorate === "ALX"
    );
    expect(alx?.valueP).toBe(poundsToPiastres("100"));
  });
});

describe("قرار ٩ — عمولة المندوب ٥٠ ج", () => {
  it("قاعدة افتراضية للكل", () => {
    const rule = SEED_COMMISSION_RULES[0];
    expect(rule.courierId).toBeNull();
    expect(rule.zone).toBeNull();
    expect(rule.amountP).toBe(poundsToPiastres("50"));
    expect(rule.basis).toBe("per_delivery");
  });

  it("متطابقة مع الإعداد العام", () => {
    const s = SEED_SETTINGS.find((x) => x.key === "commission.default_per_delivery_p")!;
    expect(BigInt(s.value as number)).toBe(poundsToPiastres("50"));
  });
});

describe("الرسوم من الشروط المنشورة", () => {
  const fee = (code: string) => SEED_FEES.find((f) => f.code === code)!;

  it.each([
    ["EXCHANGE", "15", "الاستبدال"],
    ["EXTRA_PIECE", "5", "قطعة زائدة"],
    ["OVERWEIGHT_KG", "10", "كيلو زائد"],
    ["CASH_PAYOUT", "50", "مصاريف مندوب للكاش"],
  ])("%s = %s ج (%s)", (code, pounds) => {
    expect(fee(code).valueP).toBe(poundsToPiastres(pounds));
  });

  it("أكواد الرسوم مفيهاش تكرار", () => {
    const codes = SEED_FEES.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("التأمين على القابل للكسر يدوي مش تلقائي", () => {
    expect(fee("FRAGILE_INSURANCE").isAuto).toBe(false);
  });
});

describe("قرارات ٣ و ٤ و ٥ و ٦ في الإعدادات", () => {
  const setting = (k: string) => SEED_SETTINGS.find((s) => s.key === k)!;

  it("قرار ٣ — التحويل الاثنين والخميس", () => {
    expect(setting("payout.days").value).toEqual(["monday", "thursday"]);
    expect(setting("payout.cutoff_hour").value).toBe(12);
  });

  it("قرار ٤ — الشحن بيتحاسب على المرتجع", () => {
    expect(setting("billing.charge_shipping_on_return").value).toBe(true);
  });

  it("قرار ٥ — الشحن بيتحاسب على الإلغاء بعد المخزن", () => {
    expect(setting("billing.charge_shipping_on_cancel_after_hub").value).toBe(true);
  });

  it("قرار ٦ — حد اعتماد الشخصين ٢٠ ألف ج", () => {
    expect(BigInt(setting("settlement.two_person_approval_threshold_p").value as number))
      .toBe(poundsToPiastres("20000"));
  });

  it("قرار ٨ — الفاتورة الإلكترونية مقفولة لحد ما يسجّل", () => {
    expect(setting("tax.eta_enabled").value).toBe(false);
    expect(setting("tax.vat_percent_bp").value).toBe(1400); // ١٤٪
  });

  it("الشرط الحديدي: التحويل بيشترط تأكيد الكاش", () => {
    expect(setting("settlement.require_cash_confirmed").value).toBe(true);
  });

  it("قواعد الشروط المنشورة", () => {
    expect(setting("pickup.free_threshold").value).toBe(5);
    expect(BigInt(setting("compensation.max_p").value as number)).toBe(
      poundsToPiastres("600")
    );
    expect(setting("shipment.allowed_open_pieces").value).toBe(2);
  });

  it("مفاتيح الإعدادات مفيهاش تكرار", () => {
    const keys = SEED_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("دليل الحسابات", () => {
  it("فيه كل الأنواع الخمسة", () => {
    const types = new Set(SEED_ACCOUNTS.map((a) => a.type));
    expect(types).toContain("asset");
    expect(types).toContain("liability");
    expect(types).toContain("revenue");
    expect(types).toContain("expense");
  });

  it("حساب مستقل لكل مندوب وكل تاجر (قوالب)", () => {
    const courierCash = SEED_ACCOUNTS.find((a) => a.code === "COURIER_CASH")!;
    const merchantPayable = SEED_ACCOUNTS.find((a) => a.code === "MERCHANT_PAYABLE")!;
    expect(courierCash.isTemplate).toBe(true);
    expect(merchantPayable.isTemplate).toBe(true);
  });

  it("المحافظ الإلكترونية منفصلة عن كاش المندوب", () => {
    expect(SEED_ACCOUNTS.find((a) => a.code === "EWALLET_VODAFONE")).toBeDefined();
    expect(SEED_ACCOUNTS.find((a) => a.code === "EWALLET_INSTAPAY")).toBeDefined();
  });

  it("الزيادة النقدية التزام مش إيراد", () => {
    const suspense = SEED_ACCOUNTS.find((a) => a.code === "CASH_OVER_SUSPENSE")!;
    expect(suspense.type).toBe("liability");
  });

  it("أكواد الحسابات مفيهاش تكرار", () => {
    const codes = SEED_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("أسباب التعذّر", () => {
  it("٨ أسباب", () => {
    expect(SEED_REASON_CODES).toHaveLength(8);
  });

  it("الرفض والعنوان الخاطئ محتاجين صورة", () => {
    for (const code of ["refused", "wrong_address"]) {
      const r = SEED_REASON_CODES.find((x) => x.code === code)!;
      expect(r.requiresPhoto).toBe(true);
    }
  });

  it("التأجيل مش بيتحسب محاولة", () => {
    const p = SEED_REASON_CODES.find((r) => r.code === "postponed")!;
    expect(p.countsAsAttempt).toBe(false);
  });
});

describe("ساعات العمل", () => {
  it("٧ أيام", () => {
    expect(SEED_WORKING_HOURS).toHaveLength(7);
  });

  it("الجمعة إجازة", () => {
    const fri = SEED_WORKING_HOURS.find((d) => d.dayOfWeek === 5)!;
    expect(fri.isWorkingDay).toBe(false);
    expect(fri.nameAr).toBe("الجمعة");
  });

  it("٦ أيام عمل", () => {
    expect(SEED_WORKING_HOURS.filter((d) => d.isWorkingDay)).toHaveLength(6);
  });
});
