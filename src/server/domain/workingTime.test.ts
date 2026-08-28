import { describe, it, expect } from "vitest";
import {
  addWorkingHours,
  addWorkingDays,
  isWorkingDay,
  isWithinWorkingHours,
  computePromisedAt,
  isSlaBreached,
  hoursUntilPromised,
  type WorkingTimeConfig,
} from "./workingTime";

/** الإعداد الافتراضي: ٩ص-٦م، الجمعة إجازة */
const cfg: WorkingTimeConfig = {
  workingHours: [
    { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // أحد
    { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // اثنين
    { dayOfWeek: 2, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // ثلاثاء
    { dayOfWeek: 3, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // أربعاء
    { dayOfWeek: 4, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // خميس
    { dayOfWeek: 5, openTime: null, closeTime: null, isWorkingDay: false },      // جمعة
    { dayOfWeek: 6, openTime: "09:00", closeTime: "18:00", isWorkingDay: true }, // سبت
  ],
  holidays: [
    { date: "2026-04-20", nameAr: "عيد الفطر", isWorkingDay: false },
    { date: "2026-04-21", nameAr: "عيد الفطر", isWorkingDay: false },
  ],
};

/** تاريخ بتوقيت القاهرة (+02:00 شتاءً / +03:00 صيفًا) */
function cairo(iso: string): Date {
  return new Date(iso);
}

/** التاريخ بتوقيت القاهرة كنص YYYY-MM-DD */
function cairoDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function cairoHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo", hour: "2-digit", hour12: false,
    }).format(d)
  );
}

describe("isWorkingDay", () => {
  it("الجمعة إجازة", () => {
    // 2026-08-28 جمعة
    expect(isWorkingDay(cairo("2026-08-28T10:00:00+03:00"), cfg)).toBe(false);
  });

  it("الأحد والاثنين والخميس أيام عمل", () => {
    expect(isWorkingDay(cairo("2026-08-30T10:00:00+03:00"), cfg)).toBe(true); // أحد
    expect(isWorkingDay(cairo("2026-08-31T10:00:00+03:00"), cfg)).toBe(true); // اثنين
    expect(isWorkingDay(cairo("2026-08-27T10:00:00+03:00"), cfg)).toBe(true); // خميس
  });

  it("العطلة الرسمية مش يوم عمل", () => {
    expect(isWorkingDay(cairo("2026-04-20T10:00:00+03:00"), cfg)).toBe(false);
  });
});

describe("isWithinWorkingHours", () => {
  it("١٠ صباحًا يوم عمل = وقت عمل", () => {
    expect(isWithinWorkingHours(cairo("2026-08-30T10:00:00+03:00"), cfg)).toBe(true);
  });

  it("٧ صباحًا قبل الفتح", () => {
    expect(isWithinWorkingHours(cairo("2026-08-30T07:00:00+03:00"), cfg)).toBe(false);
  });

  it("٨ مساءً بعد القفل", () => {
    expect(isWithinWorkingHours(cairo("2026-08-30T20:00:00+03:00"), cfg)).toBe(false);
  });

  it("الجمعة مفيش وقت عمل خالص", () => {
    expect(isWithinWorkingHours(cairo("2026-08-28T12:00:00+03:00"), cfg)).toBe(false);
  });
});

describe("addWorkingHours — ⚠️ مش مجرد +48 ساعة", () => {
  it("ساعتين في نص يوم العمل", () => {
    const start = cairo("2026-08-30T10:00:00+03:00"); // أحد ١٠ص
    const end = addWorkingHours(start, 2, cfg);
    expect(cairoDate(end)).toBe("2026-08-30");
    expect(cairoHour(end)).toBe(12);
  });

  it("بيعدّي على قفل اليوم لليوم اللي بعده", () => {
    const start = cairo("2026-08-30T17:00:00+03:00"); // أحد ٥م (فاضل ساعة)
    const end = addWorkingHours(start, 3, cfg); // ساعة النهاردة + ساعتين بكرة
    expect(cairoDate(end)).toBe("2026-08-31"); // اثنين
    expect(cairoHour(end)).toBe(11);
  });

  it("⚠️ بيتخطى الجمعة", () => {
    // خميس ٤م، فاضل ساعتين. +٤ ساعات عمل
    const start = cairo("2026-08-27T16:00:00+03:00");
    const end = addWorkingHours(start, 4, cfg);
    // ساعتين الخميس، والجمعة إجازة، فباقي ساعتين السبت من ٩ص
    expect(cairoDate(end)).toBe("2026-08-29"); // سبت
    expect(cairoHour(end)).toBe(11);
  });

  it("٤٨ ساعة عمل من الأحد ٩ص", () => {
    const start = cairo("2026-08-30T09:00:00+03:00");
    const end = addWorkingHours(start, 48, cfg);
    // ٩ ساعات/يوم -> 48/9 = 5.33 يوم عمل
    // أحد٩ اثنين٩ ثلاثاء٩ أربعاء٩ خميس٩ = 45، فاضل 3 -> سبت (الجمعة إجازة) 9ص+3 = 12م
    expect(cairoDate(end)).toBe("2026-09-05"); // سبت
    expect(cairoHour(end)).toBe(12);
  });

  it("بيبدأ من الفتح لو البداية قبل ساعات العمل", () => {
    const start = cairo("2026-08-30T06:00:00+03:00"); // أحد ٦ص
    const end = addWorkingHours(start, 1, cfg);
    expect(cairoHour(end)).toBe(10); // ٩ص + ساعة
  });

  it("بيتخطى العطلة الرسمية", () => {
    // 2026-04-19 أحد، والعطلة ٢٠ و٢١
    const start = cairo("2026-04-19T17:00:00+03:00"); // فاضل ساعة
    const end = addWorkingHours(start, 3, cfg);
    // ساعة الأحد، ٢٠ و٢١ عطلة، فباقي ساعتين يوم ٢٢
    expect(cairoDate(end)).toBe("2026-04-22");
  });

  it("صفر ساعات = نفس الوقت", () => {
    const start = cairo("2026-08-30T10:00:00+03:00");
    expect(addWorkingHours(start, 0, cfg).getTime()).toBe(start.getTime());
  });

  it("بيرمي خطأ لو مفيش أيام عمل", () => {
    const noWork: WorkingTimeConfig = {
      workingHours: cfg.workingHours.map((w) => ({ ...w, isWorkingDay: false })),
      holidays: [],
    };
    expect(() => addWorkingHours(new Date(), 8, noWork)).toThrow(/أيام عمل/);
  });
});

describe("addWorkingDays", () => {
  it("يوم عمل واحد من الأحد = الاثنين", () => {
    const end = addWorkingDays(cairo("2026-08-30T10:00:00+03:00"), 1, cfg);
    expect(cairoDate(end)).toBe("2026-08-31");
  });

  it("⚠️ بيتخطى الجمعة", () => {
    // خميس + يوم عمل = السبت (مش الجمعة)
    const end = addWorkingDays(cairo("2026-08-27T10:00:00+03:00"), 1, cfg);
    expect(cairoDate(end)).toBe("2026-08-29");
  });

  it("٥ أيام عمل من الأحد", () => {
    const end = addWorkingDays(cairo("2026-08-30T10:00:00+03:00"), 5, cfg);
    // اثنين ثلاثاء أربعاء خميس (جمعة إجازة) سبت
    expect(cairoDate(end)).toBe("2026-09-05");
  });

  it("النتيجة عند وقت القفل", () => {
    const end = addWorkingDays(cairo("2026-08-30T10:00:00+03:00"), 1, cfg);
    expect(cairoHour(end)).toBe(18);
  });
});

describe("computePromisedAt — الموعد المتوقع", () => {
  it("القاهرة والإسكندرية: ٤٨ ساعة عمل", () => {
    const arrival = cairo("2026-08-30T09:00:00+03:00");
    const promised = computePromisedAt(arrival, { workingHours: 48 }, cfg);
    expect(promised.getTime()).toBeGreaterThan(arrival.getTime());
    expect(cairoDate(promised)).toBe("2026-09-05");
  });

  it("باقي المحافظات: بياخد الحد الأقصى (٥ أيام)", () => {
    const arrival = cairo("2026-08-30T10:00:00+03:00");
    const promised = computePromisedAt(
      arrival,
      { workingDaysMin: 4, workingDaysMax: 5 },
      cfg
    );
    expect(cairoDate(promised)).toBe("2026-09-05");
  });

  it("الوعد دايمًا في المستقبل", () => {
    const arrival = cairo("2026-08-28T23:00:00+03:00"); // جمعة بالليل
    const promised = computePromisedAt(arrival, { workingHours: 48 }, cfg);
    expect(promised.getTime()).toBeGreaterThan(arrival.getTime());
  });
});

describe("خرق الـ SLA", () => {
  it("التسليم قبل الموعد = مفيش خرق", () => {
    expect(
      isSlaBreached(cairo("2026-09-01T18:00:00+03:00"), cairo("2026-08-31T12:00:00+03:00"))
    ).toBe(false);
  });

  it("التسليم بعد الموعد = خرق", () => {
    expect(
      isSlaBreached(cairo("2026-08-31T18:00:00+03:00"), cairo("2026-09-02T12:00:00+03:00"))
    ).toBe(true);
  });

  it("مفيش موعد = مفيش خرق", () => {
    expect(isSlaBreached(null, new Date())).toBe(false);
  });

  it("الساعات المتبقية سالبة لو متأخرة", () => {
    const past = new Date(Date.now() - 3 * 3_600_000);
    expect(hoursUntilPromised(past)).toBeLessThan(0);
  });

  it("الساعات المتبقية موجبة لو لسه في الوقت", () => {
    const future = new Date(Date.now() + 5 * 3_600_000);
    const h = hoursUntilPromised(future);
    expect(h).toBeGreaterThan(4);
    expect(h).toBeLessThan(6);
  });
});

describe("سلامة الحساب", () => {
  it("النتيجة دايمًا في وقت عمل", () => {
    const starts = [
      "2026-08-28T23:00:00+03:00", // جمعة بالليل
      "2026-08-30T06:00:00+03:00", // قبل الفتح
      "2026-08-30T22:00:00+03:00", // بعد القفل
      "2026-04-20T10:00:00+03:00", // عطلة رسمية
    ];
    for (const s of starts) {
      const end = addWorkingHours(cairo(s), 8, cfg);
      expect(isWorkingDay(end, cfg), `فشل عند ${s}`).toBe(true);
    }
  });

  it("زيادة الساعات = موعد أبعد (رتابة)", () => {
    const start = cairo("2026-08-30T09:00:00+03:00");
    let prev = start.getTime();
    for (const h of [1, 4, 9, 20, 48, 96]) {
      const t = addWorkingHours(start, h, cfg).getTime();
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});
