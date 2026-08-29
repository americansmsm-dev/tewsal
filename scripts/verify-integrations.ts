/**
 * اختبار التكاملات (مرحلة ح): استيراد بمعاينة + توكن API عام + ويب-هوك.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-integrations.ts
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
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    console.log("\n═══ التكاملات والـ API (مرحلة ح) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-INT-${stamp % 100000}`, nameAr: "تاجر التكامل", tier: "t1" })).json.merchant.id;

    // ─── الاستيراد ───
    console.log("  ── الاستيراد بمعاينة ──");
    const rows = [
      { recipientName: "أحمد", recipientPhone: "01011112222", governorate: "اسكندريه", addressLine: "سموحة", codAmount: "500" }, // alias → الإسكندرية
      { recipientName: "", recipientPhone: "0100", governorate: "القاهرة", addressLine: "المعادي" }, // اسم وموبايل غلط
      { recipientName: "منى", recipientPhone: "01033334444", governorate: "بلد مش موجود", addressLine: "x" }, // محافظة مجهولة
    ];
    const prev = (await api("POST", "/api/v1/imports", { action: "preview", merchantId, rows })).json;
    check("٢) المعاينة: صف صالح واحد", prev.validCount, 1);
    check("   المرادف «اسكندريه» اتعرّف كمحافظة", (prev.results as { index: number; ok: boolean }[])[0]!.ok, true);
    check("   الصف الغلط فيه أخطاء", (prev.results as { errors: string[] }[])[1]!.errors.length > 0, true);
    check("   المحافظة المجهولة فيها خطأ", (prev.results as { errors: string[] }[])[2]!.errors.some((e) => e.includes("محافظة")), true);

    const commit = (await api("POST", "/api/v1/imports", { action: "commit", merchantId, rows: [rows[0]] })).json;
    check("٣) تنفيذ الاستيراد: اتعملت شحنة واحدة", commit.created, 1);

    // ─── توكن API + الـ endpoint العام ───
    console.log("  ── توكن API العام ──");
    const tok = await api("POST", `/api/v1/merchants/${merchantId}/integrations`, { action: "token", name: "متجري" });
    check("٤) إنشاء توكن → 201", tok.status, 201);
    const token = tok.json.token as string;
    check("   التوكن بيبدأ بـ tw_", token.startsWith("tw_"), true);
    // استخدام التوكن على الـ API العام
    const pub = await api("POST", "/api/public/v1/shipments", { recipientName: "عميل API", recipientPhone: "01055556666", governorateId: gov!.id, addressLine: "مدينة نصر", codAmount: "300" }, { authorization: `Bearer ${token}` });
    check("٥) إنشاء شحنة عبر الـ API العام → 201", pub.status, 201);
    check("   رجّع رقم بوليصة", (pub.json.awb as string)?.startsWith("T"), true);
    check("   بدون توكن → 401", (await api("POST", "/api/public/v1/shipments", { recipientName: "x", recipientPhone: "01055556666", governorateId: gov!.id, addressLine: "x" })).status, 401);

    // إيقاف التوكن
    const [tokRow] = await sql<{ id: string }[]>`SELECT id::text FROM api_tokens WHERE merchant_id=${merchantId}::uuid ORDER BY created_at DESC LIMIT 1`;
    check("٦) إيقاف التوكن", (await api("DELETE", `/api/v1/api-tokens/${tokRow!.id}`)).status, 200);
    check("   التوكن الموقوف → 401", (await api("POST", "/api/public/v1/shipments", { recipientName: "x", recipientPhone: "01055556666", governorateId: gov!.id, addressLine: "x", codAmount: "10" }, { authorization: `Bearer ${token}` })).status, 401);

    // ─── ويب-هوك ───
    console.log("  ── الويب-هوك ──");
    const wh = await api("POST", `/api/v1/merchants/${merchantId}/integrations`, { action: "webhook", url: "https://example.com/hook", events: "delivered,delivery_failed" });
    check("٧) تسجيل ويب-هوك → 201", wh.status, 201);
    const list = (await api("GET", `/api/v1/merchants/${merchantId}/integrations`)).json;
    check("   الويب-هوك ظهر في القائمة", (list.webhooks as unknown[]).length, 1);
    check("   URL غير صالح → مرفوض", (await api("POST", `/api/v1/merchants/${merchantId}/integrations`, { action: "webhook", url: "notaurl" })).status, 400);
    check("٨) حذف الويب-هوك", (await api("DELETE", `/api/v1/webhooks/${wh.json.id}`)).status, 200);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات التكاملات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
