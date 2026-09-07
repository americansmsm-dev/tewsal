/**
 * ============================================================
 *  مطابقة أرصدة التجار — الحارس الليلي للحساب التزايدي
 * ------------------------------------------------------------
 *  رصيد التاجر بقى بيتحدّث **تزايديًا** (دلتا القيد بس) بدل ما
 *  يعيد حساب الدفتر كله في كل تسليم. ده اللي بيخلّي السيستم
 *  يستحمل ١٠ آلاف أوردر/يوم — بس معناه إن أي خلل (كوميت نص
 *  الطريق · قيد اتكتب من برّة الخدمة · استرجاع نسخة) ممكن
 *  يسيب فرق مايتصلّحش لوحده.
 *
 *  السكربت ده بيقارن **المخزَّن** بـ**المشتق من الدفتر** لكل
 *  تاجر — الخانتين، مش الإجمالي بس (فحص I4 بيشوف الإجمالي
 *  فقط، فممكن الإجمالي يبقى صح والتقسيم غلط — والتاجر بيبص
 *  على «المؤكد» أكتر من الإجمالي).
 *
 *  التشغيل الليلي المقترح (تاسك في Coolify، توقيت القاهرة):
 *    0 4 * * *  npx tsx scripts/reconcile-balances.ts
 *
 *    --check   يقارن ويبلّغ **من غير ما يصلّح** (للتشخيص)
 *    --quiet   مايطبعش غير الفروقات والخلاصة
 * ============================================================
 */
import postgres from "postgres";
import { formatEGP } from "../src/lib/money";

const CHECK_ONLY = process.argv.includes("--check");
const QUIET = process.argv.includes("--quiet");
const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";

/** سنتينل عشان نلغي الترانزاكشن في وضع الفحص من غير ما نكتب */
const ROLLBACK = Symbol("rollback");

async function main() {
  process.env.DATABASE_URL = DB;
  const { db } = await import("../src/server/db");
  const { recomputeMerchantBalance, readMerchantBalance } = await import("../src/server/services/ledger");

  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  const started = performance.now();

  try {
    // كل تاجر ليه صف رصيد أو أي حركة في الدفتر
    const merchants = await sql<{ id: string; name: string; code: string }[]>`
      SELECT m.id::text, m.name_ar AS name, m.code
      FROM merchants m
      WHERE EXISTS (SELECT 1 FROM merchant_balances b WHERE b.merchant_id = m.id)
         OR EXISTS (
              SELECT 1 FROM accounts a
              WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = m.id
                AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
            )
      ORDER BY m.code
    `;

    console.log(`\n${"═".repeat(64)}`);
    console.log(`  مطابقة أرصدة التجار — ${merchants.length} تاجر${CHECK_ONLY ? " (فحص بس)" : ""}`);
    console.log(`${"═".repeat(64)}\n`);

    const drift: string[] = [];

    for (const m of merchants) {
      const stored = await readMerchantBalance(db, m.id);

      let derived: { confirmedP: bigint; inCollectionP: bigint };
      if (CHECK_ONLY) {
        // بنحسب جوّه ترانزاكشن وبنلغيها — القراءة بتحصل والكتابة لأ
        try {
          await db.transaction(async (tx) => {
            derived = await recomputeMerchantBalance(tx, m.id);
            throw ROLLBACK;
          });
          derived = stored; // مايوصلش هنا
        } catch (err) {
          if (err !== ROLLBACK) throw err;
        }
      } else {
        derived = await db.transaction((tx) => recomputeMerchantBalance(tx, m.id));
      }

      const d = derived!;
      const sameConfirmed = stored.confirmedP === d.confirmedP;
      const sameInCollection = stored.inCollectionP === d.inCollectionP;

      if (sameConfirmed && sameInCollection) {
        if (!QUIET) console.log(`  ✅ ${m.code.padEnd(12)} ${m.name}`);
        continue;
      }

      const what = !sameConfirmed && !sameInCollection ? "الخانتين"
        : !sameConfirmed ? "المؤكد" : "تحت التحصيل";
      const line =
        `${m.code} (${m.name}) — فرق في ${what}\n` +
        `      مخزَّن: مؤكد ${formatEGP(stored.confirmedP)} · تحت التحصيل ${formatEGP(stored.inCollectionP)}\n` +
        `      دفتر : مؤكد ${formatEGP(d.confirmedP)} · تحت التحصيل ${formatEGP(d.inCollectionP)}`;
      drift.push(line);
      console.log(`  ❌ ${line}${CHECK_ONLY ? "" : "\n      ↳ اتصلّح من الدفتر"}`);
    }

    console.log(`\n${"─".repeat(64)}`);
    if (drift.length === 0) {
      console.log(`✅ كل الأرصدة مطابقة للدفتر — ${merchants.length} تاجر · ${((performance.now() - started) / 1000).toFixed(1)}s`);
    } else {
      console.log(
        CHECK_ONLY
          ? `❌ ${drift.length} تاجر فيهم فرق — شغّل السكربت من غير --check عشان يتصلّح`
          : `⚠️  ${drift.length} تاجر كان فيهم فرق و**اتصلّحوا** من الدفتر`
      );
      console.log("   ⛔ راجع سبب الفرق قبل أي تحويل فلوس — التصليح بيداري العرض مش السبب.");
    }
    console.log(`${"─".repeat(64)}\n`);

    // الفرق في وضع الفحص = فشل. في وضع التصليح = تحذير (اتصلّح فعلًا).
    process.exitCode = CHECK_ONLY && drift.length > 0 ? 1 : 0;
    await db.$client.end();
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("\n❌ فشلت المطابقة:", e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
