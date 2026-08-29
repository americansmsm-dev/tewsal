/**
 * اختبار أدوات التشغيل الداخلي (مرحلة هـ): تاسكات + تذاكر + مصروفات.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-ops.ts
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
  try {
    console.log("\n═══ أدوات التشغيل الداخلي (مرحلة هـ) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

    // ─── تاسكات ───
    console.log("  ── التاسكات ──");
    const task = await api("POST", "/api/v1/tasks", { title: "اتصل بالتاجر", priority: "high" });
    check("٢) إنشاء تاسك → 201", task.status, 201);
    const taskId = task.json.id;
    const tasks = (await api("GET", "/api/v1/tasks?status=open")).json.tasks as Record<string, unknown>[];
    check("   التاسك ظهر في المفتوحة", tasks.some((t) => t.id === taskId), true);
    check("٣) إقفال التاسك → done", (await api("POST", `/api/v1/tasks/${taskId}`, { status: "done" })).status, 200);

    // ─── تذاكر ───
    console.log("  ── التذاكر ──");
    const tk = await api("POST", "/api/v1/tickets", { category: "complaint", subject: "شكوى تأخير", priority: "high", body: "الشحنة متأخرة" });
    check("٤) إنشاء تذكرة → 201", tk.status, 201);
    const tkId = tk.json.id;
    check("   إضافة رد", (await api("POST", `/api/v1/tickets/${tkId}`, { action: "message", body: "بنتابع" })).status, 200);
    const thread = (await api("GET", `/api/v1/tickets/${tkId}`)).json.thread as unknown[];
    check("   السلسلة فيها رسالتين (الأصل + الرد)", thread.length, 2);
    check("٥) حلّ التذكرة", (await api("POST", `/api/v1/tickets/${tkId}`, { action: "update", status: "resolved" })).status, 200);
    const [tkRow] = await sql<{ status: string; resolved: boolean }[]>`SELECT status, (resolved_at IS NOT NULL) AS resolved FROM tickets WHERE id = ${tkId}::uuid`;
    check("   الحالة resolved ووقت الحل اتسجّل", `${tkRow!.status}/${tkRow!.resolved}`, "resolved/true");

    // ─── مصروفات ───
    console.log("  ── المصروفات ──");
    const [cat] = await sql<{ id: string }[]>`SELECT id::text FROM expense_categories WHERE code = 'FUEL'`;
    const exp = await api("POST", "/api/v1/expenses", { categoryId: cat!.id, amount: "250", description: "بنزين موتوسيكل", paidFrom: "branch_cash" });
    check("٦) تسجيل مصروف بنزين ٢٥٠ ج → 201", exp.status, 201);
    const expId = exp.json.id;
    // القيد: مدين FLEET_EXPENSE / دائن BRANCH_CASH — متوازن
    const [je] = await sql<{ d: string; c: string; fleet: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS d, COALESCE(SUM(jl.credit_p),0)::text AS c,
             COALESCE(SUM(jl.debit_p) FILTER (WHERE a.code='FLEET_EXPENSE'),0)::text AS fleet
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id JOIN accounts a ON a.id=jl.account_id
      WHERE je.source_type='manual' AND je.source_id=${expId}::uuid AND je.kind='expense'`;
    check("٧) قيد المصروف متوازن", je!.d, je!.c);
    check("   مدين حساب الأسطول ٢٥٠ ج", je!.fleet, "25000");
    check("   المصروف ظهر في القائمة", ((await api("GET", "/api/v1/expenses")).json.expenses as Record<string, unknown>[]).some((e) => e.id === expId), true);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات التشغيل الداخلي نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
