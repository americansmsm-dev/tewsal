/**
 * ============================================================
 *  حساب أيام وساعات العمل — SLA
 * ------------------------------------------------------------
 *  ⚠️ «٤٨ ساعة عمل» **مش** معناها +48 ساعة على الساعة.
 *
 *  لو شحنة دخلت المخزن الخميس ٤ العصر، الـ ٤٨ ساعة عمل
 *  بتخلص الأحد — مش السبت — لأن الجمعة إجازة.
 *  وفي رمضان والأعياد الحساب بيتغير كمان.
 *
 *  الحساب الساذج (+48h) بيدي وعود كاذبة للعملاء وبيخلي
 *  تقارير التأخير غلط. عشان كده فيه دالة واحدة بس بتحسب،
 *  وكل السيستم بيستخدمها.
 *
 *  التوقيت: كل الحسابات بتوقيت القاهرة (Africa/Cairo).
 *  مصر رجّعت التوقيت الصيفي من ٢٠٢٣، فالفرق مش ثابت.
 * ============================================================
 */

export interface WorkingDay {
  /** 0=الأحد … 6=السبت */
  dayOfWeek: number;
  /** "09:00" */
  openTime: string | null;
  /** "18:00" */
  closeTime: string | null;
  isWorkingDay: boolean;
}

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  nameAr: string;
  /** أحيانًا بنشتغل في العطلة الرسمية */
  isWorkingDay: boolean;
}

export interface WorkingTimeConfig {
  workingHours: readonly WorkingDay[];
  holidays: readonly Holiday[];
  timeZone?: string;
}

const CAIRO = "Africa/Cairo";

// ---------------------------------------------------------------
// أدوات التوقيت
// ---------------------------------------------------------------

