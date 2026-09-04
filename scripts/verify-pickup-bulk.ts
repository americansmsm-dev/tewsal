/**
 * verify-pickup-bulk — الاستلام الجماعي: أوردرات تاجر على مندوب واحد بنداء واحد.
 *
 * بيثبت: (١) الرفض بيرجّع كل حاجة زي ما كانت (ذرّية) · (٢) النداء الواحد
 * بيحط الـ٥ أوردرات كلهم pickup_assigned بنفس المندوب ونفس الاستلام ·
 * (٣) التاجر ميقدرش يسند مندوب لنفسه · (٤) المسار القديم للتاجر ماتغيّرش.
 */
import postgres from "postgres";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const c = postgres(DB, { max: 1 });

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`); }
}

let cookie = "";
async function api(m: string, p: string, b?: unknown) {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const sc = r.headers.getSetCookie?.() ?? [];
  const s = sc.find((x) => x.startsWith("tewsal_session="));
  if (s) cookie = s.split(";")[0] ?? "";
  return { status: r.status, json: (await r.json().catch(() => null)) as never };
}
const j = (o: unknown) => JSON.stringify(o).slice(0, 160);

async function main() {
  console.log("\n═══ الاستلام الجماعي — أوردرات تاجر على مندوب واحد ═══\n");

  // ── إعداد ──
  const login = await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" });
  check("١) دخول الأدمن", login.status === 200);
  // معرّف مستخدم **مش مندوب** — للفحص السلبي (بناخده من القاعدة مضمون)
  const [adminRow] = await c`SELECT id::text FROM users WHERE role = 'super_admin' AND is_active = true LIMIT 1`;
  const adminId = adminRow!.id as string;

  const stamp = Date.now();
  const mUser = `mbulk_${stamp}`;
  const mk = await api("POST", "/api/v1/merchants", {
    code: `M-BULK-${stamp}`, nameAr: "تاجر الاستلام الجماعي",
    loginUsername: mUser, loginPassword: "LongPass123",
  });
  const merchantId = (mk.json as { merchant?: { id?: string } })?.merchant?.id as string;
  check("٢) اتعمل تاجر بحساب دخول", mk.status === 201 && !!merchantId, j(mk.json));
  await c`UPDATE merchants SET pickup_address = 'مخزن التاجر — مدينة نصر' WHERE id = ${merchantId}::uuid`;

  const cUser = `cbulk_${stamp}`;
  const cr = await api("POST", "/api/v1/users", { fullName: "مندوب الجماعي", username: cUser, role: "courier", password: "LongPass123" });
  const courierId = (cr.json as { user?: { id?: string } })?.user?.id as string;
  check("٣) اتعمل مندوب", cr.status === 201 && !!courierId);

  // مندوب موقوف — للفحص السلبي
  const offUser = `coff_${stamp}`;
  const off = await api("POST", "/api/v1/users", { fullName: "مندوب موقوف", username: offUser, role: "courier", password: "LongPass123" });
  const offId = (off.json as { user?: { id?: string } })?.user?.id as string;
  await c`UPDATE users SET is_active = false WHERE id = ${offId}::uuid`;

  // ٥ أوردرات
  const [gov] = await c`SELECT governorate_id FROM shipments WHERE cod_amount_p > 0 ORDER BY created_at DESC LIMIT 1`;
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = await api("POST", "/api/v1/shipments", {
      merchantId, governorateId: gov!.governorate_id, recipientName: `عميل ${i + 1}`,
      recipientPhone: "01012345678", addressLine: "عنوان", codAmount: "500.00", confirm: true,
    });
    const id = (s.json as { id?: string })?.id;
    if (id) ids.push(id);
  }
  await c`UPDATE shipments SET status = 'awaiting_pickup' WHERE id = ANY(${ids}::uuid[])`;
  check("٤) اتعمل ٥ أوردرات في انتظار الاستلام", ids.length === 5, `${ids.length}`);

  // ── المرشّحون ──
  const cand = await api("GET", `/api/v1/pickups/candidates?merchantId=${merchantId}`);
  const cj = cand.json as { shipments?: unknown[]; blocked?: unknown[]; merchant?: { pickup_address?: string }; freeThreshold?: number };
  check("٥) المرشّحون: ٥ أوردرات جاهزة", cand.status === 200 && cj.shipments?.length === 5, `${cj.shipments?.length}`);
  check("   العنوان المحفوظ بيرجع للتعبئة التلقائية", !!cj.merchant?.pickup_address);

  // ── فحوصات الرفض (ذرّية) ──
  const bad1 = await api("POST", "/api/v1/pickups", { merchantId, shipmentIds: ids, pickupAddress: "مخزن", courierId: adminId });
  check("٦) مندوب بدور غلط → مرفوض", bad1.status === 422, `${bad1.status} ${j(bad1.json)}`);
  const bad2 = await api("POST", "/api/v1/pickups", { merchantId, shipmentIds: ids, pickupAddress: "مخزن", courierId: offId });
  check("   مندوب موقوف → مرفوض", bad2.status === 422, `${bad2.status}`);
  const [after] = await c`SELECT COUNT(*)::int n FROM pickups WHERE merchant_id = ${merchantId}::uuid`;
  const [still] = await c.unsafe(`SELECT COUNT(*)::int n FROM shipments WHERE id = ANY('{${ids.join(",")}}'::uuid[]) AND status='awaiting_pickup'`);
  check("   ⭐ بعد الرفض: مفيش استلام اتعمل والـ٥ زي ما هم", after!.n === 0 && still!.n === 5, `pickups=${after!.n} awaiting=${still!.n}`);

  // ── النداء الواحد ──
  const okr = await api("POST", "/api/v1/pickups", { merchantId, shipmentIds: ids, pickupAddress: "مخزن التاجر — مدينة نصر", courierId });
  const oj = okr.json as { pickupId?: string; ordersCount?: number; status?: string; assigned?: number; serviceFee?: string };
  check("٧) نداء واحد: استلام + إسناد", okr.status === 201 && oj.status === "assigned" && oj.assigned === 5, `${okr.status} ${j(oj)}`);
  check("   الرسم مجاني عند ٥", !!oj.serviceFee?.startsWith("0"), oj.serviceFee);

  const pid = oj.pickupId!;
  const [prow] = await c`SELECT status, courier_id::text, orders_count FROM pickups WHERE id = ${pid}::uuid`;
  check("٨) صف الاستلام: assigned + نفس المندوب + ٥", prow!.status === "assigned" && prow!.courier_id === courierId && prow!.orders_count === 5);
  const [links] = await c`SELECT COUNT(*)::int n FROM pickup_shipments WHERE pickup_id = ${pid}::uuid`;
  check("   ٥ روابط في pickup_shipments", links!.n === 5, `${links!.n}`);

  const [agg] = await c.unsafe(`
    SELECT COUNT(*) FILTER (WHERE status='pickup_assigned')::int n,
           COUNT(DISTINCT current_courier_id)::int couriers,
           COUNT(DISTINCT current_pickup_id)::int pickups
    FROM shipments WHERE id = ANY('{${ids.join(",")}}'::uuid[])`);
  check("٩) ⭐ الـ٥ كلهم pickup_assigned بنفس المندوب ونفس الاستلام",
    agg!.n === 5 && agg!.couriers === 1 && agg!.pickups === 1,
    `assigned=${agg!.n} couriers=${agg!.couriers} pickups=${agg!.pickups}`);

  const [hist] = await c.unsafe(`SELECT COUNT(*)::int n FROM shipment_status_history WHERE shipment_id = ANY('{${ids.join(",")}}'::uuid[]) AND to_status='pickup_assigned'`);
  check("   عدّوا من بوابة الحالات (٥ سطور تاريخ)", hist!.n === 5, `${hist!.n}`);
  const [je] = await c`SELECT COUNT(*)::int n FROM journal_entries WHERE source_id = ${pid}::uuid`;
  check("   مفيش قيد مالي عند الإسناد", je!.n === 0);

  // ── التاجر ميسندش مندوب ──
  cookie = "";
  await api("POST", "/api/v1/auth/login", { username: mUser, password: "LongPass123" });
  const selfAssign = await api("POST", "/api/v1/pickups", { merchantId, shipmentIds: ids, pickupAddress: "مخزن", courierId });
  check("١٠) التاجر ميقدرش يسند مندوب → ٤٠٣", selfAssign.status === 403, `${selfAssign.status}`);

  console.log(`\n${"─".repeat(50)}\n${fail === 0 ? "✅" : "❌"} ${pass} نجح · ${fail} فشل\n${"─".repeat(50)}`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
