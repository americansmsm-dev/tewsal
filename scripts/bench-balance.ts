/**
 * ============================================================
 *  قياس: الرصيد التزايدي مقابل إعادة الحساب الكاملة
 * ------------------------------------------------------------
 *  بيبني دفتر بيكبر تدريجيًا، وعند كل حجم بيقيس:
 *    · إعادة الحساب الكاملة  ← التكلفة **القديمة** لكل تسليم
 *    · قيد تسليم كامل        ← التكلفة **الجديدة** لكل تسليم
 *
 *  المتوقع: الكاملة بتزيد مع حجم الدفتر (تعقيد تربيعي على
 *  مستوى اليوم)، والتزايدي بيفضل ثابت.
 *
 *  DATABASE_URL=postgres://postgres@127.0.0.1:54320/tewsal \
 *    npx tsx scripts/bench-balance.ts [--sizes=200,1000,3000]
 * ============================================================
 */
import postgres from "postgres";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const SIZES = (arg("sizes") ?? "200,1000,3000").split(",").map(Number);
const DB_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
const benchDb = `tewsal_bench_${Date.now()}`;
const adminUrl = DB_URL.replace(/\/[^/]+$/, "/postgres");
const benchUrl = DB_URL.replace(/\/[^/]+$/, `/${benchDb}`);

function sh(cmd: string, args: string[], env: Record<string, string>) {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} فشل:\n${(r.stdout ?? "") + (r.stderr ?? "")}`.slice(0, 1000));
}

const ms = (n: number) => `${n.toFixed(1)} ms`;

async function main() {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    console.log(`\n🗄️  قاعدة قياس: ${benchDb}`);
    await admin.unsafe(`CREATE DATABASE ${benchDb}`);
    sh("npx", ["tsx", "scripts/migrate.ts"], { DATABASE_URL: benchUrl });
    sh("npx", ["tsx", "scripts/seed.ts"], { DATABASE_URL: benchUrl });

    process.env.DATABASE_URL = benchUrl;
    const { db } = await import("../src/server/db");
    const { postEntry, recomputeMerchantBalance } = await import("../src/server/services/ledger");
    const { ACC } = await import("../src/server/domain/ledger");
    const sql = (await import("drizzle-orm")).sql;

    // تاجر ومندوب للقياس
    const mk = await db.execute(sql`
      INSERT INTO merchants (code, name_ar, tier, cod_enabled, is_active)
      VALUES ('M-BENCH', 'تاجر القياس', 't1', true, true) RETURNING id::text`);
    const merchantId = (Array.isArray(mk) ? mk : (mk as { rows: { id: string }[] }).rows)[0]!.id as string;
    const ck = await db.execute(sql`
      INSERT INTO users (full_name, username, password_hash, role, must_change_password)
      VALUES ('مندوب القياس', 'bench_courier', 'x', 'courier', false) RETURNING id::text`);
    const courierId = (Array.isArray(ck) ? ck : (ck as { rows: { id: string }[] }).rows)[0]!.id as string;

    /**
     * قيد تسليم بنفس شكل القيد الحقيقي (تحصيل كاش مع مندوب +
     * رسوم على التاجر) — من غير ربط بشحنة عشان مانحتاجش ننشئ
     * صفوف شحنات كاملة في القياس.
     */
    async function oneDelivery(i: number) {
      await db.transaction(async (tx) => {
        await postEntry(tx, {
          descriptionAr: `تسليم قياس ${i}`,
          sourceType: "shipment",
          sourceId: crypto.randomUUID(),
          kind: "delivery",
          lines: [
            { account: ACC.courierCash(courierId), debitP: 50000n, creditP: 0n, memo: "تحصيل", courierId },
            { account: ACC.merchantPayable(merchantId), debitP: 0n, creditP: 50000n, memo: "مستحق التاجر" },
            { account: ACC.merchantPayable(merchantId), debitP: 9000n, creditP: 0n, memo: "رسوم" },
            { account: ACC.revenueShipping(), debitP: 0n, creditP: 9000n, memo: "إيراد شحن" },
          ],
        });
      });
    }

    console.log(`\n${"═".repeat(64)}`);
    console.log("  حجم الدفتر │ إعادة حساب كاملة (القديم) │ قيد تسليم (الجديد)");
    console.log(`${"═".repeat(64)}`);

    let made = 0;
    for (const size of SIZES) {
      while (made < size) { await oneDelivery(made++); }

      // إعادة الحساب الكاملة — ده اللي كان بيتعمل مع **كل** تسليم
      const t1 = performance.now();
      for (let i = 0; i < 5; i++) await db.transaction((tx) => recomputeMerchantBalance(tx, merchantId));
      const fullMs = (performance.now() - t1) / 5;

      // قيد تسليم كامل بالمسار الجديد (شامل التحديث التزايدي)
      const t2 = performance.now();
      for (let i = 0; i < 5; i++) await oneDelivery(made++);
      const incrMs = (performance.now() - t2) / 5;

      const ratio = fullMs / incrMs;
      console.log(
        `  ${String(size).padStart(9)} │ ${ms(fullMs).padStart(24)} │ ${ms(incrMs).padStart(18)}` +
        `   (${ratio.toFixed(1)}×)`
      );
    }
    console.log(`${"═".repeat(64)}`);
    console.log("  «إعادة الحساب الكاملة» كانت بتتنفّذ مع كل تسليم — وبتكبر مع الدفتر.");
    console.log("  «قيد التسليم» دلوقتي بيفضل ثابت مهما كبر الدفتر.\n");

    await db.$client.end();
  } finally {
    try { await admin.unsafe(`DROP DATABASE IF EXISTS ${benchDb} WITH (FORCE)`); } catch { /* تجاهل */ }
    console.log("🗑️  اتمسحت قاعدة القياس");
    await admin.end();
  }
}

main().catch((e) => {
  console.error("❌ فشل القياس:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
