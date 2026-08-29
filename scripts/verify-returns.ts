/**
 * ============================================================
 *  اختبار دورة المرتجعات المفصّلة على HTTP
 * ------------------------------------------------------------
 *  ١) شحنة تعذّر تسليمها → تتحوّل للمرتجعات → تظهر في السجل
 *     تلقائيًا (enterReturns) بحالة «على الرف» وعمر ٠.
 *  ٢) تحطّها على رف → السجل يعرض الرف.
 *  ٣) الإتلاف قبل المدة مرفوض (TOO_EARLY) — إلا بتجاوز.
 *  ٤) تشييخ المرتجع (١٥ و٣١ يوم) → مستوى التصعيد ١ ثم ٢.
 *  ٥) الإتلاف بعد المدة → الشحنة disposed، قيد شحن متوازن،
 *     التاجر بقى مدين بالشحن، وبيانات الإتلاف اتسجّلت.
 *  ٦) الإتلاف تاني أو حطّ على رف بعد الإتلاف → مرفوض.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-returns.ts
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
  const C1 = crypto.randomUUID();
  const stamp = Date.now();

  // صافي مستحقات التاجر من الدفتر (دائن − مدين) — سالب يعني مدين علينا
  async function merchantPayable(merchant: string): Promise<bigint> {
    const [r] = await sql<{ b: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS b
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = 'MERCHANT_PAYABLE' AND a.owner_id = ${merchant}::uuid`;
    return BigInt(r!.b);
  }
  /** رجّع المرتجع لعمر معيّن (بنعدّل ساعة تغيير الحالة مباشرة) */
  async function ageShipment(shipmentId: string, days: number) {
    await sql`UPDATE shipments SET status_updated_at = now() - (${days} || ' days')::interval WHERE id = ${shipmentId}::uuid`;
  }
  async function findReturn(awb: string) {
    const r = await api("GET", "/api/v1/returns?filter=all");
    return (r.json.returns as Array<Record<string, unknown>>).find((x) => x.awb === awb);
  }

  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${C1}::uuid,'مندوب المرتجعات',${"courier_ret_" + stamp},'x','courier',false)`;

    console.log("\n═══ دورة المرتجعات المفصّلة ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-RET-${stamp % 100000}`, nameAr: "تاجر المرتجعات", tier: "t1" })).json.merchant.id;

    // شحنة → تعذّر → مرتجعات
    async function toReturns(): Promise<{ id: string; awb: string }> {
      const created = (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "500", confirm: true,
      })).json;
      const id = created.id as string;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-1111-4000-8000-000000000009", courierId: C1 });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-1111-4000-8000-000000000009", courierId: C1 });
      await tr({ to: "delivery_failed", reasonCode: "no_answer" });
      await tr({ to: "awaiting_return" });
      return { id, awb: created.awb as string };
    }

    // ─── ١) الدخول للمرتجعات بيسجّل تلقائيًا ───
    const s1 = await toReturns();
    const reg1 = await findReturn(s1.awb);
    check("٢) الشحنة ظهرت في سجل المرتجعات تلقائيًا", reg1 ? "موجودة" : "غايبة", "موجودة");
    check("   حالتها «على الرف» (awaiting_return)", reg1?.status, "awaiting_return");
    check("   عمرها ٠ ومستوى تصعيدها ٠", `${reg1?.ageDays}/${reg1?.escalationLevel}`, "0/0");
    check("   لسه من غير رف", reg1?.shelfId ?? "null", "null");

    // ─── ٢) تحطّها على رف ───
    const [shelf] = await sql<{ id: string; code: string }[]>`SELECT id::text, code FROM return_shelves ORDER BY code LIMIT 1`;
    check("٣) تحطّها على رف → نجاح", (await api("POST", `/api/v1/returns/${s1.id}/shelf`, { shelfId: shelf!.id })).status, 200);
    const reg2 = await findReturn(s1.awb);
    check("   السجل بيعرض كود الرف", reg2?.shelfCode, shelf!.code);

    // ─── ٣) الإتلاف قبل المدة مرفوض ───
    check("٤) إتلاف قبل المدة → مرفوض 422", (await api("POST", `/api/v1/returns/${s1.id}/dispose`, { reason: "بدري" })).status, 422);
    check("   الشحنة لسه على الرف (ما اتأتلفتش)", (await findReturn(s1.awb))?.status, "awaiting_return");

    // ─── ٤) التصعيد بالعمر ───
    await ageShipment(s1.id, 15);
    check("٥) بعد ١٥ يوم → مستوى تصعيد ١", (await findReturn(s1.awb))?.escalationLevel, 1);
    await ageShipment(s1.id, 31);
    check("   بعد ٣١ يوم → مستوى تصعيد ٢ (مؤهّل للإتلاف)", (await findReturn(s1.awb))?.escalationLevel, 2);

    // ─── ٥) الإتلاف بعد المدة ───
    const payableBefore = await merchantPayable(merchantId);
    const dispose = await api("POST", `/api/v1/returns/${s1.id}/dispose`, { reason: "التاجر مش بيرد بعد محاولات كتير" });
    check("٦) إتلاف بعد المدة → 201", dispose.status, 201);
    check("   الشحنة بقت disposed", (await findReturn(s1.awb))?.status, "disposed");

    // قيد الإتلاف: شحن ٩٠ ج (cairo_giza t1)
    const [entry] = await sql<{ debit: string; credit: string; cnt: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit, COUNT(*)::text AS cnt
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_type = 'shipment' AND je.source_id = ${s1.id}::uuid AND je.kind = 'disposal'`;
    check("٧) قيد الإتلاف متوازن", entry!.debit, entry!.credit);
    check("   الشحن المحتسب ٩٠ ج", entry!.debit, "9000");
    check("   التاجر بقى مدين بالشحن (نقص ٩٠ ج)", (payableBefore - (await merchantPayable(merchantId))).toString(), "9000");

    // بيانات الإتلاف اتسجّلت
    const [ret] = await sql<{ disposed: boolean; reason: string; by: string | null }[]>`
      SELECT (disposed_at IS NOT NULL) AS disposed, disposal_reason AS reason, disposal_approved_by::text AS by
      FROM returns WHERE shipment_id = ${s1.id}::uuid`;
    check("٨) وقت الإتلاف اتسجّل", ret!.disposed, true);
    check("   سبب الإتلاف اتسجّل", ret!.reason?.includes("مش بيرد"), true);
    check("   الموافق اتسجّل", ret!.by ? "موجود" : "غايب", "موجود");

    // ─── ٦) بعد الإتلاف مفيش رجوع ───
    check("٩) إتلاف تاني → مرفوض 422", (await api("POST", `/api/v1/returns/${s1.id}/dispose`, { reason: "تاني" })).status, 422);
    check("   حطّ على رف بعد الإتلاف → مرفوض 422", (await api("POST", `/api/v1/returns/${s1.id}/shelf`, { shelfId: shelf!.id })).status, 422);

    // ─── ٧) التجاوز الصريح للمدة ───
    const s2 = await toReturns();
    const over = await api("POST", `/api/v1/returns/${s2.id}/dispose`, { reason: "بضاعة تالفة خطر", overrideAge: true });
    check("١٠) إتلاف بتجاوز المدة (عمر ٠) → 201", over.status, 201);
    check("    الشحنة بقت disposed بالتجاوز", (await findReturn(s2.awb))?.status, "disposed");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المرتجعات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
