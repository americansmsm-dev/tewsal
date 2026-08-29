/**
 * ============================================================
 *  الاستيراد بمعاينة الأخطاء — مرحلة ح
 * ------------------------------------------------------------
 *  العميل بيبعت صفوف (من Excel/CSV parse في المتصفح). السيرفر
 *  بيتحقق من كل صف (تاجر، محافظة بالاسم/المرادفات، موبايل،
 *  تحصيل) ويرجّع معاينة الأخطاء صف-بصف، وبعد التأكيد بينشئ
 *  الصالح بس عبر createShipment (نفس البوابة).
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { normalizeEgyptMobile } from "@/lib/phone";
import { createShipment } from "./createShipment";
import { isBlacklisted } from "./crm";
import { type Actor } from "./transition";
import { type SqlExecutor } from "./ledger";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

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

  const results: ImportRowResult[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    const errors: string[] = [];
    if (!merchant?.is_active) errors.push("التاجر غير مفعّل");
    if (!r.recipientName?.trim()) errors.push("اسم المستلم ناقص");
    const phone = normalizeEgyptMobile(r.recipientPhone ?? "");
    if (!phone) errors.push("رقم موبايل غير صالح");
    else if (await isBlacklisted(ex, phone)) errors.push("العميل في القائمة السوداء");
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

/** التنفيذ: بينشئ الصفوف الصالحة عبر createShipment (نفس البوابة). */
export async function commitImport(
  ex: SqlExecutor,
  input: { merchantId: string; rows: ImportRowInput[]; confirm?: boolean; actor: Actor }
): Promise<{ created: number; failed: number; errors: { index: number; error: string }[]; batchCode: string }> {
  const govs = await loadGovs(ex);
  const errors: { index: number; error: string }[] = [];
  let created = 0;

  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    const g = r.governorate ? resolveGov(r.governorate, govs) : null;
    if (!g) { errors.push({ index: i, error: "محافظة غير معروفة" }); continue; }
    try {
      await createShipment(ex, {
        merchantId: input.merchantId,
        recipientName: r.recipientName ?? "",
        recipientPhone: r.recipientPhone ?? "",
        governorateId: g.id,
        addressLine: r.addressLine ?? "",
        codAmount: r.codAmount,
        merchantReference: r.merchantReference ?? null,
        confirm: input.confirm ?? true,
      }, input.actor);
      created++;
    } catch (err) {
      errors.push({ index: i, error: err instanceof Error ? err.message : "فشل" });
    }
  }

  const n = rowsOf<{ n: string }>(await ex.execute(sql`SELECT nextval('awb_sequence')::text AS n`))[0]!.n;
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
  const batchCode = `IMP-${year}-${n.padStart(6, "0")}`;
  await ex.execute(sql`
    INSERT INTO import_batches (code, merchant_id, total, created_count, failed_count, created_by)
    VALUES (${batchCode}, ${input.merchantId}::uuid, ${input.rows.length}, ${created}, ${errors.length}, ${input.actor.userId ?? null}::uuid)`);

  return { created, failed: errors.length, errors, batchCode };
}
