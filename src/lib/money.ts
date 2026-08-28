/**
 * ============================================================
 *  الفلوس — Money
 * ------------------------------------------------------------
 *  ⚠️ قاعدة مقدسة: كل مبلغ في السيستم كله بيتخزن ويتحسب
 *     بـ bigint بالقروش (piastres). مفيش float ولا number أبدًا.
 *
 *     1 جنيه = 100 قرش
 *
 *  ليه؟ لأن 0.1 + 0.2 !== 0.3 في الحساب العشري للكمبيوتر.
 *  مع آلاف الشحنات ونسبة 1% وكيلوات زيادة، الكسور دي بتتراكم
 *  وتعمل فرق حقيقي في فلوس التجار.
 * ============================================================
 */

/** القروش — النوع الوحيد المسموح للفلوس */
export type Piastres = bigint;

/** عدد القروش في الجنيه */
export const PIASTRES_PER_POUND = 100n;

// ---------------------------------------------------------------
// التحويل
// ---------------------------------------------------------------

/**
 * جنيه → قروش. بيقبل رقم أو نص (زي اللي جاي من فورم أو Excel).
 * بيرفض أي حاجة مش رقم صحيح موجب.
 *
 * poundsToPiastres("73.50") === 7350n
 * poundsToPiastres(100)     === 10000n
 */
export function poundsToPiastres(pounds: number | string): Piastres {
  const s = String(pounds).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`مبلغ غير صالح: "${pounds}" — لازم يكون رقم بحد أقصى خانتين عشريتين`);
  }
  const negative = s.startsWith("-");
  const parts = (negative ? s.slice(1) : s).split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const fracPadded = frac.padEnd(2, "0");
  const value = BigInt(whole) * PIASTRES_PER_POUND + BigInt(fracPadded);
  return negative ? -value : value;
}

/** قروش → جنيه كرقم عشري (للعرض فقط — متستخدمهوش في أي حساب) */
export function piastresToPounds(p: Piastres): number {
  return Number(p) / 100;
}

// ---------------------------------------------------------------
// العرض
// ---------------------------------------------------------------

/**
 * صيغة العرض بالعربي: 7350n -> "73.50"
 * ما بتضيفش كلمة "جنيه" — ده قرار الواجهة.
 */
export function formatPiastres(p: Piastres): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / PIASTRES_PER_POUND;
  const frac = abs % PIASTRES_PER_POUND;
  const s = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

/** صيغة كاملة بفواصل الآلاف: 735000n -> "7,350.00 ج" */
export function formatEGP(p: Piastres): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = (abs / PIASTRES_PER_POUND).toString();
  const frac = (abs % PIASTRES_PER_POUND).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac} ج`;
}

// ---------------------------------------------------------------
// الحساب
// ---------------------------------------------------------------

/**
 * نسبة مئوية بنقاط الأساس (basis points) على مبلغ بالقروش.
 * 1% = 100 نقطة أساس (bp)
 *
 * التقريب: نص لأعلى (half-up) — نفس ما البشر بيحسبوا.
 * بنشتغل على أعداد صحيحة بس، مفيش float خالص.
 *
 * pct(735000n, 100) === 7350n   // 1% من 7,350 ج = 73.50 ج
 */
export function pct(amount: Piastres, basisPoints: number): Piastres {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new Error(`نقاط أساس غير صالحة: ${basisPoints}`);
  }
  const bp = BigInt(basisPoints);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  // تقريب نص لأعلى: (a*bp + 5000) / 10000
  const result = (abs * bp + 5000n) / 10000n;
  return negative ? -result : result;
}

/** جمع آمن لمصفوفة مبالغ */
export function sum(amounts: readonly Piastres[]): Piastres {
  return amounts.reduce<Piastres>((acc, v) => acc + v, 0n);
}

/** الأكبر / الأصغر */
export function maxP(a: Piastres, b: Piastres): Piastres {
  return a > b ? a : b;
}
export function minP(a: Piastres, b: Piastres): Piastres {
  return a < b ? a : b;
}

/** القيمة المطلقة */
export function absP(a: Piastres): Piastres {
  return a < 0n ? -a : a;
}

// ---------------------------------------------------------------
// رسوم التحصيل — القاعدة الأصعب في السيستم
// ---------------------------------------------------------------

/** أساس حساب النسبة فوق الحد */
export type CodPercentBasis = "full_amount" | "excess_over_threshold";

export interface CodFeeConfig {
  /** الرسم الثابت بالقروش (حاليًا 100 ج = 10000n) */
  flatFee: Piastres;
  /** الحد اللي فوقه بتتحسب نسبة (حاليًا 5000 ج = 500000n) */
  threshold: Piastres;
  /** النسبة بنقاط الأساس (1% = 100) */
  percentBp: number;
  /**
   * النسبة بتتحسب على إيه؟
   * - full_amount: 1% من المبلغ كله
   * - excess_over_threshold: 1% من الزيادة فوق الحد بس
   * ⚠️ ده سؤال مفتوح محتاج تأكيد العميل — شوف الخطة
   */
  basis: CodPercentBasis;
}

/**
 * حساب رسوم التحصيل الكاملة.
 *
 * مثال (basis = full_amount):
 *   codAmount = 735000n (7,350 ج)
 *   flat = 10000n, threshold = 500000n, percentBp = 100
 *   → 10000n + pct(735000n, 100) = 10000n + 7350n = 17350n (173.50 ج)
 *
 * مثال (المبلغ تحت الحد):
 *   codAmount = 300000n (3,000 ج) → 10000n بس (100 ج)
 */
export function calcCodFee(codAmount: Piastres, cfg: CodFeeConfig): Piastres {
  if (codAmount <= 0n) return 0n;
  let fee = cfg.flatFee;
  if (codAmount > cfg.threshold) {
    const base =
      cfg.basis === "full_amount" ? codAmount : codAmount - cfg.threshold;
    fee += pct(base, cfg.percentBp);
  }
  return fee;
}

// ---------------------------------------------------------------
// التحقق من توازن القيد المحاسبي
// ---------------------------------------------------------------

export interface JournalLineLike {
  debitP: Piastres;
  creditP: Piastres;
}

/**
 * التحقق إن القيد متوازن قبل ما نبعته لقاعدة البيانات.
 * قاعدة البيانات بترفضه برضه لو مش متوازن — دي طبقة تانية
 * عشان الخطأ يظهر بدري وبرسالة مفهومة.
 */
export function assertBalanced(lines: readonly JournalLineLike[]): void {
  if (lines.length === 0) {
    throw new Error("قيد فاضي — لازم يكون فيه سطرين على الأقل");
  }
  const debits = sum(lines.map((l) => l.debitP));
  const credits = sum(lines.map((l) => l.creditP));
  if (debits !== credits) {
    throw new Error(
      `قيد غير متوازن: مدين ${formatEGP(debits)} ≠ دائن ${formatEGP(credits)} ` +
        `(الفرق ${formatEGP(absP(debits - credits))})`
    );
  }
  for (const l of lines) {
    if (l.debitP < 0n || l.creditP < 0n) {
      throw new Error("ممنوع مبالغ سالبة في سطور القيد — استخدم قيد عكسي");
    }
    if ((l.debitP === 0n) === (l.creditP === 0n)) {
      throw new Error("كل سطر لازم يكون مدين أو دائن — مش الاتنين ولا ولا واحد");
    }
  }
}
