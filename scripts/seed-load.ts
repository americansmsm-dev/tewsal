/**
 * ============================================================
 *  بذور اختبار الحمل — قاعدة بحجم سنة شغل حقيقية
 * ------------------------------------------------------------
 *  السؤال اللي السكربت ده بيجاوبه: «السيستم هيستحمل ١٠ آلاف
 *  أوردر في اليوم؟» — والجواب مايتقالش بالكلام. بنبني قاعدة
 *  **منفصلة** فيها مليون شحنة (١٠٠ يوم × ١٠ آلاف) ودفتر يومية
 *  بحجمها، وبعدين نقيس عليها.
 *
 *  ⚠️ قاعدة منفصلة بالكامل — staging والإنتاج مابيتلمسوش.
 *
 *  الأداء: بنستخدم generate_series (مش حلقة في الكود) وبنطفّي
 *  الـtriggers أثناء التحميل (session_replication_role) — ده
 *  الأسلوب القياسي للتحميل المجمّع. بعد الانتهاء بنرجّعها
 *  و**نتأكد إن الدفتر متوازن** — لو مش متوازن السكربت بيفشل.
 *
 *  npx tsx scripts/seed-load.ts --shipments=1000000
 *  npx tsx scripts/seed-load.ts --shipments=50000 --db=tewsal_load_small
 * ============================================================
 */
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { buildAwb } from "../src/lib/awb";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);

const SHIPMENTS = Number(arg("shipments") ?? 1_000_000);
const MERCHANTS = Number(arg("merchants") ?? 200);
const COURIERS = Number(arg("couriers") ?? 60);
const DAYS = Number(arg("days") ?? Math.max(1, Math.ceil(SHIPMENTS / 10_000)));
const CHUNK = Number(arg("chunk") ?? 50_000);
const DB_NAME = arg("db") ?? "tewsal_load";

const BASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
const adminUrl = BASE_URL.replace(/\/[^/]+$/, "/postgres");
const loadUrl = BASE_URL.replace(/\/[^/]+$/, `/${DB_NAME}`);

