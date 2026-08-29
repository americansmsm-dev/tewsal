/**
 * ============================================================
 *  اختبار التقارير التشغيلية الثانوية على HTTP
 * ------------------------------------------------------------
 *  ١) دوران المناديب: شحنة سايبها في العهدة → المندوب يبان.
 *  ٢) الراسلين المتوقفين: التاجر بآخر شحنة ومدة سكوته.
 *  ٣) خزائن الفروع: الفرع الرئيسي وكاشه.
 *  ٤) البيك أب الشهري: بنية سليمة.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-reports-ops.ts
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
let cookie = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const COURIER = crypto.randomUUID();
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,${"مندوب الدوران " + (stamp % 1000)},${"courier_ops_" + stamp},'x','courier',false)`;

    console.log("\n═══ التقارير التشغيلية الثانوية ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-OPS-${stamp % 100000}`, nameAr: "تاجر التشغيلي", tier: "t1" })).json.merchant.id;

    // شحنة تفضل في العهدة (out_for_delivery — من غير تسليم)
    const id = (await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true,
    })).json.id as string;
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-6666-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-6666-4000-8000-000000000009", courierId: COURIER });

    const ops = (await api("GET", "/api/v1/reports/ops")).json;

    // ─── ١) دوران المناديب ───
    console.log("  ── دوران المناديب ──");
    const t = (ops.turnover as Array<Record<string, unknown>>).find((x) => x.id === COURIER);
    check("٢) المندوب بان في الدوران", t ? "موجود" : "غايب", "موجود");
    check("   شحنة واحدة في العهدة", t?.inCustody, 1);
    check("   أقدم شحنة ٠ يوم (لسه خرجت)", t?.oldestDays, 0);

    // ─── ٢) الراسلين المتوقفين ───
    console.log("  ── الراسلين المتوقفين ──");
    const d = (ops.dormant.rows as Array<Record<string, unknown>>).find((x) => x.id === merchantId);
    check("٣) التاجر بان في القائمة", d ? "موجود" : "غايب", "موجود");
    check("   مدة سكوته ٠ يوم (شحنة النهاردة)", d?.daysSinceLast, 0);
    check("   عتبة التوقف افتراضي ١٤ يوم", ops.dormant.dormantAfterDays, 14);

    // ─── ٣) خزائن الفروع ───
    console.log("  ── خزائن الفروع ──");
    const main = (ops.treasury.branches as Array<Record<string, unknown>>).find((b) => b.code === "MAIN");
    check("٤) الفرع الرئيسي بان", main ? "موجود" : "غايب", "موجود");
    check("   عنده حقل الكاش في الخزنة", typeof main?.cashOnHandP === "string", true);
    // كاش الخزنة = الوارد − المودَع − أي صرف كاش (بنتأكد إنه رقم متسق مش سالب غريب)
    const [ledgerCash] = await sql<{ b: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS b
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      JOIN branches br ON br.id = a.owner_id AND br.code = 'MAIN'
      WHERE a.code = 'BRANCH_CASH'`;
    check("   كاش الخزنة مطابق للدفتر", main?.cashOnHandP, ledgerCash!.b);

    // ─── ٤) البيك أب الشهري ───
    console.log("  ── البيك أب الشهري ──");
    check("٥) البيك أب الشهري بنية سليمة (مصفوفة)", Array.isArray(ops.pickups), true);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات التقارير التشغيلية نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
