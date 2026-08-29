/**
 * ============================================================
 *  اختبار تقارير الأعمار
 * ------------------------------------------------------------
 *  بيزرع كاش في عهدة مندوب بأعمار مختلفة (اليوم / ٥ أيام /
 *  ٢٠ يوم) ويتأكد إن الشرائح بتتحسب صح، والمجموع = رصيد
 *  العهدة، وإن تسليم العهدة بيفضّي الأعمار.
 *
 *  DATABASE_URL=... npx tsx scripts/verify-aging.ts
 * ============================================================
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { ACC, buildHandoverEntry, type DraftEntry } from "../src/server/domain/ledger";
import { postEntry } from "../src/server/services/ledger";
import { courierCashAging, merchantReceivablesAging } from "../src/server/services/reports";

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal";
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // ⚠️ الدفتر append-only (مفيش حذف) — فمندوب/تاجر جدد كل تشغيلة
  //    عشان يبدأوا بعهدة صفر والأرقام تطلع بالظبط.
  const COURIER = crypto.randomUUID();
  const MERCHANT = crypto.randomUUID();
  const stamp = Date.now();

  try {
    const [branch] = await client<{ id: string }[]>`SELECT id FROM branches WHERE code='MAIN'`;
    await client`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الأعمار',${"courier_aging_" + stamp},'x','courier',false)`;
    await client`INSERT INTO merchants (id, code, name_ar, tier)
      VALUES (${MERCHANT}::uuid, ${"M-AGE-" + stamp}, 'تاجر الأعمار', 't1')`;

    console.log("\n═══ تقارير الأعمار ═══\n");

    // قيد كاش معلّق: مدين كاش المندوب / دائن مستحقات التاجر — بتاريخ ماضي
    function aged(amountP: bigint, daysAgo: number): { draft: DraftEntry; date: Date } {
      const id = crypto.randomUUID();
      const date = new Date(Date.now() - daysAgo * 86400000);
      return {
        date,
        draft: {
          descriptionAr: `كاش معلّق (${daysAgo} يوم)`,
          sourceType: "manual",
          sourceId: id,
          kind: "manual",
          lines: [
            { account: ACC.courierCash(COURIER), debitP: amountP, creditP: 0n, courierId: COURIER },
            { account: ACC.merchantPayable(MERCHANT), debitP: 0n, creditP: amountP, merchantId: MERCHANT },
          ],
        },
      };
    }

    // اليوم 100 · من ٥ أيام 200 · من ٢٠ يوم 300  (بالقروش ×100)
    for (const [pounds, days] of [[100, 0], [200, 5], [300, 20]] as const) {
      const { draft, date } = aged(BigInt(pounds) * 100n, days);
      await db.transaction(async (tx) => {
        await postEntry(tx, draft, { entryDate: date });
      });
    }

    // ─── أعمار كاش المناديب ───
    const cc = await courierCashAging(db);
    const row = cc.rows.find((r) => r.id === COURIER);
    check("١) المندوب ظهر في التقرير", !!row, true);
    check("   شريحة «اليوم» = 100 ج", row?.bucketsP[0], "10000");
    check("   شريحة «١–٣ أيام» = صفر", row?.bucketsP[1], "0");
    check("   شريحة «٤–٧ أيام» = 200 ج", row?.bucketsP[2], "20000");
    check("   شريحة «٨–١٤ يوم» = صفر", row?.bucketsP[3], "0");
    check("   شريحة «أكبر من أسبوعين» = 300 ج", row?.bucketsP[4], "30000");
    check("   إجمالي المندوب = 600 ج", row?.totalP, "60000");
    check("   أقدم عمر = 20 يوم", row?.oldestDays, 20);

    // ─── أعمار مستحقات التاجر (نفس الفلوس من ناحية التاجر) ───
    const mr = await merchantReceivablesAging(db);
    const mrow = mr.rows.find((r) => r.id === MERCHANT);
    check("٢) التاجر ظهر في تحت التحصيل", !!mrow, true);
    check("   إجمالي التاجر = 600 ج", mrow?.totalP, "60000");
    check("   شريحة «أكبر من أسبوعين» = 300 ج", mrow?.bucketsP[4], "30000");

    // ─── بعد تسليم العهدة → الأعمار تفضى ───
    await db.transaction(async (tx) => {
      await postEntry(tx, buildHandoverEntry({
        handoverId: crypto.randomUUID(),
        courierId: COURIER, branchId: branch!.id, expectedP: 60000n, receivedP: 60000n,
      }));
    });
    const cc2 = await courierCashAging(db);
    check("٣) بعد تسليم العهدة — المندوب اختفى من الأعمار", cc2.rows.some((r) => r.id === COURIER), false);
    const mr2 = await merchantReceivablesAging(db);
    check("   والتاجر اختفى من تحت التحصيل", mr2.rows.some((r) => r.id === MERCHANT), false);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الأعمار نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await client.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await client.end();
    process.exitCode = 1;
  }
}
main();
