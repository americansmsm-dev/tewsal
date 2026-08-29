/**
 * ============================================================
 *  اختبار الإيداع البنكي + خصومات المناديب على HTTP
 * ------------------------------------------------------------
 *  ١) مندوب يسلّم كاش → خزنة الفرع → إيداع بنكي:
 *     خزنة الفرع تنقص، البنك يزيد، ومستحيل تودّع أكتر من الرصيد.
 *  ٢) عجز في تسليم العهدة → خصم على المندوب (pending) + ذمة،
 *     والإعفاء بيصفّي الذمة (كتابة الخسارة على الشركة).
 *
 *  BASE=http://127.0.0.1:3100 npx tsx scripts/verify-bank-deposit.ts
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
  const C1 = crypto.randomUUID(), C2 = crypto.randomUUID();
  const stamp = Date.now();
  async function receivable(courier: string): Promise<string> {
    const [r] = await sql<{ b: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS b
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = 'COURIER_RECEIVABLE' AND a.owner_id = ${courier}::uuid`;
    return r!.b;
  }
  // رصيد خزنة الفرع الرئيسي (مشترك ومتراكم — بنقيس الفرق مش قيمة مطلقة)
  async function branchCash(): Promise<bigint> {
    const [r] = await sql<{ b: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p - jl.credit_p),0)::text AS b
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      JOIN branches br ON br.id = a.owner_id AND br.code = 'MAIN'
      WHERE a.code = 'BRANCH_CASH'`;
    return BigInt(r!.b);
  }
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    for (const [id, n] of [[C1, "courier_bd1_"], [C2, "courier_bd2_"]] as const) {
      await sql`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
        VALUES (${id}::uuid,'مندوب الإيداع',${n + stamp},'x','courier',false)`;
    }
    console.log("\n═══ الإيداع البنكي + خصومات المناديب ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-BD-${stamp % 100000}`, nameAr: "تاجر الإيداع", tier: "t1" })).json.merchant.id;

    async function deliver(courier: string, cod: string) {
      const id = (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: cod, confirm: true,
      })).json.id as string;
      const tr = (b: unknown) => api("POST", `/api/v1/shipments/${id}/transitions`, b);
      await tr({ to: "pickup_assigned", pickupId: "eeeeeeee-1111-4000-8000-000000000009", courierId: courier });
      await tr({ to: "picked_up" }); await tr({ to: "at_hub" });
      await tr({ to: "out_for_delivery", runSheetId: "ffffffff-1111-4000-8000-000000000009", courierId: courier });
      await tr({ to: "delivered", expectedCourierId: courier, cod: { collected: cod, method: "cash" } });
    }

    // ─── ١) إيداع بنكي (بنقيس الفرق عشان الخزنة مشتركة) ───
    await deliver(C1, "1000");
    check("٢) المندوب سلّم كاش (تسليم عهدة) → 201", (await api("POST", "/api/v1/handovers", { courierId: C1, received: "1000" })).status, 201);

    const before = await branchCash();
    const dep = await api("POST", "/api/v1/bank-deposits", { amount: "600" });
    check("٣) إيداع بنكي ٦٠٠ → 201", dep.status, 201);
    check("   خزنة الفرع نقصت ٦٠٠ ج بالظبط", (before - (await branchCash())).toString(), "60000");

    const [e] = await sql<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS debit, COALESCE(SUM(jl.credit_p),0)::text AS credit
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.source_id = ${dep.json.depositId}::uuid AND je.kind = 'bank_deposit'`;
    check("٤) قيد الإيداع متوازن", e!.debit, e!.credit);
    check("   إجمالي الإيداع ٦٠٠ ج", e!.debit, "60000");

    // إيداع أكبر من كامل رصيد الخزنة → مرفوض
    const over = (Number(await branchCash()) / 100 + 500).toFixed(2);
    check("٥) إيداع أكبر من الرصيد → مرفوض 422", (await api("POST", "/api/v1/bank-deposits", { amount: over })).status, 422);

    // ─── ٢) عجز → خصم → إعفاء ───
    await deliver(C2, "1000");
    check("٦) تسليم عهدة بعجز ١٠٠ (سلّم ٩٠٠) → 201", (await api("POST", "/api/v1/handovers", { courierId: C2, received: "900", varianceNote: "عجز اختبار" })).status, 201);
    check("   ذمة على المندوب ١٠٠ ج", await receivable(C2), "10000");

    const [ded] = await sql<{ id: string; status: string; amount_p: string }[]>`
      SELECT id::text, status, amount_p::text FROM courier_deductions WHERE courier_id = ${C2}::uuid ORDER BY created_at DESC LIMIT 1`;
    check("٧) خصم اتسجّل (pending) بـ ١٠٠ ج", `${ded!.status}/${ded!.amount_p}`, "pending/10000");

    const waive = await api("POST", `/api/v1/deductions/${ded!.id}/waive`);
    check("٨) إعفاء الخصم → waived", waive.json.status, "waived");
    check("   الذمة اتصفّرت بعد الإعفاء", await receivable(C2), "0");
    check("   إعادة الإعفاء مرفوضة", (await api("POST", `/api/v1/deductions/${ded!.id}/waive`)).status, 422);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الإيداع والخصومات نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
