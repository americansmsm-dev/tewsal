/**
 * ============================================================
 *  اختبار مرفقات الشحنة (صور الإثبات) على HTTP
 * ------------------------------------------------------------
 *  ١) presign بيتحقق من النوع والامتداد، وبيرجّع 503 بوضوح
 *     لو R2 مش متضبط (باقي السيستم يفضل شغّال).
 *  ٢) تسجيل مفتاح مرفق → بيتربط بالشحنة، وآمن للتكرار.
 *  ٣) القائمة بترجّع المرفقات (روابط العرض null بدون R2).
 *  ٤) التسليم بصورة/توقيع → بيتسجّلوا مرفقات تلقائيًا.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-attachments.ts
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
  const r2 = Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب المرفقات',${"courier_att_" + stamp},'x','courier',false)`;

    console.log("\n═══ مرفقات الشحنة — صور الإثبات ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-ATT-${stamp % 100000}`, nameAr: "تاجر المرفقات", tier: "t1" })).json.merchant.id;
    const shipId = (await api("POST", "/api/v1/shipments", {
      merchantId, recipientName: "ع", recipientPhone: "01012345678",
      governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true,
    })).json.id as string;

    // ─── ١) presign ───
    check("٢) presign بنوع مرفق مجهول → مرفوض 400", (await api("POST", `/api/v1/shipments/${shipId}/attachments/presign`, { kind: "xxx", contentType: "image/jpeg" })).status, 400);
    check("   presign بنوع ملف مش صورة → مرفوض 400", (await api("POST", `/api/v1/shipments/${shipId}/attachments/presign`, { kind: "pod_photo", contentType: "application/pdf" })).status, 400);
    const presign = await api("POST", `/api/v1/shipments/${shipId}/attachments/presign`, { kind: "pod_photo", contentType: "image/jpeg" });
    if (r2) {
      check("٣) presign بيرجّع رابط رفع (R2 متضبط)", presign.status, 200);
      check("   الرابط فيه المفتاح", typeof presign.json.uploadUrl === "string" && presign.json.uploadUrl.length > 0, true);
    } else {
      check("٣) presign بيرجّع 503 بوضوح (R2 مش متضبط)", presign.status, 503);
      check("   الرسالة بتوضّح إن R2 محتاج مفاتيح", String(presign.json.error?.message).includes("R2"), true);
    }

    // ─── ٢) تسجيل مفتاح ───
    const key1 = `shipments/${shipId}/pod_photo/${crypto.randomUUID()}.jpg`;
    const rec = await api("POST", `/api/v1/shipments/${shipId}/attachments`, { kind: "pod_photo", key: key1, sizeBytes: 12345 });
    check("٤) تسجيل مرفق بالمفتاح → 201", rec.status, 201);
    check("   نفس المفتاح تاني → 200 (آمن للتكرار)", (await api("POST", `/api/v1/shipments/${shipId}/attachments`, { kind: "pod_photo", key: key1 })).json.alreadyExists, true);
    check("   تسجيل بنوع مجهول → مرفوض 400", (await api("POST", `/api/v1/shipments/${shipId}/attachments`, { kind: "zzz", key: "shipments/x/zzz/a.jpg" })).status, 400);

    // ─── ٣) القائمة ───
    const list1 = await api("GET", `/api/v1/shipments/${shipId}/attachments`);
    check("٥) القائمة بترجّع المرفق", list1.json.count, 1);
    check("   نوع المرفق pod_photo", (list1.json.attachments as Array<Record<string, unknown>>)[0]?.kind, "pod_photo");
    check(`   رابط العرض ${r2 ? "موجود" : "null (بدون R2)"}`, (list1.json.attachments as Array<Record<string, unknown>>)[0]?.viewUrl ? "موجود" : "null (بدون R2)", r2 ? "موجود" : "null (بدون R2)");

    // ─── ٤) الربط بالتسليم ───
    const tr = (b: unknown) => api("POST", `/api/v1/shipments/${shipId}/transitions`, b);
    await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-3333-4000-8000-000000000009", courierId: COURIER });
    await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
    await tr({ to: "out_for_delivery", runSheetId: "ffffffff-3333-4000-8000-000000000009", courierId: COURIER });
    const podKey = `shipments/${shipId}/pod_photo/${crypto.randomUUID()}.jpg`;
    const sigKey = `shipments/${shipId}/signature/${crypto.randomUUID()}.png`;
    const delivered = await tr({ to: "delivered", expectedCourierId: COURIER, cod: { collected: "500", method: "cash" }, photoUrl: podKey, signatureUrl: sigKey });
    check("٦) التسليم بصورة وتوقيع نجح", delivered.status, 201);

    // ─── ٥) رفع صورة عبر السيرفر (بدون CORS) ───
    async function uploadImg(kind: string) {
      const res = await fetch(`${BASE}/api/v1/shipments/${shipId}/attachments/upload?kind=${kind}`, {
        method: "POST", headers: { "content-type": "image/jpeg", ...(cookie ? { cookie } : {}) },
        body: new Uint8Array([255, 216, 255, 0, 1, 2, 3]),
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    }
    if (r2) {
      check("٧) رفع صورة عبر السيرفر → 201 (R2 متضبط)", (await uploadImg("pod_photo")).status, 201);
    } else {
      check("٧) رفع صورة → 503 بوضوح (R2 مش متضبط)", (await uploadImg("pod_photo")).status, 503);
    }
    check("   رفع بنوع مجهول → مرفوض 400", (await uploadImg("nope")).status, 400);

    const [counts] = await sql<{ pod: string; sig: string }[]>`
      SELECT
        COUNT(*) FILTER (WHERE kind='pod_photo')::text AS pod,
        COUNT(*) FILTER (WHERE kind='signature')::text AS sig
      FROM shipment_attachments WHERE shipment_id = ${shipId}::uuid`;
    check("   اتسجّلت صورتين إثبات (اليدوية + التسليم)", counts!.pod, "2");
    check("   اتسجّل توقيع من التسليم", counts!.sig, "1");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المرفقات نجحت (${pass})${r2 ? "" : " — R2 مش متضبط محليًا (الرفع الحي محتاج مفاتيح)"}` : `❌ ${fail} فشل · ${pass} نجح`);
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