/** أجزاء التاريخ بتوقيت القاهرة */
function cairoParts(d: Date, tz = CAIRO) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayOfWeek: weekdayMap[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** "HH:MM" -> دقائق من نص الليل */
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// ---------------------------------------------------------------
// الاستعلام
// ---------------------------------------------------------------

/** هل اليوم ده يوم عمل؟ (بيراعي العطلات) */
export function isWorkingDay(d: Date, cfg: WorkingTimeConfig): boolean {
  const { date, dayOfWeek } = cairoParts(d, cfg.timeZone);

  const holiday = cfg.holidays.find((h) => h.date === date);
  if (holiday) return holiday.isWorkingDay;

  const wd = cfg.workingHours.find((w) => w.dayOfWeek === dayOfWeek);
  return wd?.isWorkingDay ?? false;
}

/** ساعات العمل لليوم ده — null لو إجازة */
function dayWindow(
  d: Date,
  cfg: WorkingTimeConfig
): { openMin: number; closeMin: number } | null {
  if (!isWorkingDay(d, cfg)) return null;
  const { dayOfWeek } = cairoParts(d, cfg.timeZone);
  const wd = cfg.workingHours.find((w) => w.dayOfWeek === dayOfWeek);
  if (!wd?.openTime || !wd?.closeTime) return null;
  return { openMin: toMinutes(wd.openTime), closeMin: toMinutes(wd.closeTime) };
}

/** هل دلوقتي وقت عمل؟ */
export function isWithinWorkingHours(d: Date, cfg: WorkingTimeConfig): boolean {
  const win = dayWindow(d, cfg);
  if (!win) return false;
  const { hour, minute } = cairoParts(d, cfg.timeZone);
  const cur = hour * 60 + minute;
  return cur >= win.openMin && cur < win.closeMin;
}

// ---------------------------------------------------------------
// الحساب
// ---------------------------------------------------------------

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * إضافة **ساعات عمل** على تاريخ.
 * دي اللي بتحسب الموعد المتوقع للقاهرة والإسكندرية (٤٨ ساعة عمل).
 *
 * الخوارزمية: بنمشي يوم بيوم، وناخد من كل يوم ساعات عمله
 * المتاحة لحد ما نستهلك المطلوب.
 */
export function addWorkingHours(
  start: Date,
  hours: number,
  cfg: WorkingTimeConfig
): Date {
  if (hours <= 0) return new Date(start);

  let remaining = Math.round(hours * 60); // بالدقائق
  let cursor = new Date(start);
  let guard = 0;

  while (remaining > 0) {
    if (++guard > 400) {
      throw new Error(
        "تعذّر حساب الموعد المتوقع — تأكد إن فيه أيام عمل معرّفة في الإعدادات"
      );
    }

    const win = dayWindow(cursor, cfg);
    if (!win) {
      cursor = startOfNextDay(cursor, cfg.timeZone);
      continue;
    }

    const { hour, minute } = cairoParts(cursor, cfg.timeZone);
    const curMin = hour * 60 + minute;

    // قبل الفتح -> نقف عند الفتح
    if (curMin < win.openMin) {
      cursor = new Date(cursor.getTime() + (win.openMin - curMin) * MS_PER_MINUTE);
      continue;
    }
    // بعد القفل -> نروح لليوم اللي بعده
    if (curMin >= win.closeMin) {
      cursor = startOfNextDay(cursor, cfg.timeZone);
      continue;
    }

    const availableToday = win.closeMin - curMin;
    if (remaining <= availableToday) {
      return new Date(cursor.getTime() + remaining * MS_PER_MINUTE);
    }

    remaining -= availableToday;
    cursor = startOfNextDay(cursor, cfg.timeZone);
  }

  return cursor;
}

/**
 * إضافة **أيام عمل** على تاريخ.
 * دي بتحسب الموعد المتوقع لباقي المحافظات (٤-٥ أيام عمل).
 * النتيجة بتبقى عند وقت القفل في اليوم الأخير.
 */
export function addWorkingDays(
  start: Date,
  days: number,
  cfg: WorkingTimeConfig
): Date {
  if (days <= 0) return new Date(start);

  let cursor = startOfNextDay(start, cfg.timeZone);
  let counted = 0;
  let guard = 0;

  while (counted < days) {
    if (++guard > 400) {
      throw new Error("تعذّر حساب الموعد المتوقع — راجع أيام العمل والعطلات");
    }
    if (isWorkingDay(cursor, cfg)) counted++;
    if (counted < days) cursor = startOfNextDay(cursor, cfg.timeZone);
  }

  // نحطها عند وقت القفل في اليوم الأخير
  const win = dayWindow(cursor, cfg);
  if (win) {
    const { hour, minute } = cairoParts(cursor, cfg.timeZone);
    const cur = hour * 60 + minute;
    return new Date(cursor.getTime() + (win.closeMin - cur) * MS_PER_MINUTE);
  }
  return cursor;
}

/** بداية اليوم اللي بعده (٠٠:٠٠ بتوقيت القاهرة) */
function startOfNextDay(d: Date, tz = CAIRO): Date {
  const { hour, minute, second } = cairoParts(d, tz);
  const elapsed = (hour * 3600 + minute * 60 + second) * 1000;
  return new Date(d.getTime() - elapsed + MS_PER_DAY);
}

/**
 * حساب الموعد المتوقع للشحنة.
 * ⚠️ بيتنده **مرة واحدة بس** عند دخول المخزن، والنتيجة
 *    بتتخزن في promised_at ومتتحسبش تاني أبدًا — حتى لو
 *    الإعدادات اتغيرت بعد كده.
 */
export interface SlaConfig {
  /** للقاهرة والإسكندرية: 48 */
  workingHours?: number | null;
  /** لباقي المحافظات: 4-5 */
  workingDaysMin?: number | null;
  workingDaysMax?: number | null;
}

export function computePromisedAt(
  hubArrivalAt: Date,
  sla: SlaConfig,
  cfg: WorkingTimeConfig
): Date {
  if (sla.workingHours && sla.workingHours > 0) {
    return addWorkingHours(hubArrivalAt, sla.workingHours, cfg);
  }
  // بناخد الحد الأقصى — الوعد للعميل لازم يكون قابل للتحقيق
  const days = sla.workingDaysMax ?? sla.workingDaysMin ?? 5;
  return addWorkingDays(hubArrivalAt, days, cfg);
}

/** هل الشحنة خرقت الـ SLA؟ */
export function isSlaBreached(promisedAt: Date | null, deliveredAt: Date | null): boolean {
  if (!promisedAt) return false;
  const compareTo = deliveredAt ?? new Date();
  return compareTo.getTime() > promisedAt.getTime();
}

/** كام ساعة فاضلة على الموعد؟ سالب = متأخرة */
export function hoursUntilPromised(promisedAt: Date | null, now = new Date()): number | null {
  if (!promisedAt) return null;
  return (promisedAt.getTime() - now.getTime()) / 3_600_000;
}

/** صيغة عرض عربية للموعد المتوقع */
export function formatPromisedAr(promisedAt: Date | null, tz = CAIRO): string {
  if (!promisedAt) return "لسه مش محدد";
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(promisedAt);
}
