/**
 * ============================================================
 *  اختبار المطالبات والتعويض على HTTP
 * ------------------------------------------------------------
 *  ١) شحنة عادية → lost → مطالبة تتفتح تلقائيًا → اعتماد →
 *     تعويض بحد min(المعلنة, ٦٠٠ج). المعلنة ١٠٠٠ → التعويض ٦٠٠.
 *  ٢) شحنة قابلة للكسر ومش مؤمّنة → lost → الاعتماد **محظور**
 *     إلا بتجاوز من super_admin.
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-claim.ts
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
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
    console.log("\n═══ المطالبات والتعويض ═══\n");
    check("١) دخول (super_admin)", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    const merchantId = (await api("POST", "/api/v1/merchants", {
      code: `M-CLM-${stamp % 100000}`, nameAr: "تاجر المطالبات", tier: "t1",
    })).json.merchant.id;

    async function makeShipment(declaredP: bigint, fragile: boolean, insured: boolean): Promise<string> {
      const s = await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", confirm: true,
      });
      const id = s.json.id as string;
      // نضبط القيمة المعلنة وحالة القابل للكسر مباشرة (حقول الشحنة قابلة للتعديل)
      await sql`UPDATE shipments SET declared_value_p = ${declaredP.toString()}::bigint,
        is_fragile = ${fragile}, fragile_insured = ${insured} WHERE id = ${id}::uuid`;
      return id;
    }

    // ─── ١) شحنة عادية: معلنة ١٠٠٠ ج، تعويض محدود بـ ٦٠٠ ───
    const ship1 = await makeShipment(100000n, false, false);
    const lost1 = await api("POST", `/api/v1/shipments/${ship1}/transitions`, { to: "lost", note: "اتفقدت في النقل" });
    check("٢) الشحنة بقت lost", lost1.json.to, "lost");
    check("   مطالبة اتفتحت تلقائيًا", !!lost1.json.claimId, true);
    const claim1 = lost1.json.claimId as string;

    const [c1] = await sql<{ status: string; suggested: string }[]>`
      SELECT status, suggested_amount_p::text AS suggested FROM claims WHERE id = ${claim1}::uuid`;
    check("   حالة المطالبة open", c1!.status, "open");
    check("   التعويض المقترح ٦٠٠ ج (محدود، مش ١٠٠٠)", c1!.suggested, "60000");

    const res1 = await api("POST", `/api/v1/claims/${claim1}/resolve`, { decision: "approve" });
    check("٣) اعتماد → معتمد", res1.json.status, "approved");
    check("   التعويض المعتمد ٦٠٠ ج", res1.json.approved, "600.00 ج");

    // القيد متوازن ونوعه compensation على المطالبة
    const [e1] = await sql<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_id = ${claim1}::uuid AND je.kind = 'compensation'`;
    check("٤) قيد التعويض متوازن", e1!.debit, e1!.credit);
    check("   إجمالي القيد ٦٠٠ ج", e1!.debit, "60000");

    // اعتماد تاني مرفوض (اتحلّت بالفعل)
    check("   إعادة الاعتماد مرفوضة", (await api("POST", `/api/v1/claims/${claim1}/resolve`, { decision: "approve" })).status, 422);

    // ─── ٢) شحنة قابلة للكسر ومش مؤمّنة: محظورة إلا بتجاوز ───
    const ship2 = await makeShipment(50000n, true, false);
    const lost2 = await api("POST", `/api/v1/shipments/${ship2}/transitions`, { to: "lost", note: "اتكسرت" });
    const claim2 = lost2.json.claimId as string;
    const [c2] = await sql<{ blocked: boolean }[]>`SELECT fragile_blocked AS blocked FROM claims WHERE id = ${claim2}::uuid`;
    check("٥) مطالبة القابل للكسر محظورة", c2!.blocked, true);

    const blocked = await api("POST", `/api/v1/claims/${claim2}/resolve`, { decision: "approve" });
    check("   اعتماد بدون تجاوز → مرفوض 422", blocked.status, 422);

    const override = await api("POST", `/api/v1/claims/${claim2}/resolve`, { decision: "approve", overrideFragile: true });
    check("٦) اعتماد بتجاوز super_admin → معتمد", override.json.status, "approved");
    check("   التعويض ٥٠٠ ج (المعلنة أقل من الحد)", override.json.approved, "500.00 ج");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المطالبات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
