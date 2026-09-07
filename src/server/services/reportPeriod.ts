/**
 * ============================================================
 *  فترة التقارير — الحد اللي بيمنع مسح الدفتر كله
 * ------------------------------------------------------------
 *  تقارير الأداء والأرباح كانت بتمسح **كل** الشحنات و**كل**
 *  سطور اليومية من أول يوم تشغيل، من غير أي حد. مع مليون شحنة
 *  و٣٠ مليون سطر يومية ده بياخد دقايق وبياكل اتصال من الحوض
 *  طول الوقت ده — وكفاية اتنين يفتحوا التقرير في نفس الوقت
 *  عشان السيستم يقف.
 *
 *  دلوقتي كل تقرير فترة **لازم** ليه نافذة زمنية:
 *    · الافتراضي ٩٠ يوم (ربع سنة — اللي المالك بيبص عليه فعلًا)
 *    · الأقصى ٤٠٠ يوم (سنة + هامش للمقارنة السنوية)
 *
 *  ⚠️ ميزان المراجعة **مش** من دول — طبيعته تراكمية من أول يوم،
 *     وتحديده بفترة يخلّيه غلط محاسبيًا.
 * ============================================================
 */

export const DEFAULT_PERIOD_DAYS = 90;
export const MAX_PERIOD_DAYS = 400;

export interface ReportPeriod {
  /** بداية الفترة — ISO (شامل) */
  from: string;
  /** نهاية الفترة — ISO (غير شامل) */
  to: string;
  days: number;
  /** true لو المستخدم طلب فترة أطول من المسموح واتقصّت */
  clamped: boolean;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/**
 * بيحوّل بارامترات الطلب لنافذة زمنية مضمونة.
 * بيقبل `from`/`to` صريحين، أو `days` (عدد الأيام لورا من دلوقتي).
 */
export function resolvePeriod(input?: {
  from?: string | null;
  to?: string | null;
  days?: number | string | null;
}): ReportPeriod {
  const to = parseDate(input?.to) ?? new Date();
  const explicitFrom = parseDate(input?.from);

  let days: number;
  if (explicitFrom) {
    days = Math.max(1, Math.ceil((to.getTime() - explicitFrom.getTime()) / DAY_MS));
  } else {
    const n = Number(input?.days);
    days = Number.isFinite(n) && n > 0 ? Math.ceil(n) : DEFAULT_PERIOD_DAYS;
  }

  const clamped = days > MAX_PERIOD_DAYS;
  if (clamped) days = MAX_PERIOD_DAYS;

  const from = explicitFrom && !clamped ? explicitFrom : new Date(to.getTime() - days * DAY_MS);

  return { from: from.toISOString(), to: to.toISOString(), days, clamped };
}
