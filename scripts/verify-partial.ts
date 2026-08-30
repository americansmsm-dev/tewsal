/**
 * اختبار التسليم الجزئي بالقطعة (تعديل ٢).
 * DATABASE_URL=... npx tsx scripts/verify-partial.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createShipment } from "../src/server/services/createShipment";
import { applyItemDecision, listItems } from "../src/server/services/shipmentItems";
import { buildTransitionFinancialEntry } from "../src/server/services/shipmentFinancials";
import { postEntry, accountBalance } from "../src/server/services/ledger";
import { ACC } from "../src/server/domain/ledger";
import type { Actor } from "../src/server/services/transition";

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal";
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const stamp = Date.now();
  const MERCHANT = crypto.randomUUID();
  const COURIER = crypto.randomUUID();
  const actor: Actor = { userId: null, role: "ops", name: "فاحص الجزئي" };

  try {
    await client`INSERT INTO merchants (id, code, name_ar, tier, cod_enabled)
      VALUES (${MERCHANT}::uuid, ${"M-PRT-" + stamp}, 'تاجر الجزئي', 't1', true)`;
    await client`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب الجزئي',${"cour_prt_" + stamp},'x','courier',false)`;
    const gov = (await client<{ id: string }[]>`
      SELECT id FROM governorates WHERE is_served = true AND cod_enabled = true LIMIT 1`)[0];
    if (!gov) throw new Error("مفيش محافظة مخدومة");

    const mkOrder = () =>
      db.transaction((tx) =>
        createShipment(tx, {
          merchantId: MERCHANT,
          recipientName: "عميل الجزئي",
          recipientPhone: "01000000001",
          governorateId: gov.id,
          addressLine: "عنوان",
          items: [
            { nameAr: "بنطلون", price: "150", qty: 1 },
            { nameAr: "تيشيرت", price: "80", qty: 1 },
            { nameAr: "كاب", price: "40", qty: 1 },
          ],
        }, actor)
      );

    console.log("\n═══ التسليم الجزئي بالقطعة (تعديل ٢) ═══\n");

    // ١) الأوردر بالقطع → التحصيل = مجموع الأسعار
    const order = await mkOrder();
    check("١) التحصيل = مجموع القطع (270)", order.priceP >= 0n ? (await codOf(client, order.id)) : "", "27000");
    const items = await listItems(db, order.id);
    check("   عدد القطع", items.length, 3);

    // ٢) تسليم جزئي: بنطلون + تيشيرت (230)، كاب مرتجع
    console.log("  ── تسليم جزئي ──");
    await client`UPDATE shipments SET current_courier_id = ${COURIER}::uuid, status='out_for_delivery' WHERE id=${order.id}::uuid`;
    const pants = items.find((i) => i.nameAr === "بنطلون")!;
    const shirt = items.find((i) => i.nameAr === "تيشيرت")!;
    const cap = items.find((i) => i.nameAr === "كاب")!;

    const dec = await db.transaction(async (tx) => {
      const d = await applyItemDecision(tx, order.id, [pants.id, shirt.id]);
      const draft = await buildTransitionFinancialEntry(tx, {
        shipmentId: order.id, to: "partially_delivered", cod: { collectedP: d.collectedP, method: "cash" },
      });
      if (draft) await postEntry(tx, draft);
      await tx.execute(sql`UPDATE shipments SET status='partially_delivered' WHERE id=${order.id}::uuid`);
      return d;
    });
    check("٢) التحصيل المحسوب = 230", dec.collectedP, 23000n);
    check("   اتسلّم 2 · رجع 1", `${dec.deliveredCount}/${dec.returnedCount}`, "2/1");

    // ٣) حالات القطع اتسجّلت صح
    const after = await listItems(db, order.id);
    check("٣) البنطلون delivered", after.find((i) => i.id === pants.id)!.status, "delivered");
    check("   التيشيرت delivered", after.find((i) => i.id === shirt.id)!.status, "delivered");
    check("   الكاب returned", after.find((i) => i.id === cap.id)!.status, "returned");

    // ٤) الماليّة: مستحقات التاجر اتزادت بالمحصّل (ناقص الرسوم)
    const payable = await accountBalance(db, ACC.merchantPayable(MERCHANT)); // liability: debit-credit
    // credit 230 (مستحق) − debit رسوم = −(230 − fees) → payable للتاجر = 230 − fees
    const merchantOwed = -payable; // credit-debit
    check("٤) صافي مستحق للتاجر موجب وأقل من 230 (بعد الرسوم)", merchantOwed > 0n && merchantOwed <= 23000n, true);

    // ٥) تسليم كامل: كل القطع
    console.log("  ── تسليم كامل ──");
    const order2 = await mkOrder();
    const items2 = await listItems(db, order2.id);
    await client`UPDATE shipments SET current_courier_id = ${COURIER}::uuid, status='out_for_delivery' WHERE id=${order2.id}::uuid`;
    const dec2 = await db.transaction((tx) => applyItemDecision(tx, order2.id, items2.map((i) => i.id)));
    check("٥) كله اتسلّم → رجع 0", dec2.returnedCount, 0);
    check("   التحصيل = 270", dec2.collectedP, 27000n);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات الجزئي نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await client.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await client.end();
    process.exitCode = 1;
  }
}

async function codOf(client: postgres.Sql, id: string): Promise<string> {
  const r = await client<{ c: string }[]>`SELECT cod_amount_p::text AS c FROM shipments WHERE id=${id}::uuid`;
  return r[0]!.c;
}
main();
