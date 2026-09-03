/**
 * ============================================================
 *  اختبار التسوية على HTTP — أخطر مسار مالي
 * ------------------------------------------------------------
 *  بيثبت الضمان المقدّس: **مستحيل تحوّل كاش لسه مع المندوب**.
 *   - شحنتين اتسلّموا كاش
 *   - المندوب سلّم عهدة واحدة بس
 *   - التسوية بتاخد المؤكدة بس، والتانية بتستنى
 *   - بعد تسليم العهدة التانية، التسوية بتاخدها
 *   - الشحنة مستحيل تدخل تسويتين
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-settlement-api.ts
 * ============================================================
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { poundsToPiastres as P } from "../src/lib/money";
import { buildAwb } from "../src/lib/awb";
import { buildHandoverEntry, ACC } from "../src/server/domain/ledger";
import { postEntry, accountBalance } from "../src/server/services/ledger";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}
let cookie = "";
async function api(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const db = drizzle(sql);
  const COURIER = "bbbbbbbb-4444-4000-8000-000000000001";
  const BRANCH_ID = "";

  try {
    const [gov] = await sql<{ id: string; zone_id: string }[]>`SELECT id, zone_id FROM governorates WHERE code='CAI'`;
    const [branch] = await sql<{ id: string }[]>`SELECT id FROM branches WHERE code='MAIN'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب التسوية','courier_stl','x','courier',false) ON CONFLICT (id) DO NOTHING`;

    console.log("\n═══ التسوية: مستحيل تحوّل كاش مع المندوب ═══\n");
    const login = await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" });
    check("١) دخول", login.status, 200);

    // تاجر جديد نظيف
    const code = `M-STL-${Date.now() % 100000}`;
    const mer = await api("POST", "/api/v1/merchants", { code, nameAr: "تاجر التسوية", tier: "t1" });
    const merchantId = (mer.json?.merchant as { id: string }).id;

    // شحنتين كاش للقاهرة t1 (سعر ٩٠). ننشئ ونمشّي كل واحدة للتسليم.
    async function makeAndDeliver(cod: string) {
      const s = await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: cod, confirm: true,
      });
      const id = s.json.id as string;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-4444-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "picked_up" });
      await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-4444-4000-8000-000000000001", courierId: COURIER });
      await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: cod, method: "cash" } });
      return id;
    }
    // ⚠️ الترتيب مهم: نسلّم الأولى، المندوب يسلّم عهدته، **بعدين** نسلّم التانية.
    //    كده كاش التانية بيبقى لسه معاه وقت التسوية.
    const ship1 = await makeAndDeliver("1000");
    await new Promise((r) => setTimeout(r, 50));

    // المندوب سلّم عهدته كاملة (بتغطّي الأولى بس لحد دلوقتي)
    await db.transaction(async (tx) => {
      const bal = await accountBalance(tx, ACC.courierCash(COURIER));
      await postEntry(tx, buildHandoverEntry({
        handoverId: crypto.randomUUID(),
        courierId: COURIER, branchId: branch!.id, expectedP: bal, receivedP: bal,
      }));
    });
    await new Promise((r) => setTimeout(r, 50));

    // دلوقتي نسلّم التانية — كاشها لسه في جيب المندوب
    const ship2 = await makeAndDeliver("2000");
    check("٢) اتعملت شحنتين واتسلّموا كاش", !!ship1 && !!ship2, true);

    // تسوية دلوقتي — المفروض تاخد الشحنة الأولى بس (٩١٠ صافي = ١٠٠٠ - ٩٠ شحن)
    // ⚠️ الشحنة التانية كاشها لسه مع المندوب → متتحوّلش
    const run1 = await api("POST", "/api/v1/settlements", { merchantId });
    check("٣) التسوية اشتغلت", run1.status, 201);
    check("   ⚠️ أخدت شحنة واحدة بس (المؤكدة)", run1.json?.itemCount, 1);
    check("   صافيها ٨١٠ ج (١٠٠٠ - ٩٠ شحن - ١٠٠ تحصيل)", run1.json?.netPayable, "810.00 ج");
    const stl1 = run1.json?.settlementId as string;

    // كشف التاجر: مؤكد ٩١٠، تحت التحصيل ١٩١٠ (٢٠٠٠ - ٩٠)
    const stmt = await api("GET", `/api/v1/merchants/${merchantId}/statement`);
    check("٤) كشف: مؤكد ٨١٠", stmt.json?.confirmed, "810.00 ج");
    // رسوم التحصيل بقت بتتخصم مرة واحدة في ميعاد الفاتورة (مش وقت التسليم)،
    // فـ«تحت التحصيل» = ٢٠٠٠ − ٩٠ شحن = ١٩١٠ (الـ١٠٠ بتتخصم مع التسوية).
    check("   كشف: تحت التحصيل ١٩١٠", stmt.json?.inCollection, "1,910.00 ج");

    // اعتماد + دفع التسوية الأولى
    check("٥) اعتماد التسوية", (await api("POST", `/api/v1/settlements/${stl1}/approve`)).json?.status, "approved");
    const pay1 = await api("POST", `/api/v1/settlements/${stl1}/pay`, { method: "bank", reference: "TRX-1" });
    check("   دفع التسوية → قيد تحويل", pay1.json?.status, "paid");

    // إعادة تشغيل التسوية دلوقتي — لسه مفيش جديد مؤكد → 422
    const run2 = await api("POST", "/api/v1/settlements", { merchantId });
    check("٦) مفيش مؤهّل تاني قبل تسليم العهدة → 422", run2.status, 422);

    // المندوب سلّم باقي العهدة (٢٠٠٠)
    await db.transaction(async (tx) => {
      const bal = await accountBalance(tx, ACC.courierCash(COURIER));
      await postEntry(tx, buildHandoverEntry({
        handoverId: crypto.randomUUID(),
        courierId: COURIER, branchId: branch!.id, expectedP: bal, receivedP: bal,
      }));
    });

    // دلوقتي التسوية بتاخد الشحنة التانية
    const run3 = await api("POST", "/api/v1/settlements", { merchantId });
    check("٧) بعد تسليم العهدة → الشحنة التانية مؤهّلة", run3.json?.itemCount, 1);
    check("   صافيها ١٨١٠ ج", run3.json?.netPayable, "1,810.00 ج");

    // الشحنة الأولى مستحيل تدخل تسوية تانية (اتعلّمت مدفوعة)
    const [inItems] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM settlement_items WHERE shipment_id = ${ship1}::uuid`;
    check("٨) الشحنة الأولى في تسوية واحدة بس", inItems!.n, 1);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات التسوية نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
