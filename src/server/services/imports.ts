/**
 * ============================================================
 *  الاستيراد بمعاينة الأخطاء — مرحلة ح
 * ------------------------------------------------------------
 *  العميل بيبعت صفوف (من Excel/CSV parse في المتصفح). السيرفر
 *  بيتحقق من كل صف (تاجر، محافظة بالاسم/المرادفات، موبايل،
 *  تحصيل) ويرجّع معاينة الأخطاء صف-بصف، وبعد التأكيد بينشئ
 *  الصالح بس عبر createShipment (نفس البوابة).
 *
 *  ⚠️ التنفيذ **مقسّم على دفعات**: ٢٠٠٠ صف في ترانزاكشن واحدة
 *  كانت بتفضل مفتوحة دقايق ماسكة قفل وبتاكل اتصال من الحوض،
 *  وأي غلطة كانت بتوقّع الاستيراد كله. دلوقتي:
 *    · كل دفعة (١٠٠ صف افتراضيًا) ترانزاكشن مستقلة بتتثبّت لوحدها
 *    · كل صف جوّه savepoint — الصف الفاشل بيترجع لوحده والباقي
 *      بيكمّل (قبل كده أول غلطة كانت بتفسد الترانزاكشن كلها
 *      فالصفوف اللي بعدها بتفشل بـ«current transaction is aborted»)
 *    · التسعير والإعدادات بتتقرا **مرة واحدة** للدفعة كلها
 *  النتيجة: تقرير بالصفوف اللي نجحت واللي فشلت، مش الكل-أو-لا-شيء.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { normalizeEgyptMobile } from "@/lib/phone";
import { createShipment, newPricingCache } from "./createShipment";
import { blacklistedPhones } from "./crm";
import { type Actor } from "./transition";
import { type SqlExecutor } from "./ledger";
import { type Db } from "../db";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

/** حجم الدفعة — قابل للضبط من البيئة وقت الاستيرادات الضخمة */
export const IMPORT_CHUNK_SIZE = 100;

/** مرادفات شائعة لأسماء المحافظات (نظير «الكلمات الدلالية») */
const GOV_ALIASES: Record<string, string> = {
  "مصر": "القاهرة", "القاهره": "القاهرة", "كايرو": "القاهرة",
  "اسكندرية": "الإسكندرية", "اسكندريه": "الإسكندرية", "الاسكندرية": "الإسكندرية", "اسكندرية بحري": "الإسكندرية",
  "المنصورة": "الدقهلية", "المنصوره": "الدقهلية", "طنطا": "الغربية", "المحلة": "الغربية",
  "بورسعيد": "بورسعيد", "السويس": "السويس", "الاسماعيلية": "الإسماعيلية",
  "شرم الشيخ": "جنوب سيناء", "الغردقة": "البحر الأحمر", "الغردقه": "البحر الأحمر",
  "القليوبيه": "القليوبية", "بنها": "القليوبية", "شبرا الخيمة": "القليوبية",
};

