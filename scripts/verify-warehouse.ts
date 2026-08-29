/**
 * اختبار المخزن وتعدد الفروع (مرحلة و): فرع جديد + تحويل + جرد.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-warehouse.ts
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
      VALUES (${COURIER}::uuid,'مندوب المخزن',${"courier_wh_" + stamp},'x','courier',false)`;

    console.log("\n═══ المخزن وتعدد الفروع (مرحلة و) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-WH-${stamp % 100000}`, nameAr: "تاجر المخزن", tier: "t1" })).json.merchant.id;

    // ─── فرع جديد ───
    console.log("  ── الفروع ──");
    const br = await api("POST", "/api/v1/branches", { code: `BR-${stamp % 100000}`, nameAr: "فرع طنطا" });
    check("٢) إنشاء فرع جديد → 201", br.status, 201);
    const branchId = br.json.id;
    const branches = (await api("GET", "/api/v1/branches")).json.branches as Record<string, unknown>[];
    check("   الفرع ظهر بخزنته", branches.some((b) => b.id === branchId), true);
    // خزنة الفرع اتعملت
    const [acct] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM accounts WHERE code='BRANCH_CASH' AND owner_id=${branchId}::uuid`;
    check("   حساب خزنة الفرع اتعمل", acct!.n, 1);

    // شحنتين → at_hub في الفرع الرئيسي
    async function toHub(): Promise<{ id: string; awb: string }> {
      const c = (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "300", confirm: true,
      })).json;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${c.id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-7777-4000-8000-000000000009", courierId: COURIER });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      return { id: c.id, awb: c.awb };
    }
    const s1 = await toHub(); const s2 = await toHub();

    // ─── تحويل بين الفروع ───
    console.log("  ── شيتات السفر ──");
    check("٣) تحويل لنفس الفرع → مرفوض 422", (await api("POST", "/api/v1/transfers", { toBranchId: branchId, fromBranchId: branchId })).status, 422);
    const trf = await api("POST", "/api/v1/transfers", { toBranchId: branchId });
    check("٤) إنشاء شيت سفر → 201", trf.status, 201);
    const trfId = trf.json.id;
    check("   إضافة شحنتين", (await api("POST", `/api/v1/transfers/${trfId}`, { action: "add", shipmentIds: [s1.id, s2.id] })).json.added, 2);
    check("   استلام قبل التنزيل → مرفوض 422", (await api("POST", `/api/v1/transfers/${trfId}`, { action: "receive" })).status, 422);
    check("٥) تنزيل الشيت", (await api("POST", `/api/v1/transfers/${trfId}`, { action: "dispatch" })).json.status, "dispatched");
    check("   استلام الشيت → نقل شحنتين", (await api("POST", `/api/v1/transfers/${trfId}`, { action: "receive" })).json.moved, 2);
    const [moved] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM shipments WHERE branch_id=${branchId}::uuid AND status='at_hub'`;
    check("   الشحنتين بقوا في الفرع الجديد", moved!.n, 2);

    // ─── الجرد (على الفرع الجديد — معزول) ───
    console.log("  ── الجرد ──");
    const cnt = await api("POST", "/api/v1/inventory", { branchId });
    check("٦) فتح جرد → متوقع ٢", cnt.json.expected, 2);
    const cntId = cnt.json.id;
    check("٧) مسح شحنة موجودة → matched", (await api("POST", `/api/v1/inventory/${cntId}`, { action: "scan", awb: s1.awb })).json.result, "matched");
    check("   مسح نفس الشحنة تاني → already", (await api("POST", `/api/v1/inventory/${cntId}`, { action: "scan", awb: s1.awb })).json.already, true);
    check("   مسح باركود غريب → unexpected", (await api("POST", `/api/v1/inventory/${cntId}`, { action: "scan", awb: "T99999999999" })).json.result, "unexpected");
    const close = (await api("POST", `/api/v1/inventory/${cntId}`, { action: "close" })).json;
    check("٨) إقفال: معدود ١", close.counted, 1);
    check("   ناقص ١ (الشحنة اللي ماتمسحتش)", close.missing, 1);
    check("   الناقص فيه بوليصة الشحنة التانية", (close.missingAwbs as string[]).includes(s2.awb), true);
    check("   زيادة ١ (الباركود الغريب)", close.unexpected, 1);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المخزن نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
