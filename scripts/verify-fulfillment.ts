/**
 * اختبار تخزين التجار (مرحلة ز): منتجات + مخزون + سحب مع الشحن + رسم تخزين.
 * BASE=http://127.0.0.1:3100 npx tsx scripts/verify-fulfillment.ts
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
  const stamp = Date.now();
  try {
    const [gov] = await sql<{ id: string }[]>`SELECT id FROM governorates WHERE code='CAI'`;
    async function payable(m: string): Promise<bigint> {
      const [r] = await sql<{ b: string }[]>`
        SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS b FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
        WHERE a.code='MERCHANT_PAYABLE' AND a.owner_id=${m}::uuid`;
      return BigInt(r!.b);
    }

    console.log("\n═══ تخزين التجار / فُلفيلمنت (مرحلة ز) ═══\n");
    check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);
    const merchantId = (await api("POST", "/api/v1/merchants", { code: `M-FUL-${stamp % 100000}`, nameAr: "تاجر التخزين", tier: "t1" })).json.merchant.id;

    // ─── منتجات + مخزون ───
    console.log("  ── المنتجات ──");
    const prod = await api("POST", `/api/v1/merchants/${merchantId}/products`, { sku: "SKU-A", nameAr: "تيشيرت", quantity: 5, price: "200" });
    check("٢) إنشاء منتج بكمية ٥ → 201", prod.status, 201);
    const pid = prod.json.id;
    check("   الـ SKU المكرر → مرفوض 422", (await api("POST", `/api/v1/merchants/${merchantId}/products`, { sku: "SKU-A", nameAr: "تاني" })).status, 422);
    const products = (await api("GET", `/api/v1/merchants/${merchantId}/products`)).json.products as Record<string, unknown>[];
    check("   المنتج ظهر بكمية ٥", products.find((p) => p.id === pid)?.quantity, 5);

    // ─── سحب من المخزون وقت الشحن ───
    console.log("  ── السحب مع الشحن ──");
    async function ship(): Promise<number> {
      return (await api("POST", "/api/v1/shipments", {
        merchantId, recipientName: "ع", recipientPhone: "01012345678",
        governorateId: gov!.id, addressLine: "المعادي", codAmount: "200", productId: pid,
      })).status;
    }
    check("٣) شحنة بسحب منتج → 201 (الكمية تنقص)", await ship(), 201);
    const [after1] = await sql<{ q: number }[]>`SELECT quantity AS q FROM merchant_products WHERE id=${pid}::uuid`;
    check("   الكمية بقت ٤", after1!.q, 4);
    const [mv] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id=${pid}::uuid AND reason='shipment'`;
    check("   اتسجّلت حركة مخزون للشحنة", mv!.n, 1);

    // ─── تعديل مخزون يدوي ───
    console.log("  ── تعديل المخزون ──");
    check("٤) إضافة ١٠ للمخزون → ١٤", (await api("POST", `/api/v1/products/${pid}/stock`, { delta: 10 })).json.balance, 14);
    check("   خصم أكتر من الرصيد → مرفوض 422", (await api("POST", `/api/v1/products/${pid}/stock`, { delta: -100 })).status, 422);

    // ─── نفاد المخزون يمنع الشحن ───
    console.log("  ── نفاد المخزون ──");
    const prod2 = await api("POST", `/api/v1/merchants/${merchantId}/products`, { sku: "SKU-LOW", nameAr: "محدود", quantity: 1 });
    const pid2 = prod2.json.id;
    check("٥) أول شحنة بالمنتج المحدود → 201", (await api("POST", "/api/v1/shipments", { merchantId, recipientName: "ع", recipientPhone: "01012345678", governorateId: gov!.id, addressLine: "x", codAmount: "50", productId: pid2 })).status, 201);
    check("   تاني شحنة (المخزون خلص) → مرفوض 422", (await api("POST", "/api/v1/shipments", { merchantId, recipientName: "ع", recipientPhone: "01012345678", governorateId: gov!.id, addressLine: "x", codAmount: "50", productId: pid2 })).status, 422);

    // ─── رسم التخزين ───
    console.log("  ── رسم التخزين ──");
    const before = await payable(merchantId);
    check("٦) رسم تخزين ١٠٠ ج → 201", (await api("POST", `/api/v1/merchants/${merchantId}/storage-fee`, { amount: "100", note: "تخزين شهر" })).status, 201);
    check("   التاجر اتخصم منه ١٠٠ ج (إيراد للشركة)", (before - (await payable(merchantId))).toString(), "10000");
    const [je] = await sql<{ d: string; c: string; rev: string }[]>`
      SELECT COALESCE(SUM(jl.debit_p),0)::text AS d, COALESCE(SUM(jl.credit_p),0)::text AS c,
             COALESCE(SUM(jl.credit_p) FILTER (WHERE a.code='REVENUE_OTHER'),0)::text AS rev
      FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id JOIN accounts a ON a.id=jl.account_id
      WHERE je.kind='storage_fee' AND jl.merchant_id=${merchantId}::uuid`;
    check("٧) قيد رسم التخزين متوازن", je!.d, je!.c);
    check("   إيراد ١٠٠ ج", je!.rev, "10000");

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الفُلفيلمنت نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
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
