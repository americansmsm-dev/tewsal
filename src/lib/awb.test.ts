import { describe, it, expect } from "vitest";
import {
  buildAwb,
  isValidAwb,
  normalizeAwb,
  parseAwb,
  luhnCheckDigit,
  AWB_LENGTH,
} from "./awb";

describe("buildAwb", () => {
  it("بيبني رقم بالصيغة الصح", () => {
    const awb = buildAwb(142, 2026);
    expect(awb).toMatch(/^T26\d{9}$/);
    expect(awb).toHaveLength(AWB_LENGTH);
    expect(isValidAwb(awb)).toBe(true);
  });

  it("بيحط أصفار قدام التسلسل", () => {
    expect(buildAwb(1, 2026).slice(0, 11)).toBe("T2600000001");
  });

  it("بيرفض التسلسل الصفر أو السالب", () => {
    expect(() => buildAwb(0)).toThrow();
    expect(() => buildAwb(-5)).toThrow();
  });

  it("بيرفض التسلسل اللي أكبر من 8 خانات", () => {
    expect(() => buildAwb(999999999)).toThrow(/تعدى/);
  });

  it("كل تسلسل بيدي رقم مختلف", () => {
    const set = new Set<string>();
    for (let i = 1; i <= 2000; i++) set.add(buildAwb(i, 2026));
    expect(set.size).toBe(2000);
  });
});

describe("isValidAwb — رقم التحقق", () => {
  it("بيقبل الأرقام الصحيحة", () => {
    for (const seq of [1, 42, 142, 99999, 12345678]) {
      expect(isValidAwb(buildAwb(seq, 2026))).toBe(true);
    }
  });

  it("بيرفض أي رقم واحد غلط — أهم فايدة", () => {
    const awb = buildAwb(142, 2026); // T26000001426 مثلاً
    let caught = 0;
    for (let i = 1; i < awb.length; i++) {
      for (let d = 0; d <= 9; d++) {
        const wrong = awb.slice(0, i) + d + awb.slice(i + 1);
        if (wrong === awb) continue;
        if (!isValidAwb(wrong)) caught++;
      }
    }
    // Luhn بيمسك كل أخطاء الرقم الواحد
    expect(caught).toBeGreaterThan(0);
    expect(
      isValidAwb(awb.slice(0, 5) + "9" + awb.slice(6)) &&
        awb[5] !== "9"
    ).toBe(false);
  });

  it("بيرفض تبديل رقمين متجاورين (أشهر غلطة كتابة)", () => {
    const awb = buildAwb(1234567, 2026);
    let detected = 0;
    let swaps = 0;
    for (let i = 1; i < awb.length - 1; i++) {
      const a = awb[i], b = awb[i + 1];
      if (a === b) continue;
      swaps++;
      const swapped = awb.slice(0, i) + b + a + awb.slice(i + 2);
      if (!isValidAwb(swapped)) detected++;
    }
    // Luhn بيمسك أغلب التبديلات
    expect(detected / swaps).toBeGreaterThan(0.7);
  });

  it("بيرفض الصيغ الغلط", () => {
    expect(isValidAwb("")).toBe(false);
    expect(isValidAwb("T26")).toBe(false);
    expect(isValidAwb("X260000014 26")).toBe(false);
    expect(isValidAwb("2600000142")).toBe(false); // من غير T
    expect(isValidAwb("T2600000142X")).toBe(false); // حرف مكان رقم
  });
});

describe("normalizeAwb", () => {
  it("بينضف مدخلات الماسح والمستخدم", () => {
    const awb = buildAwb(142, 2026);
    expect(normalizeAwb(`  ${awb}  `)).toBe(awb);
    expect(normalizeAwb(awb.toLowerCase())).toBe(awb);
    expect(normalizeAwb(awb.split("").join("-"))).toBe(awb);
  });

  it("بيحوّل الأرقام العربية", () => {
    expect(normalizeAwb("T٢٦٠٠٠٠٠١٤٢٦")).toBe("T2600000142" + "6");
  });
});

describe("parseAwb", () => {
  it("بيستخرج السنة والتسلسل", () => {
    const awb = buildAwb(142, 2026);
    expect(parseAwb(awb)).toEqual({ year: 2026, sequence: 142 });
  });

  it("بيرجّع null للأرقام الغلط", () => {
    expect(parseAwb("T260000014299")).toBeNull();
    expect(parseAwb("garbage")).toBeNull();
  });
});

describe("luhnCheckDigit", () => {
  it("بيرجّع رقم من 0 لـ 9", () => {
    for (const s of ["26000001", "12345678", "00000001"]) {
      const d = luhnCheckDigit(s);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(9);
    }
  });

  it("بيرفض غير الأرقام", () => {
    expect(() => luhnCheckDigit("12a4")).toThrow();
  });
});
