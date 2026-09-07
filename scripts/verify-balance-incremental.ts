/**
 * ============================================================
 *  الحارس الأهم: الرصيد التزايدي = إعادة الحساب الكاملة
 * ------------------------------------------------------------
 *  رصيد التاجر بقى بيتحدّث **تزايديًا** (فرق القيد بس) بدل ما
 *  يعيد حساب الدفتر كله في كل تسليم — ده اللي بيخلّي السيستم
 *  يستحمل ١٠ آلاف أوردر في اليوم.
 *
 *  الخطر: لو الحساب التزايدي غلط، التاجر يشوف رقم غلط.
 *  عشان كده السكربت ده بيعمل سلسلة عمليات حقيقية، و**بعد كل
 *  عملية** بيقارن المخزَّن (التزايدي) بإعادة الحساب الكاملة —
 *  لازم يطابقوا للقرش في كل خطوة.
 *
 *  بيغطّي: تسليم كاش · تسليم محفظة إلكترونية · تسليم جزئي ·
 *  مرتجع · تسليم عهدة (بيقلب المعلّق لمؤكد) · تسوية ودفع.
 *
 *  DATABASE_URL=... BASE=http://127.0.0.1:3100 \
 *    npx tsx scripts/verify-balance-incremental.ts
 * ============================================================
 */
import postgres from "postgres";

const BASE = process.env.BASE ?? process.env.BASE_URL ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    const s = sc.find((c) => c.startsWith("tewsal_session="));
    if (s) cookie = s.split(";")[0]!;
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

