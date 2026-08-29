/**
 * اختبار الميدان (مرحلة ي): حضور + GPS + الخريطة الحية.
 * بيسجّل دخول كمندوب حقيقي (بباسورد) عشان الـ endpoints بتاعته.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-field.ts
 */
import postgres from "postgres";
import { hash } from "@node-rs/argon2";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}
async function api(method: string, path: string, body: unknown, jar: { c: string }) {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(jar.c ? { cookie: jar.c } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  const s = sc.find((c) => c.startsWith("tewsal_session="));
  if (s) jar.c = s.split(";")[0]!;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  const stamp = Date.now();
  const admin = { c: "" }, courier = { c: "" };
  try {
    // مندوب بباسورد حقيقي
    const pwHash = await hash("Courier12345", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const uname = "courier_field_" + stamp;
    const cid = crypto.randomUUID();
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${cid}::uuid,'مندوب الميدان',${uname},${pwHash},'courier',false)`;

    console.log("\n═══ الميدان: حضور + GPS + خريطة حية (مرحلة ي) ═══\n");
    check("١) دخول الأدمن", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" }, admin)).status, 200);
    check("   دخول المندوب", (await api("POST", "/api/v1/auth/login", { username: uname, password: "Courier12345" }, courier)).status, 200);

    // ─── الحضور ───
    console.log("  ── الحضور ──");
    check("٢) قبل الحضور: مش حاضر", (await api("GET", "/api/v1/courier/field", null, courier)).json.checkedIn, false);
    check("٣) تسجيل حضور", (await api("POST", "/api/v1/courier/field", { action: "check_in" }, courier)).json.status, "checked_in");
    check("   بقى حاضر", (await api("GET", "/api/v1/courier/field", null, courier)).json.checkedIn, true);

    // ─── GPS ───
    console.log("  ── الموقع ──");
    check("٤) إرسال موقع → ok", (await api("POST", "/api/v1/courier/field", { action: "location", lat: 30.0444, lng: 31.2357 }, courier)).json.ok, true);
    check("   إحداثيات غلط → مرفوض 400", (await api("POST", "/api/v1/courier/field", { action: "location", lat: 999, lng: 31 }, courier)).status, 400);

    // ─── الخريطة الحية (الأدمن) ───
    console.log("  ── الخريطة الحية ──");
    const live = (await api("GET", "/api/v1/reports/couriers-live", null, admin)).json.couriers as Record<string, unknown>[];
    const me = live.find((x) => x.id === cid);
    check("٥) المندوب ظهر في الخريطة الحية", me ? "موجود" : "غايب", "موجود");
    check("   حاضر (on_shift)", me?.on_shift, true);
    check("   آخر موقع اتسجّل (lat)", Math.round(Number(me?.lat)), 30);

    // ─── الانصراف ───
    check("٦) انصراف", (await api("POST", "/api/v1/courier/field", { action: "check_out" }, courier)).json.status, "checked_out");
    check("   بعد الانصراف مش on_shift", ((await api("GET", "/api/v1/reports/couriers-live", null, admin)).json.couriers as Record<string, unknown>[]).find((x) => x.id === cid)?.on_shift, false);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الميدان نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
