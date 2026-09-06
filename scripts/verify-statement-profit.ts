/**
 * ============================================================
 *  اختبار كشف التاجر التفصيلي + مكسب الشركة + الخصوصية
 * ------------------------------------------------------------
 *  ١) كشف التاجر بيرجّع لكل أوردر: المحصّل، الشحن، الرسوم،
 *     صافي التاجر، عمولة المندوب، ومكسب الشركة.
 *  ٢) المكسب = الرسوم − عمولة المندوب − التعويضات (لكل أوردر
 *     ولكل التاجر).
 *  ٣) بعد تسجيل عمولة المندوب، المكسب بيقل بمقدار العمولة.
 *  ٤) 🔒 الخصوصية: التاجر بجلسته مايشوفش مكسب الشركة ولا العمولة.
 *  ٥) تبويب «ربحية التجار» بيرجّع الربح والهامش.
 *
 *  DATABASE_URL=postgres://postgres@127.0.0.1:54320/tewsal \
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-statement-profit.ts
 * ============================================================
 */
import postgres from "postgres";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
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
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,${"مندوب الكشف " + (stamp % 1000)},${"courier_st_" + stamp},'x','courier',false)`;

    console.log("\n═══ كشف التاجر التفصيلي + المكسب ═══\n");
    const admin = client();
    check("١) دخول المدير", (await admin("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const uname = `st_merch_${stamp % 100000}`;
    const mR = await admin("POST", "/api/v1/merchants", {
      code: `M-ST-${stamp % 100000}`, nameAr: "تاجر الكشف", tier: "t1", loginUsername: uname,
    });
    const merchantId = mR.json.merchant.id as string;
    const tempPw = mR.json.login.tempPassword as string;

    // تسليم شحنتين cod 1000 (t1 القاهرة → شحن ٩٠ ج)
    const shipIds: string[] = [];
    async function deliver(cod: string) {
      const id = (await admin("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: cod, confirm: true,
      })).json.id as string;
      shipIds.push(id);
      const tr = (b: unknown) => admin("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-7777-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-7777-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: cod, method: "cash" } });
    }
    await deliver("1000"); await deliver("1000");

    // ─── الكشف قبل تسجيل العمولة ───
    console.log("  ── الكشف (قبل العمولة) ──");
    const st1 = (await admin("GET", `/api/v1/merchants/${merchantId}/statement`)).json;
    check("٢) المدير بيشوف المكسب (canSeeProfit)", st1.canSeeProfit, true);
    check("   عدد السطور ٢", st1.lines.length, 2);
    const l0 = st1.lines[0];
    check("٣) الشحن ٩٠ ج على الأوردر", l0.shipping, "90.00 ج");
    check("   عمولة المندوب لسه ٠", l0.commissionP, "0");
    // مكسب الأوردر = رسوم − عمولة − تعويض
    check("٤) مكسب الأوردر = الرسوم − العمولة − التعويض",
      l0.profitP,
      (BigInt(l0.feesRevenueP) - BigInt(l0.commissionP) - BigInt(l0.compensationP)).toString());
    // ملخّص التاجر: مكسب = إيراد − عمولة − تعويض
    const s1 = st1.summary;
    check("٥) ملخّص المكسب = الإيراد − العمولات − التعويضات",
      s1.profitP,
      (BigInt(s1.feesRevenueP) - BigInt(s1.commissionP) - BigInt(s1.compensationP)).toString());
    check("   العمولات لسه ٠ في الملخّص", s1.commissionP, "0");
    // من غير تسوية: مجموع مكسب السطور = مكسب الملخّص (مفيش رسم تحصيل أسبوعي لسه)
    const sumLineProfit = (st1.lines as Array<{ profitP: string }>).reduce((a, l) => a + BigInt(l.profitP), 0n);
    check("٦) مجموع مكسب السطور = مكسب الملخّص", s1.profitP, sumLineProfit.toString());

    // ─── تسجيل عمولة المندوب ٥٠ ج/أوردر ───
    console.log("  ── تسجيل العمولة ──");
    const cm = await admin("POST", "/api/v1/courier-commissions", {
      courierId: COURIER, shipmentIds: shipIds, amountPerOrder: "50",
    });
    check("٧) تسجيل العمولة → 201", cm.status, 201);

    const st2 = (await admin("GET", `/api/v1/merchants/${merchantId}/statement`)).json;
    const l2 = st2.lines[0];
    check("٨) عمولة الأوردر بقت ٥٠ ج", l2.commissionP, "5000");
    check("   مكسب الأوردر قلّ بمقدار العمولة",
      l2.profitP, (BigInt(l2.feesRevenueP) - 5000n - BigInt(l2.compensationP)).toString());
    check("٩) إجمالي العمولات في الملخّص ١٠٠ ج", st2.summary.commissionP, "10000");
    check("   مكسب الملخّص = الإيراد − ١٠٠ − التعويضات",
      st2.summary.profitP, (BigInt(st2.summary.feesRevenueP) - 10000n - BigInt(st2.summary.compensationP)).toString());

    // ─── 🔒 الخصوصية: التاجر مايشوفش المكسب ───
    console.log("  ── الخصوصية ──");
    const merchant = client();
    await merchant("POST", "/api/v1/auth/login", { username: uname, password: tempPw });
    const stM = (await merchant("GET", `/api/v1/merchants/${merchantId}/statement`)).json;
    check("١٠) التاجر canSeeProfit = false", stM.canSeeProfit, false);
    check("   سطور التاجر من غير حقل مكسب", stM.lines[0]?.profit === undefined, true);
    check("   سطور التاجر من غير حقل عمولة", stM.lines[0]?.commission === undefined, true);
    check("   ملخّص التاجر من غير مكسب", stM.summary?.profitP === undefined, true);
    check("   بس التاجر بيشوف صافيه والشحن", typeof stM.lines[0]?.net === "string" && stM.lines[0]?.shipping === "90.00 ج", true);

    // ─── تبويب ربحية التجار ───
    console.log("  ── ربحية التجار ──");
    const rep = (await admin("GET", "/api/v1/reports/merchants")).json.merchants as Array<Record<string, unknown>>;
    const m = rep.find((x) => x.id === merchantId);
    check("١١) التاجر ظهر بالربح", m ? "موجود" : "غايب", "موجود");
    check("   الربح = الإيراد − العمولات − التعويضات",
      m?.profitP, (BigInt(String(m?.revenueP)) - BigInt(String(m?.commissionP)) - BigInt(String(m?.compensationP))).toString());
    check("   العمولات ١٠٠ ج", m?.commissionP, "10000");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الكشف والمكسب نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