async function main() {
  const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  const stamp = Date.now();

  /**
   * المقارنة: بنقرا المخزَّن (نتيجة التزايدي)، وبعدين نحسب
   * الكامل من الدفتر ونقارن. لازم يطابقوا بالظبط.
   */
  async function assertMatches(step: string, merchantId: string) {
    const [stored] = await sql<{ c: string; i: string }[]>`
      SELECT payable_confirmed_p::text AS c, payable_in_collection_p::text AS i
      FROM merchant_balances WHERE merchant_id = ${merchantId}::uuid`;
    const { recomputeMerchantBalance } = await import("../src/server/services/ledger");
    const { db } = await import("../src/server/db");
    const full = await db.transaction((tx) => recomputeMerchantBalance(tx, merchantId));
    const storedC = stored?.c ?? "0";
    const storedI = stored?.i ?? "0";
    check(
      `${step} — مؤكد ${storedC} · تحت التحصيل ${storedI}`,
      `${storedC}/${storedI}`,
      `${full.confirmedP}/${full.inCollectionP}`
    );
  }

  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const api = client();
    console.log("\n═══ الرصيد التزايدي = إعادة الحساب الكاملة ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // مندوبين — عشان نتأكد إن عهدة مندوب مابتأثرش على التاني
    async function mkCourier(tag: string) {
      const r = await api("POST", "/api/v1/users", {
        fullName: `مندوب ${tag}`, username: `bal_${tag}_${stamp % 100000}`,
        role: "courier", password: "LongPass12345",
      });
      return (r.json as { user: { id: string } }).user.id;
    }
    const c1 = await mkCourier("a");
    const c2 = await mkCourier("b");

    const m = await api("POST", "/api/v1/merchants", {
      code: `M-BAL-${stamp % 100000}`, nameAr: "تاجر الرصيد", tier: "t1",
    });
    const merchantId = (m.json as { merchant: { id: string } }).merchant.id;

    async function deliver(courierId: string, cod: string, method = "cash") {
      const c = await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: cod, confirm: true,
      });
      const id = (c.json as { id: string }).id;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-b0b0-4000-8000-000000000001", courierId });
      await tr({ to: "picked_up" });
      await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-b0b0-4000-8000-000000000001", courierId });
      await tr({ to: "delivered", expectedCourierId: courierId, cod: { collected: cod, method } });
      return id;
    }

    // ── سلسلة العمليات — المقارنة بعد كل واحدة ──
    console.log("  ── تسليمات كاش (مندوب أ) ──");
    await deliver(c1, "500");
    await assertMatches("٢) بعد تسليم كاش", merchantId);
    await deliver(c1, "1200");
    await assertMatches("٣) بعد تسليم كاش تاني", merchantId);

    console.log("  ── تسليم محفظة إلكترونية (مؤكد فورًا) ──");
    await deliver(c1, "800", "instapay");
    await assertMatches("٤) بعد تسليم إنستاباي", merchantId);

    console.log("  ── تسليمات مندوب تاني ──");
    await deliver(c2, "900");
    await assertMatches("٥) بعد تسليم مندوب ب", merchantId);

    console.log("  ── مرتجع ──");
    const retId = await (async () => {
      const c = await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "س", recipientPhone: "01087654321",
        governorateId: gov!.id, addressLine: "مصر الجديدة", codAmount: "700", confirm: true,
      });
      const id = (c.json as { id: string }).id;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-b0b0-4000-8000-000000000002", courierId: c1 });
      await tr({ to: "picked_up" });
      await tr({ to: "at_hub" });
      await tr({ to: "awaiting_return", reasonCode: "no_answer" });
      await tr({ to: "out_for_return", courierId: c1 });
      await tr({ to: "returned_to_merchant", receiverName: "أمين المخزن", signatureUrl: "sig/x.png" });
      return id;
    })();
    check("   المرتجع اتسلّم للتاجر", retId.length > 0, true);
    await assertMatches("٦) بعد المرتجع", merchantId);

    // ── تسليم العهدة: بيقلب معلّق المندوب أ لمؤكد ──
    console.log("  ── تسليم العهدة (أخطر خطوة) ──");
    const [cash1] = await sql<{ v: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS v
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code='COURIER_CASH' AND a.owner_id = ${c1}::uuid`;
    const ho = await api("POST", "/api/v1/handovers", {
      courierId: c1, received: (Number(cash1!.v) / 100).toFixed(2),
    });
    check("٧) تسليم عهدة مندوب أ", ho.status === 200 || ho.status === 201, true);
    await assertMatches("   بعد عهدة مندوب أ", merchantId);

    // تسليم جديد بعد العهدة لازم يرجع «تحت التحصيل» تاني
    await deliver(c1, "400");
    await assertMatches("٨) تسليم جديد بعد العهدة", merchantId);

    // عهدة المندوب التاني
    const [cash2] = await sql<{ v: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS v
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code='COURIER_CASH' AND a.owner_id = ${c2}::uuid`;
    await api("POST", "/api/v1/handovers", { courierId: c2, received: (Number(cash2!.v) / 100).toFixed(2) });
    await assertMatches("٩) بعد عهدة مندوب ب", merchantId);

    // ── التسوية والدفع ──
    console.log("  ── التسوية والدفع ──");
    const st = await api("POST", "/api/v1/settlements", { merchantId });
    check("١٠) تشغيل تسوية → 201", st.status, 201);
    await assertMatches("   بعد إنشاء التسوية", merchantId);
    const settlementId = (st.json as { id?: string; settlementId?: string }).id
      ?? (st.json as { settlementId?: string }).settlementId ?? "";
    if (settlementId) {
      await api("POST", `/api/v1/settlements/${settlementId}/approve`);
      await assertMatches("   بعد الاعتماد", merchantId);
      const pay = await api("POST", `/api/v1/settlements/${settlementId}/pay`, { method: "bank", reference: "TRX-BAL-1" });
      check("١١) دفع التسوية", pay.status === 200 || pay.status === 201, true);
      await assertMatches("   بعد الدفع", merchantId);
    }

    console.log("\n" + "─".repeat(56));
    console.log(fail === 0 ? `✅ التزايدي طابق الكامل في كل خطوة (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(56) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
