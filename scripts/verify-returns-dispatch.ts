/**
 * ============================================================
 *  اختبار تحميل المرتجعات على المناديب + عمولة المرتجع
 * ------------------------------------------------------------
 *  ١) تحميل دفعة مرتجعات على مندوب بنداء واحد → كشف مرتجعات
 *     (type='return') وكل الشحنات out_for_return على نفس المندوب.
 *  ٢) الثغرة اتقفلت: مستحيل تحمّل على حد مش مندوب.
 *  ٣) المرتجع بيظهر في تطبيق المندوب (بجلسة المندوب).
 *  ٤) تأكيد الإرجاع → returned_to_merchant + قيد (شحن + رسم مرتجع).
 *  ٥) عمولة المرتجع بسعرها المنفصل، والتسليم بسعره.
 *
 *  DATABASE_URL=... BASE=http://127.0.0.1:3100 \
 *    npx tsx scripts/verify-returns-dispatch.ts
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
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    const admin = client();

    console.log("\n═══ تحميل المرتجعات على المناديب ═══\n");
    check("١) دخول المدير", (await admin("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // مندوب بحساب دخول حقيقي (عشان نتأكد إنه شايفهم في تطبيقه)
    const cUser = `courier_rd_${stamp % 100000}`;
    const cRes = await admin("POST", "/api/v1/users", {
      // ⚠️ padStart ضروري — من غيره الرقم بيطلع ١٠ خانات أحيانًا
      //    (على حسب الوقت) فالتحقق يرفضه والاختبار يفشل بالمزاج
      fullName: "مندوب المرتجعات", username: cUser,
      phone: `0100${String(stamp % 10000000).padStart(7, "0")}`,
      password: "Courier12345", role: "courier",
    });
    check("   إنشاء مندوب → 201", cRes.status, 201);
    const courierId = (cRes.json.user?.id ?? cRes.json.id) as string;

    // مستخدم مش مندوب (للفحص السلبي)
    const dRes = await admin("POST", "/api/v1/users", {
      fullName: "مدخل بيانات", username: `de_rd_${stamp % 100000}`,
      phone: `0101${String(stamp % 10000000).padStart(7, "0")}`,
      password: "Data12345678", role: "data_entry",
    });
    const nonCourierId = (dRes.json.user?.id ?? dRes.json.id) as string;

    const mRes = await admin("POST", "/api/v1/merchants", {
      code: `M-RD-${stamp % 100000}`, nameAr: "تاجر المرتجعات", tier: "t1",
    });
    const merchantId = mRes.json.merchant.id as string;

    // ٣ شحنات توصل لحالة «بانتظار الإرجاع»
    async function toAwaitingReturn(): Promise<{ id: string; awb: string }> {
      const c = await admin("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true,
      });
      const id = c.json.id as string;
      const tr = (b: unknown) => admin("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-9999-4000-8000-000000000009", courierId });
      await tr({ to: "picked_up" });
      await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-9999-4000-8000-000000000009", courierId });
      await tr({ to: "delivery_failed", reasonCode: "no_answer" });
      await tr({ to: "awaiting_return" });
      return { id, awb: c.json.awb as string };
    }
    const r1 = await toAwaitingReturn();
    const r2 = await toAwaitingReturn();
    const r3 = await toAwaitingReturn();
    const ids = [r1.id, r2.id, r3.id];

    // ─── الفحوصات السلبية قبل التحميل ───
    console.log("  ── الفحوصات السلبية ──");
    const bad1 = await admin("POST", "/api/v1/returns/dispatch", { courierId: nonCourierId, shipmentIds: ids });
    check("٢) التحميل على حد مش مندوب → 422", bad1.status, 422);
    check("   بكود NOT_COURIER", bad1.json.error?.code, "NOT_COURIER");
    const bad2 = await admin("POST", "/api/v1/returns/dispatch", { courierId, shipmentIds: [] });
    check("٣) من غير مرتجعات → 400", bad2.status, 400);

    // ─── التحميل ───
    console.log("  ── التحميل ──");
    const disp = await admin("POST", "/api/v1/returns/dispatch", { courierId, shipmentIds: ids });
    check("٤) تحميل ٣ مرتجعات بنداء واحد → 201", disp.status, 201);
    check("   اتحمّل ٣", disp.json.dispatched, 3);
    const sheetCode = disp.json.code as string;
    check("   كود كشف مرتجعات RRS", sheetCode?.startsWith("RRS-"), true);

    const sheet = await sql<{ type: string; status: string; shipments_count: number; courier_id: string }[]>`
      SELECT type, status, shipments_count, courier_id::text FROM run_sheets WHERE code = ${sheetCode}`;
    check("٥) الكشف نوعه return", sheet[0]?.type, "return");
    check("   حالته dispatched وعدده ٣", `${sheet[0]?.status}/${sheet[0]?.shipments_count}`, "dispatched/3");
    check("   مسند للمندوب الصح", sheet[0]?.courier_id, courierId);

    const ship = await sql<{ status: string; current_courier_id: string }[]>`
      SELECT status, current_courier_id::text FROM shipments WHERE id = ANY(${ids}::uuid[])`;
    check("٦) الـ٣ بقوا out_for_return", ship.filter((s) => s.status === "out_for_return").length, 3);
    check("   وكلهم على نفس المندوب", ship.filter((s) => s.current_courier_id === courierId).length, 3);

    const items = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM run_sheet_items rsi
      JOIN run_sheets rs ON rs.id = rsi.run_sheet_id WHERE rs.code = ${sheetCode}`;
    check("   ٣ بنود على الكشف", items[0]!.n, 3);

    // إعادة التحميل مرفوضة (مبقوش awaiting_return)
    const again = await admin("POST", "/api/v1/returns/dispatch", { courierId, shipmentIds: [r1.id] });
    check("٧) إعادة تحميل مرتجع خرج بالفعل → 422", again.status, 422);

    // ─── المندوب بيشوفهم في تطبيقه ───
    console.log("  ── تطبيق المندوب ──");
    const courier = client();
    check("٨) دخول المندوب", (await courier("POST", "/api/v1/auth/login", { username: cUser, password: "Courier12345" })).status, 200);
    const tasks = await courier("GET", "/api/v1/shipments?status=out_for_return&limit=50");
    const mine = (tasks.json.shipments as Array<{ id: string }>) ?? [];
    check("   المندوب شايف الـ٣ مرتجعات", mine.filter((s) => ids.includes(s.id)).length, 3);

    // ─── تأكيد الإرجاع ───
    console.log("  ── تأكيد الإرجاع ──");
    const payableSql = sql<{ v: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS v
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code='MERCHANT_PAYABLE' AND a.owner_id = ${merchantId}::uuid`;
    const payableBefore = (await payableSql)[0]!.v;

    const conf = await courier("POST", `/api/v1/shipments/${r1.id}/transitions`, {
      to: "returned_to_merchant", receiverName: "أمين مخزن التاجر", signatureUrl: "returns/sig-test.png",
    });
    check("٩) تأكيد الإرجاع بتوقيع → 201", conf.status, 201);
    const st1 = await sql<{ status: string }[]>`SELECT status FROM shipments WHERE id = ${r1.id}::uuid`;
    check("   الحالة بقت returned_to_merchant", st1[0]?.status, "returned_to_merchant");

    const payableAfter = (await sql<{ v: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS v
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code='MERCHANT_PAYABLE' AND a.owner_id = ${merchantId}::uuid`)[0]!.v;
    const delta = BigInt(payableBefore) - BigInt(payableAfter);
    check("١٠) اتخصم من التاجر شحن + رسم مرتجع", delta > 0n, true);
    const retEntry = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM journal_entries
      WHERE source_type='shipment' AND source_id=${r1.id}::uuid AND kind='return'`;
    check("   قيد المرتجع اتسجّل", retEntry[0]!.n, 1);

    // ─── عمولة المرتجع بسعر منفصل ───
    console.log("  ── عمولة المرتجع ──");
    const pend = await admin("GET", `/api/v1/courier-commissions?courierId=${courierId}`);
    const orders = (pend.json.orders as Array<{ id: string; kind: string }>) ?? [];
    const retOrder = orders.find((o) => o.id === r1.id);
    check("١١) المرتجع ظهر للمحاسب بنوع return", retOrder?.kind, "return");
    check("   سعر المرتجع المقترح ٢٥ ج", pend.json.suggestedReturnRate, "25.00 ج");
    check("   سعر التسليم المقترح ٥٠ ج", pend.json.suggestedRate, "50.00 ج");

    const rec = await admin("POST", "/api/v1/courier-commissions", {
      courierId, shipmentIds: [r1.id], amountPerOrder: "50", amountPerReturn: "25",
    });
    check("١٢) تسجيل العمولة → 201", rec.status, 201);
    check("   اتحسبت كمرتجع (٢٥ ج)", rec.json.total, "25.00 ج");
    check("   العدّ: ٠ تسليم و١ مرتجع", `${rec.json.deliveries}/${rec.json.returns}`, "0/1");
    const item = await sql<{ amount_p: string }[]>`
      SELECT amount_p::text FROM courier_commission_items WHERE shipment_id = ${r1.id}::uuid`;
    check("   بند العمولة اتسجّل بـ٢٥ ج", item[0]?.amount_p, "2500");

    console.log("\n" + "─".repeat(52));
    console.log(fail === 0 ? `✅ كل فحوصات تحميل المرتجعات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(52) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await sql.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
