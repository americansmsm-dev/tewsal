import { describe, it, expect } from "vitest";
import {
  normalizeEgyptMobile,
  isValidEgyptMobile,
  toWhatsAppFormat,
  whatsAppLink,
  maskPhone,
  maskName,
  formatPhoneDisplay,
  toLatinDigits,
} from "./phone";

describe("normalizeEgyptMobile — كل الأشكال اللي بتوصل من الواقع", () => {
  const expected = "01001234567";

  it.each([
    ["01001234567", "الصيغة المعيارية"],
    ["0100 123 4567", "بمسافات"],
    ["0100-123-4567", "بشرطات"],
    ["+201001234567", "دولي بعلامة زائد"],
    ["00201001234567", "دولي بأصفار"],
    ["201001234567", "دولي من غير علامة"],
    ["1001234567", "من غير الصفر"],
    ["٠١٠٠١٢٣٤٥٦٧", "أرقام عربية"],
    ["  01001234567  ", "بمسافات حوالين"],
    ["(0100) 123-4567", "بأقواس"],
  ])("بيطبّع %s (%s)", (input) => {
    expect(normalizeEgyptMobile(input)).toBe(expected);
  });

  it("بيقبل كل البادئات المصرية", () => {
    for (const p of ["010", "011", "012", "015"]) {
      expect(normalizeEgyptMobile(p + "01234567")).toBe(p + "01234567");
    }
  });

  it("بيرفض الأرقام الغلط", () => {
    expect(normalizeEgyptMobile("0123")).toBeNull(); // قصير
    expect(normalizeEgyptMobile("010012345678")).toBeNull(); // طويل
    expect(normalizeEgyptMobile("01301234567")).toBeNull(); // بادئة مش موجودة
    expect(normalizeEgyptMobile("02012345678")).toBeNull(); // أرضي
    expect(normalizeEgyptMobile("")).toBeNull();
    expect(normalizeEgyptMobile(null)).toBeNull();
    expect(normalizeEgyptMobile(undefined)).toBeNull();
    expect(normalizeEgyptMobile("مش رقم")).toBeNull();
  });
});

describe("isValidEgyptMobile", () => {
  it("بيتفق مع normalizeEgyptMobile", () => {
    expect(isValidEgyptMobile("01001234567")).toBe(true);
    expect(isValidEgyptMobile("0123")).toBe(false);
  });
});

describe("واتساب", () => {
  it("toWhatsAppFormat بيدي الصيغة الدولية", () => {
    expect(toWhatsAppFormat("01001234567")).toBe("201001234567");
    expect(toWhatsAppFormat("٠١٠٠١٢٣٤٥٦٧")).toBe("201001234567");
    expect(toWhatsAppFormat("0123")).toBeNull();
  });

  it("رقم الشركة بيتحوّل صح", () => {
    // الرقم الحقيقي من config.js
    expect(toWhatsAppFormat("01040039800")).toBe("201040039800");
  });

  it("whatsAppLink بيبني لينك صالح", () => {
    expect(whatsAppLink("01001234567")).toBe("https://wa.me/201001234567");
    const withMsg = whatsAppLink("01001234567", "شحنتك خرجت للتسليم");
    expect(withMsg).toContain("https://wa.me/201001234567?text=");
    expect(withMsg).toContain(encodeURIComponent("شحنتك خرجت للتسليم"));
  });

  it("بيرجّع null للرقم الغلط", () => {
    expect(whatsAppLink("abc")).toBeNull();
  });
});

describe("التقنيع — خصوصية صفحة التتبع العامة", () => {
  it("maskPhone بيخفي النص", () => {
    expect(maskPhone("01001234567")).toBe("010****4567");
    expect(maskPhone("+201001234567")).toBe("010****4567");
  });

  it("maskPhone بيتعامل مع الرقم الغلط", () => {
    expect(maskPhone("garbage")).toBe("***");
  });

  it("maskName بيسيب أول حرفين", () => {
    expect(maskName("أحمد محمد علي")).toBe("أح*** مح*** عل***");
    expect(maskName("محمد")).toBe("مح***");
  });

  it("maskName بيسيب الكلمات القصيرة زي ما هي", () => {
    expect(maskName("لي")).toBe("لي");
  });

  it("maskName بيتعامل مع المسافات الزيادة", () => {
    expect(maskName("  أحمد   محمد  ")).toBe("أح*** مح***");
  });
});

describe("العرض", () => {
  it("formatPhoneDisplay", () => {
    expect(formatPhoneDisplay("01001234567")).toBe("0100 123 4567");
  });

  it("بيرجّع الأصل لو مش صالح", () => {
    expect(formatPhoneDisplay("abc")).toBe("abc");
  });
});

describe("toLatinDigits", () => {
  it("بيحوّل العربي والفارسي", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toLatinDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("بيسيب اللاتيني زي ما هو", () => {
    expect(toLatinDigits("0123456789")).toBe("0123456789");
  });
});