function sh(cmd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} فشل:\n${((r.stdout ?? "") + (r.stderr ?? "")).slice(-1500)}`);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const secs = (t: number) => `${((performance.now() - t) / 1000).toFixed(1)}s`;

async function main() {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  بذور الحمل — ${fmt(SHIPMENTS)} شحنة على ${fmt(DAYS)} يوم`);
  console.log(`  القاعدة: ${DB_NAME}  ·  التجار ${MERCHANTS}  ·  المناديب ${COURIERS}`);
  console.log(`${"═".repeat(64)}\n`);

  if (!has("keep")) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    console.log("🗄️  القاعدة اتعملت");
    let t = performance.now();
    sh("npx", ["tsx", "scripts/migrate.ts"], { DATABASE_URL: loadUrl });
    console.log(`✅ الهجرات (${secs(t)})`);
    t = performance.now();
    sh("npx", ["tsx", "scripts/seed.ts"], { DATABASE_URL: loadUrl });
    console.log(`✅ البذور الأساسية (${secs(t)})`);
  }
  await admin.end();

  const sql = postgres(loadUrl, { max: 1, onnotice: () => {} });
  try {
    // ── التجار والمناديب ──
    let t = performance.now();
    await sql.unsafe(`
      INSERT INTO merchants (code, name_ar, tier, cod_enabled, is_active)
      SELECT 'ML-' || lpad(i::text, 5, '0'),
             'تاجر الحمل ' || i,
             (ARRAY['t1','t2','t3'])[1 + (i % 3)],
             true, true
      FROM generate_series(1, ${MERCHANTS}) i
      ON CONFLICT (code) DO NOTHING`);
    await sql.unsafe(`
      INSERT INTO users (full_name, username, password_hash, role, must_change_password, is_active)
      SELECT 'مندوب الحمل ' || i, 'load_courier_' || i, 'x', 'courier', false, true
      FROM generate_series(1, ${COURIERS}) i
      ON CONFLICT DO NOTHING`);
    console.log(`✅ ${MERCHANTS} تاجر و${COURIERS} مندوب (${secs(t)})`);

    // ⚠️ إطفاء الـtriggers أثناء التحميل — بيترجّعوا تحت
    //    ويتأكد من التوازن بعدها. من غير كده كل سطر يومية
    //    بيشغّل فحص التوازن = ساعات بدل دقايق.
    await sql.unsafe(`SET session_replication_role = replica`);

    // ── الشحنات ──
    // ⚠️ بنسحب المعرّفات لمصفوفات الأول وبنفهرسها بـ O(1) جوّه
    //    الاستعلام. لو سبناها SELECT … OFFSET جوّه LATERAL، كل صف
    //    من المليون هيعمل مسح فهرس لوحده = ساعات بدل دقايق.
    const merchantIds = (await sql<{ id: string }[]>`
      SELECT id::text FROM merchants WHERE code LIKE 'ML-%' ORDER BY code`).map((r) => r.id);
    const courierIds = (await sql<{ id: string }[]>`
      SELECT id::text FROM users WHERE username LIKE 'load_courier_%' ORDER BY username`).map((r) => r.id);
    const govs = await sql<{ id: string; zone_id: string }[]>`
      SELECT id::text, zone_id::text FROM governorates WHERE is_served ORDER BY code`;
    if (merchantIds.length === 0 || courierIds.length === 0 || govs.length === 0) {
      throw new Error("مفيش تجار/مناديب/محافظات — البذور الأساسية مامشيتش صح");
    }
    const govIds = govs.map((g) => g.id);
    const zoneIds = govs.map((g) => g.zone_id);

    // التوزيع الواقعي: ٧٠٪ تسليم · ١٢٪ مرتجع للتاجر · ٨٪ في الطريق
    // · ٥٪ في المخزن · ٣٪ تعذّر · ٢٪ فقد
    console.log(`
📦 الشحنات — على دفعات ${fmt(CHUNK)}`);
    t = performance.now();
    const year = new Date().getFullYear();
    const INSERT_SHIPMENTS = `
      INSERT INTO shipments (
        awb, merchant_id, recipient_name, recipient_phone, governorate_id, zone_id,
        address_line, cod_amount_p, price_p, total_fees_p, merchant_net_p,
        status, current_courier_id, delivered_at, attempts_count, is_settled,
        created_at, updated_at, status_updated_at
      )
      SELECT
        ($11::text[])[i],
        ($2::uuid[])[1 + (($1::bigint + i) % $5::int)],
        'مستلم ' || i,
        '010' || lpad((($1::bigint + i) % 100000000)::text, 8, '0'),
        ($4::uuid[])[1 + (($1::bigint + i) % $7::int)],
        ($8::uuid[])[1 + (($1::bigint + i) % $7::int)],
        'شارع ' || i || ' — حي ' || (i % 40),
        ((i % 40) + 1) * 2500,                    -- تحصيل ٢٥–١٠٠٠ جنيه
        4500 + ((i % 6) * 1000),                  -- شحن ٤٥–١٠٠ جنيه
        4500 + ((i % 6) * 1000) + 500,
        ((i % 40) + 1) * 2500 - (5000 + ((i % 6) * 1000)),
        st.status,
        CASE WHEN st.status IN ('delivered','partially_delivered','returned_to_merchant','out_for_delivery')
             THEN ($3::uuid[])[1 + (($1::bigint + i) % $6::int)] ELSE NULL END,
        CASE WHEN st.status IN ('delivered','partially_delivered') THEN ts.created ELSE NULL END,
        (i % 3), false,
        ts.created, ts.created, ts.created
      FROM generate_series(1, $9::int) i
      CROSS JOIN LATERAL (
        SELECT now() - ((($1::bigint + i) % $10::int) * interval '1 day')
                     - ((i % 86400) * interval '1 second') AS created
      ) ts
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN (i % 100) < 70 THEN 'delivered'
          WHEN (i % 100) < 82 THEN 'returned_to_merchant'
          WHEN (i % 100) < 90 THEN 'out_for_delivery'
          WHEN (i % 100) < 95 THEN 'at_hub'
          WHEN (i % 100) < 98 THEN 'delivery_failed'
          ELSE 'lost' END AS status
      ) st`;

    for (let done = 0; done < SHIPMENTS; done += CHUNK) {
      const size = Math.min(CHUNK, SHIPMENTS - done);
      const t0 = performance.now();
      // ⚠️ بوالص **صالحة** برقم تحقق Luhn — لو ولّدنا أرقام عشوائية،
      //    مسار التتبع بيرفضها قبل ما يوصل القاعدة، فالقياس بيبقى
      //    بيقيس التحقق مش الاستعلام.
      const awbs = Array.from({ length: size }, (_, k) => buildAwb(done + k + 1, year));
      await sql.unsafe(INSERT_SHIPMENTS, [
        done, merchantIds, courierIds, govIds,
        merchantIds.length, courierIds.length, govIds.length,
        zoneIds, size, DAYS, awbs,
      ]);
      const pct = Math.round(((done + size) / SHIPMENTS) * 100);
      process.stdout.write(`   ${String(pct).padStart(3)}%  ${fmt(done + size).padStart(10)} شحنة   (${secs(t0)})
`);
    }
    console.log(`✅ الشحنات (${secs(t)})`);

    // ── الدفتر: قيد متوازن لكل شحنة مُسلَّمة ──
    // ٤ سطور: كاش المندوب (مدين) / مستحقات التاجر (دائن)
    //          مستحقات التاجر (مدين بالرسوم) / إيراد الشحن (دائن)
    console.log(`\n📒 الدفتر — قيد لكل شحنة مُسلَّمة`);
    t = performance.now();
    await sql.unsafe(`
      INSERT INTO journal_entries (entry_date, description_ar, source_type, source_id, kind, posted_at)
      SELECT s.delivered_at, 'تسليم ' || s.awb, 'shipment', s.id, 'delivery', s.delivered_at
      FROM shipments s WHERE s.status IN ('delivered','partially_delivered')`);
    console.log(`   القيود (${secs(t)})`);

    // حسابات المناديب والتجار — لازم تتعمل الأول
    t = performance.now();
    await sql.unsafe(`
      INSERT INTO accounts (code, name_ar, type, owner_type, owner_id)
      SELECT 'COURIER_CASH', 'كاش المندوب — ' || u.full_name, 'asset', 'courier', u.id
      FROM users u WHERE u.role = 'courier'
        AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.code='COURIER_CASH' AND a.owner_id = u.id)`);
    await sql.unsafe(`
      INSERT INTO accounts (code, name_ar, type, owner_type, owner_id)
      SELECT 'MERCHANT_PAYABLE', 'مستحقات — ' || m.name_ar, 'liability', 'merchant', m.id
      FROM merchants m
        WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.code='MERCHANT_PAYABLE' AND a.owner_id = m.id)`);
    console.log(`   حسابات المناديب والتجار (${secs(t)})`);

    t = performance.now();
    await sql.unsafe(`
      INSERT INTO journal_lines (entry_id, account_id, debit_p, credit_p, shipment_id, merchant_id, memo)
      SELECT je.id, ca.id, s.cod_amount_p, 0, s.id, s.merchant_id, 'تحصيل'
      FROM journal_entries je
      JOIN shipments s ON s.id = je.source_id AND je.source_type = 'shipment' AND je.kind = 'delivery'
      JOIN accounts ca ON ca.code = 'COURIER_CASH' AND ca.owner_id = s.current_courier_id`);
    await sql.unsafe(`
      INSERT INTO journal_lines (entry_id, account_id, debit_p, credit_p, shipment_id, merchant_id, memo)
      SELECT je.id, ma.id, 0, s.cod_amount_p, s.id, s.merchant_id, 'مستحق التاجر'
      FROM journal_entries je
      JOIN shipments s ON s.id = je.source_id AND je.source_type = 'shipment' AND je.kind = 'delivery'
      JOIN accounts ma ON ma.code = 'MERCHANT_PAYABLE' AND ma.owner_id = s.merchant_id`);
    await sql.unsafe(`
      INSERT INTO journal_lines (entry_id, account_id, debit_p, credit_p, shipment_id, merchant_id, memo)
      SELECT je.id, ma.id, s.total_fees_p, 0, s.id, s.merchant_id, 'رسوم'
      FROM journal_entries je
      JOIN shipments s ON s.id = je.source_id AND je.source_type = 'shipment' AND je.kind = 'delivery'
      JOIN accounts ma ON ma.code = 'MERCHANT_PAYABLE' AND ma.owner_id = s.merchant_id`);
    await sql.unsafe(`
      INSERT INTO journal_lines (entry_id, account_id, debit_p, credit_p, shipment_id, merchant_id, memo)
      SELECT je.id, ra.id, 0, s.total_fees_p, s.id, s.merchant_id, 'إيراد شحن'
      FROM journal_entries je
      JOIN shipments s ON s.id = je.source_id AND je.source_type = 'shipment' AND je.kind = 'delivery'
      JOIN accounts ra ON ra.code = 'REVENUE_SHIPPING' AND ra.owner_id IS NULL`);
    console.log(`   السطور (${secs(t)})`);

    // ── تاريخ الحالات — سطرين لكل شحنة ──
    t = performance.now();
    await sql.unsafe(`
      INSERT INTO shipment_status_history (shipment_id, from_status, to_status, actor_role, actor_name, occurred_at, recorded_at)
      SELECT s.id, NULL, 'draft', 'system', 'بذور الحمل', s.created_at, s.created_at FROM shipments s`);
    await sql.unsafe(`
      INSERT INTO shipment_status_history (shipment_id, from_status, to_status, actor_role, actor_name, occurred_at, recorded_at)
      SELECT s.id, 'at_hub', 'picked_up', 'courier', 'بذور الحمل',
             s.created_at + interval '2 hours', s.created_at + interval '2 hours'
      FROM shipments s`);
    console.log(`   تاريخ الحالات (${secs(t)})`);

    // ── أرصدة التجار المخزّنة (زي ما التطبيق بيعملها) ──
    t = performance.now();
    await sql.unsafe(`
      INSERT INTO merchant_balances (merchant_id, payable_confirmed_p, payable_in_collection_p, last_recomputed_at)
      SELECT a.owner_id, 0, COALESCE(SUM(jl.credit_p - jl.debit_p), 0), now()
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id IS NOT NULL
      GROUP BY a.owner_id
      ON CONFLICT (merchant_id) DO UPDATE SET
        payable_in_collection_p = EXCLUDED.payable_in_collection_p,
        last_recomputed_at = now()`);
    console.log(`   أرصدة التجار (${secs(t)})`);

    // ⚠️ رجّع الـtriggers — كل الكتابة اللي بعد كده محروسة زي الإنتاج
    await sql.unsafe(`SET session_replication_role = DEFAULT`);

    console.log(`\n📊 ANALYZE — عشان المخطِّط يشوف الحجم الحقيقي`);
    t = performance.now();
    await sql.unsafe(`ANALYZE`);
    console.log(`✅ (${secs(t)})`);

    // ── التحقق: الدفتر لازم يبقى متوازن ──
    const [bal] = await sql<{ d: string; c: string }[]>`
      SELECT COALESCE(SUM(debit_p),0)::text AS d, COALESCE(SUM(credit_p),0)::text AS c FROM journal_lines`;
    const counts = await sql<{ t: string; n: string }[]>`
      SELECT 'شحنات' AS t, COUNT(*)::text AS n FROM shipments
      UNION ALL SELECT 'قيود يومية', COUNT(*)::text FROM journal_entries
      UNION ALL SELECT 'سطور يومية', COUNT(*)::text FROM journal_lines
      UNION ALL SELECT 'تاريخ حالات', COUNT(*)::text FROM shipment_status_history`;
    const [size] = await sql<{ s: string }[]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS s`;

    console.log(`\n${"═".repeat(64)}`);
    for (const c of counts) console.log(`  ${c.t.padEnd(14)} ${fmt(Number(c.n)).padStart(14)}`);
    console.log(`  ${"حجم القاعدة".padEnd(14)} ${(size?.s ?? "?").padStart(14)}`);
    console.log(`${"═".repeat(64)}`);

    const balanced = bal!.d === bal!.c;
    console.log(balanced
      ? `\n✅ الدفتر متوازن — ${fmt(Number(bal!.d) / 100)} ج على الطرفين`
      : `\n❌ الدفتر مش متوازن! مدين ${bal!.d} ≠ دائن ${bal!.c}`);

    console.log(`\n🎯 القاعدة جاهزة للقياس:\n   DATABASE_URL=${loadUrl}\n`);
    process.exitCode = balanced ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("\n❌ فشلت البذور:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
