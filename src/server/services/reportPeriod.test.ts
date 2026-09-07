import { describe, it, expect } from "vitest";
import { resolvePeriod, DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS } from "./reportPeriod";

const DAY_MS = 86_400_000;
const spanDays = (p: { from: string; to: string }) =>
  Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY_MS);

describe("فترة التقارير", () => {
  it("من غير بارامترات = ٩٠ يوم", () => {
    const p = resolvePeriod();
    expect(p.days).toBe(DEFAULT_PERIOD_DAYS);
    expect(spanDays(p)).toBe(DEFAULT_PERIOD_DAYS);
    expect(p.clamped).toBe(false);
  });

  it("days بيتقبل رقم أو نص", () => {
    expect(resolvePeriod({ days: 30 }).days).toBe(30);
    expect(resolvePeriod({ days: "30" }).days).toBe(30);
  });

  it("days بايظ بيرجع للافتراضي", () => {
    expect(resolvePeriod({ days: "مش رقم" }).days).toBe(DEFAULT_PERIOD_DAYS);
    expect(resolvePeriod({ days: 0 }).days).toBe(DEFAULT_PERIOD_DAYS);
    expect(resolvePeriod({ days: -5 }).days).toBe(DEFAULT_PERIOD_DAYS);
  });

  it("from/to صريحين بيتحسبوا زي ما هما", () => {
    const p = resolvePeriod({ from: "2026-01-01T00:00:00Z", to: "2026-01-31T00:00:00Z" });
    expect(p.days).toBe(30);
    expect(p.from).toBe("2026-01-01T00:00:00.000Z");
    expect(p.to).toBe("2026-01-31T00:00:00.000Z");
    expect(p.clamped).toBe(false);
  });

  it("⚠️ فترة أطول من الأقصى بتتقصّ — ده اللي بيمنع مسح الدفتر كله", () => {
    const p = resolvePeriod({ days: 5000 });
    expect(p.days).toBe(MAX_PERIOD_DAYS);
    expect(p.clamped).toBe(true);
    expect(spanDays(p)).toBe(MAX_PERIOD_DAYS);
  });

  it("from قديم أوي بيتقصّ كمان", () => {
    const p = resolvePeriod({ from: "2000-01-01T00:00:00Z" });
    expect(p.days).toBe(MAX_PERIOD_DAYS);
    expect(p.clamped).toBe(true);
  });

  it("تاريخ بايظ بيتجاهَل", () => {
    const p = resolvePeriod({ from: "يوم الاتنين", to: "بكرة" });
    expect(p.days).toBe(DEFAULT_PERIOD_DAYS);
  });

  it("البداية قبل النهاية دايمًا", () => {
    for (const days of [1, 30, 90, 365, 9999]) {
      const p = resolvePeriod({ days });
      expect(Date.parse(p.from)).toBeLessThan(Date.parse(p.to));
    }
  });
});
