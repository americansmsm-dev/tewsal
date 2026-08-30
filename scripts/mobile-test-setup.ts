/**
 * تجهيز بيانات لتجربة الموبايل: تاجر بحساب دخول + محفظة مشحونة،
 * مندوب بحساب دخول، وشحنة بقطع مُسندة للمندوب وخارجة للتسليم.
 * DATABASE_URL=... npx tsx scripts/mobile-test-setup.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import { createShipment } from "../src/server/services/createShipment";
import { depositToWallet } from "../src/server/services/wallet";
import type { Actor } from "../src/server/services/transition";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal";
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const actor: Actor = { userId: null, role: "ops", name: "تجهيز الموبايل" };
  try {
    const pw = await hash("Test12345", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const MERCHANT = crypto.randomUUID();
    const gov = (await client<{ id: string }[]>`SELECT id FROM governorates WHERE is_served=true AND cod_enabled=true LIMIT 1`)[0]!;
    const COURIER = crypto.randomUUID();

    // مندوب بحساب دخول
    await client`INSERT INTO users (id, full_name, username, password_hash, role, must_change_password)
      VALUES (${COURIER}::uuid,'مندوب التجربة','courier1',${pw},'courier',false)
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`;
    const courierId = (await client<{ id: string }[]>`SELECT id FROM users WHERE username='courier1'`)[0]!.id;

    // تاجر + مستخدم تاجر مربوط
    await client`INSERT INTO merchants (id, code, name_ar, tier, cod_enabled) VALUES (${MERCHANT}::uuid,'M-DEMO','تاجر التجربة','t1',true)`;
    await client`INSERT INTO users (full_name, username, password_hash, role, merchant_id, must_change_password)
      VALUES ('تاجر التجربة','merch1',${pw},'merchant',${MERCHANT}::uuid,false)
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, merchant_id=EXCLUDED.merchant_id`;

    // شحن المحفظة
    await db.transaction((tx) => depositToWallet(tx, { merchantId: MERCHANT, amountP: 100000n, method: "cash" }));

    // شحنة بقطع مُسندة للمندوب وخارجة للتسليم
    const order = await db.transaction((tx) => createShipment(tx, {
      merchantId: MERCHANT, recipientName: "أحمد محمد", recipientPhone: "01012345678",
      governorateId: gov.id, addressLine: "شارع التجربة، مدينة نصر",
      items: [
        { nameAr: "بنطلون جينز", price: "350", qty: 1 },
        { nameAr: "تيشيرت قطن", price: "180", qty: 2 },
        { nameAr: "كاب", price: "90", qty: 1 },
      ],
    }, actor));
    await client`UPDATE shipments SET current_courier_id=${courierId}::uuid, status='out_for_delivery' WHERE id=${order.id}::uuid`;

    console.log("\n✅ جاهز للتجربة على الموبايل:");
    console.log("  التاجر:  merch1 / Test12345   (بوابة /portal — محفظة ١٠٠٠ج + إنشاء شحنة بقطع)");
    console.log("  المندوب: courier1 / Test12345 (تطبيق /courier — شحنة بقطع للتسليم الجزئي + كاميرا)");
    console.log(`  شحنة التجربة: ${order.awb} (٤ قطع، تحصيل ${Number(order.priceP)}, خارجة للتسليم)`);
    console.log("");
    await client.end();
  } catch (err) {
    console.error("❌", err instanceof Error ? err.message : err);
    await client.end();
    process.exitCode = 1;
  }
}
main();