function normName(s: string): string {
  return s.trim().replace(/^محافظة\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
}

interface GovRow { id: string; name_ar: string; zone_id: string; cod_enabled: boolean; is_served: boolean; norm: string }

async function loadGovs(ex: SqlExecutor): Promise<GovRow[]> {
  return rowsOf<{ id: string; name_ar: string; zone_id: string; cod_enabled: boolean; is_served: boolean }>(
    await ex.execute(sql`SELECT id::text, name_ar, zone_id::text, cod_enabled, is_served FROM governorates`)
  ).map((g) => ({ ...g, norm: normName(g.name_ar) }));
}

function resolveGov(input: string, govs: GovRow[]): GovRow | null {
  const raw = input.trim();
  const canonical = GOV_ALIASES[raw] ?? GOV_ALIASES[normName(raw)] ?? raw;
  const n = normName(canonical);
  return govs.find((g) => g.norm === n) ?? govs.find((g) => g.norm.includes(n) || n.includes(g.norm)) ?? null;
}

export interface ImportRowInput {
  recipientName?: string;
  recipientPhone?: string;
  governorate?: string;
  addressLine?: string;
  codAmount?: string;
  merchantReference?: string;
}
export interface ImportRowResult {
  index: number;
  ok: boolean;
  errors: string[];
  governorateId?: string;
  phone?: string;
}

/** معاينة: بيتحقق من كل صف بدون إنشاء. */
export async function previewImport(
  ex: SqlExecutor,
  input: { merchantId: string; rows: ImportRowInput[] }
): Promise<{ results: ImportRowResult[]; validCount: number }> {
  const govs = await loadGovs(ex);
  const merchant = rowsOf<{ cod_enabled: boolean; is_active: boolean }>(
    await ex.execute(sql`SELECT cod_enabled, is_active FROM merchants WHERE id = ${input.merchantId}::uuid`)
  )[0];

  // القائمة السوداء **استعلام واحد** لكل الصفوف بدل واحد لكل صف
  const banned = await blacklistedPhones(ex, input.rows.map((r) => r.recipientPhone ?? ""));

  const results: ImportRowResult[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    const errors: string[] = [];
    if (!merchant?.is_active) errors.push("التاجر غير مفعّل");
    if (!r.recipientName?.trim()) errors.push("اسم المستلم ناقص");
    const phone = normalizeEgyptMobile(r.recipientPhone ?? "");
    if (!phone) errors.push("رقم موبايل غير صالح");
    else if (banned.has(phone)) errors.push("العميل في القائمة السوداء");
    if (!r.addressLine?.trim()) errors.push("العنوان ناقص");

    let govId: string | undefined;
    if (!r.governorate?.trim()) errors.push("المحافظة ناقصة");
    else {
      const g = resolveGov(r.governorate, govs);
      if (!g) errors.push(`محافظة غير معروفة: «${r.governorate}»`);
      else if (!g.is_served) errors.push(`${g.name_ar} خارج الخدمة`);
      else {
        govId = g.id;
        const cod = r.codAmount ? Number(r.codAmount) : 0;
        if (cod > 0 && (!g.cod_enabled || !merchant?.cod_enabled)) errors.push(`التحصيل مش متاح في ${g.name_ar}`);
      }
    }
    if (r.codAmount && !/^\d+(\.\d{1,2})?$/.test(r.codAmount.trim())) errors.push("مبلغ التحصيل غير صالح");

    results.push({ index: i, ok: errors.length === 0, errors, governorateId: govId, phone: phone ?? undefined });
  }
  return { results, validCount: results.filter((r) => r.ok).length };
}

export interface CommitImportResult {
  created: number;
  failed: number;
  errors: { index: number; error: string }[];
  batchCode: string;
  /** عدد الدفعات اللي اتثبّتت — للتشخيص */
  chunks: number;
}

/**
 * التنفيذ: بينشئ الصفوف الصالحة عبر createShipment (نفس البوابة)،
 * على دفعات مستقلة. بياخد `db` مش ترانزاكشن — لأنه بيدير
 * الترانزاكشن بنفسه.
 */
export async function commitImport(
  db: Db,
  input: { merchantId: string; rows: ImportRowInput[]; confirm?: boolean; actor: Actor }
): Promise<CommitImportResult> {
  const govs = await loadGovs(db);
  const errors: { index: number; error: string }[] = [];
  const cache = newPricingCache();
  const size = Number(process.env.IMPORT_CHUNK_SIZE) || IMPORT_CHUNK_SIZE;
  let created = 0;
  let chunks = 0;

  for (let start = 0; start < input.rows.length; start += size) {
    const end = Math.min(start + size, input.rows.length);
    try {
      const done = await db.transaction(async (tx) => {
        let madeHere = 0;
        for (let i = start; i < end; i++) {
          const r = input.rows[i]!;
          const g = r.governorate ? resolveGov(r.governorate, govs) : null;
          if (!g) { errors.push({ index: i, error: "محافظة غير معروفة" }); continue; }
          try {
            // savepoint لكل صف — الفشل بيترجع الصف ده بس، والترانزاكشن
            // تفضل سليمة عشان باقي الدفعة تكمّل
            await tx.transaction(async (sp) => {
              await createShipment(sp, {
                merchantId: input.merchantId,
                recipientName: r.recipientName ?? "",
                recipientPhone: r.recipientPhone ?? "",
                governorateId: g.id,
                addressLine: r.addressLine ?? "",
                codAmount: r.codAmount,
                merchantReference: r.merchantReference ?? null,
                confirm: input.confirm ?? true,
              }, input.actor, cache);
            });
            madeHere++;
          } catch (err) {
            errors.push({ index: i, error: err instanceof Error ? err.message : "فشل" });
          }
        }
        return madeHere;
      });
      created += done;
      chunks++;
    } catch (err) {
      // الدفعة كلها وقعت (مهلة · جمود · انقطاع) — الصفوف دي مااتعملتش،
      // واللي قبلها متثبّت. التقرير بيقول بالظبط مين نجح ومين لأ.
      const msg = err instanceof Error ? err.message : "فشلت الدفعة";
      for (let i = start; i < end; i++) {
        if (!errors.some((e) => e.index === i)) errors.push({ index: i, error: msg });
      }
    }
  }

  const n = rowsOf<{ n: string }>(await db.execute(sql`SELECT nextval('awb_sequence')::text AS n`))[0]!.n;
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  const batchCode = `IMP-${year}-${n.padStart(6, "0")}`;
  await db.execute(sql`
    INSERT INTO import_batches (code, merchant_id, total, created_count, failed_count, created_by)
    VALUES (${batchCode}, ${input.merchantId}::uuid, ${input.rows.length}, ${created}, ${errors.length}, ${input.actor.userId ?? null}::uuid)`);

  return { created, failed: errors.length, errors, batchCode, chunks };
}
