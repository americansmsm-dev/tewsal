/**
 * اختبار محفظة التاجر (تعديل ١): حجز وقت الإنشاء + خصم من المحفظة
 * للأوردر من غير تحصيل + استرداد عند الإلغاء.
 * DATABASE_URL=... npx tsx scripts/verify-wallet.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createShipment } from "../src/server/services/createShipment";
import { walletBalance, depositToWallet } from "../src/server/services/wallet";
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
  const actor: Actor = { userId: null, role: "ops", name: "فاحص المحفظة" };

  try {
    // تاجر + مندوب + محافظة مخدومة
    await client`INSERT INTO merchants (id, code, name_ar, tier, cod_enabled)
      VALUES (${MERCHANT}::uuid, ${"M-WAL-" + stamp}, 'تاجر المحفظة', 't1', true)`;
    await client`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب المحفظة',${"cour_wal_" + stamp},'x','courier',false)`;
    const gov = (await client<{ id: string }[]>`
      SELECT id FROM governorates WHERE is_served = true AND cod_enabled = true LIMIT 1`)[0];
    if (!gov) throw new Error("مفيش محافظة مخدومة في البذور");

    const mkOrder = () =>
      db.transaction((tx) =>
        createShipment(tx, {
          merchantId: MERCHANT,
          recipientName: "عميل",
          recipientPhone: "01000000000",
          governorateId: gov.id,
          addressLine: "عنوان تجريبي",
          codAmount: "0", // من غير تحصيل → أوردر محفظة
          shippingPayer: "merchant",
        }, actor)
      );

    console.log("\n═══ محفظة التاجر: حجز + خصم + استرداد (تعديل ١) ═══\n");

    // ١) من غير رصيد → الشحنة مترفض
    console.log("  ── البوابة ──");
    let blocked = false;
    try { await mkOrder(); } catch (e) { blocked = (e as { code?: string }).code === "INSUFFICIENT_WALLET"; }
    check("١) أوردر من غير رصيد → مرفوض (INSUFFICIENT_WALLET)", blocked, true);

    // ٢) شحن المحفظة ٥٠٠ ج
    console.log("  ── الشحن والحجز ──");
    const afterDeposit = await db.transaction((tx) =>
      depositToWallet(tx, { merchantId: MERCHANT, amountP: 50000n, method: "cash" }));
    check("٢) بعد شحن ٥٠٠ ج: المتاح ٥٠٠", afterDeposit.availableP, 50000n);

    // ٣) أوردر محفظة ينجح ويحجز شحنه
    const order = await mkOrder();
    check("٣) الأوردر اتعمل", order.status, "draft");
    check("   معلّم أوردر محفظة", (await client<{ w: boolean }[]>`
      SELECT is_wallet_order AS w FROM shipments WHERE id = ${order.id}::uuid`)[0]!.w, true);
    const shipP = order.priceP;
    const balHeld = await walletBalance(db, MERCHANT);
    check("   المحجوز = شحن الأوردر", balHeld.reservedP, shipP);
    check("   المتاح = ٥٠٠ − الشحن", balHeld.availableP, 50000n - shipP);
    check("   رصيد الدفتر لسه ٥٠٠ (لسه ماتخصمش)", balHeld.ledgerP, 50000n);

    // ٤) تسليم الأوردر (تحصيل صفر) → الشحن يتخصم من المحفظة مش المستحقات
    console.log("  ── التسليم يخصم من المحفظة ──");
    await client`UPDATE shipments SET current_courier_id = ${COURIER}::uuid, status = 'out_for_delivery'
      WHERE id = ${order.id}::uuid`;
    await db.transaction(async (tx) => {
      const draft = await buildTransitionFinancialEntry(tx, {
        shipmentId: order.id, to: "delivered", cod: { collectedP: 0n, method: "cash" },
      });
      if (draft) await postEntry(tx, draft);
      await tx.execute(sql`UPDATE shipments SET status='delivered' WHERE id=${order.id}::uuid`);
    });
    const walletBal = await accountBalance(db, ACC.merchantWallet(MERCHANT)); // liability: debit-credit
    // إيداع ٥٠٠ = دائن ٥٠٠ (−٥٠٠) ثم خصم شحن = مدين shipP → الصافي = shipP − 50000
    check("٤) حساب المحفظة اتخصم منه الشحن", walletBal, shipP - 50000n);
    // مستحقات التاجر لازم تفضل صفر (مااتلمستش)
    const payable = await accountBalance(db, ACC.merchantPayable(MERCHANT));
    check("   مستحقات التاجر مااتلمستش (صفر)", payable, 0n);
    const balAfter = await walletBalance(db, MERCHANT);
    check("   بعد التسليم: المحجوز اتفكّ", balAfter.reservedP, 0n);
    check("   المتاح = ٥٠٠ − الشحن", balAfter.availableP, 50000n - shipP);

    // ٥) الاسترداد عند الإلغاء
    console.log("  ── الاسترداد عند الإلغاء ──");
    const order2 = await mkOrder();
    const heldNow = (await walletBalance(db, MERCHANT)).reservedP;
    check("٥) أوردر تاني حجز شحنه", heldNow, order2.priceP);
    await client`UPDATE shipments SET status='cancelled' WHERE id = ${order2.id}::uuid`;
    const balCancel = await walletBalance(db, MERCHANT);
    check("   بعد الإلغاء: الحجز رجع (٠)", balCancel.reservedP, 0n);
    check("   المتاح رجع زي ما كان", balCancel.availableP, 50000n - shipP);

    console.log("\n" + "─".repeat(50));
    console.log(fail === 0 ? `✅ كل فحوصات المحفظة نجحت (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
    console.log("─".repeat(50) + "\n");
    process.exitCode = fail === 0 ? 0 : 1;
    await client.end();
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.stack : err);
    await client.end();
    process.exitCode = 1;
  }
}
main();
