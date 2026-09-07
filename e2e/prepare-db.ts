/**
 * تجهيز قاعدة اختبار المتصفح — بتتعمل من الأول كل تشغيلة.
 * بتعمل: قاعدة نضيفة + هجرات + بذور + مستخدم لكل دور + تاجر
 * بحساب دخول، وبتحفظ البيانات في e2e/.accounts.json.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { E2E_DB_URL } from "../playwright.config";

export interface Accounts {
  admin: { username: string; password: string };
  accountant: { username: string; password: string };
  ops: { username: string; password: string };
  courier: { username: string; password: string; id: string };
  support: { username: string; password: string };
  dataEntry: { username: string; password: string };
  merchant: { username: string; password: string; id: string };
  govId: string;
}

const PW = "E2ePass12345";

function sh(cmd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...env }, encoding: "utf8", shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} فشل:\n${(r.stdout ?? "") + (r.stderr ?? "")}`.slice(0, 1500));
}

export async function prepare() {
  const adminUrl = E2E_DB_URL.replace(/\/[^/]+$/, "/postgres");
  const dbName = E2E_DB_URL.split("/").pop()!;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });

  console.log(`\n🗄️  بجهّز قاعدة اختبار المتصفح: ${dbName}`);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const env = { DATABASE_URL: E2E_DB_URL };
  sh("npx", ["tsx", "scripts/migrate.ts"], env);
  sh("npx", ["tsx", "scripts/seed.ts"], env);
  sh("npx", ["tsx", "scripts/reset-admin.ts", `--pw=${PW}`], env);

  // مستخدمين بكل الأدوار + تاجر بحساب — مباشرة في القاعدة
  const { hashPassword } = await import("../src/server/auth/password");
  const hash = await hashPassword(PW);
  const db = postgres(E2E_DB_URL, { max: 1, onnotice: () => {} });

  async function mkUser(role: string, username: string, name: string, merchantId?: string) {
    const [r] = await db<{ id: string }[]>`
      INSERT INTO users (full_name, username, password_hash, role, merchant_id, must_change_password, is_active)
      VALUES (${name}, ${username}, ${hash}, ${role}, ${merchantId ?? null}::uuid, false, true)
      RETURNING id::text`;
    return r!.id;
  }

  const [merchant] = await db<{ id: string }[]>`
    INSERT INTO merchants (code, name_ar, tier, cod_enabled, is_active)
    VALUES ('M-E2E-001', 'تاجر الاختبار', 't1', true, true)
    RETURNING id::text`;
  const merchantId = merchant!.id;

  const courierId = await mkUser("courier", "e2e_courier", "مندوب الاختبار");
  await mkUser("accountant", "e2e_accountant", "محاسب الاختبار");
  await mkUser("ops", "e2e_ops", "مسؤول مخزن الاختبار");
  await mkUser("support", "e2e_support", "خدمة عملاء الاختبار");
  await mkUser("data_entry", "e2e_dataentry", "مدخل بيانات الاختبار");
  await mkUser("merchant", "e2e_merchant", "تاجر الاختبار", merchantId);

  const [gov] = await db<{ id: string }[]>`SELECT id::text FROM governorates WHERE code='CAI'`;

  const accounts: Accounts = {
    admin: { username: "admin", password: PW },
    accountant: { username: "e2e_accountant", password: PW },
    ops: { username: "e2e_ops", password: PW },
    courier: { username: "e2e_courier", password: PW, id: courierId },
    support: { username: "e2e_support", password: PW },
    dataEntry: { username: "e2e_dataentry", password: PW },
    merchant: { username: "e2e_merchant", password: PW, id: merchantId },
    govId: gov!.id,
  };
  writeFileSync(join(process.cwd(), "e2e", ".accounts.json"), JSON.stringify(accounts, null, 2), "utf8");
  await db.end();

  // مرتجعين جاهزين على الرف — عشان اختبار «تحميل المرتجعات على مندوب»
  // بيتعمل عبر طبقة الخدمات (مش HTTP) لأن كوكي الجلسة Secure في
  // وضع الإنتاج فسياق الـAPI في Playwright مابيبعتوش على http.
  await seedReturns(merchantId, courierId, gov!.id);
  console.log("✅ قاعدة الاختبار والحسابات جاهزة\n");
}

/** بيعمل شحنتين ويوصّلهم لحالة «بانتظار الإرجاع» عبر البوابة الرسمية */
async function seedReturns(merchantId: string, courierId: string, govId: string) {
  process.env.DATABASE_URL = E2E_DB_URL;
  const { db } = await import("../src/server/db");
  const { createShipment } = await import("../src/server/services/createShipment");
  const { applyTransition } = await import("../src/server/services/transition");
  const { enterReturns } = await import("../src/server/services/returns");
  const actor = { userId: null, role: "super_admin" as const, name: "تجهيز الاختبار" };

  for (let i = 0; i < 2; i++) {
    await db.transaction(async (tx) => {
      const s = await createShipment(tx, {
        merchantId, recipientName: `عميل مرتجع ${i + 1}`, recipientPhone: "01012345678",
        governorateId: govId, addressLine: "المعادي", codAmount: "600", confirm: true,
      }, actor);
      const step = (to: string, extra: Record<string, unknown> = {}) =>
        applyTransition(tx, { shipmentId: s.id, to: to as never, actor, ...extra });
      await step("pickup_assigned", { pickupId: "eeeeeeee-e2e0-4000-8000-000000000001", courierId });
      await step("picked_up");
      await step("at_hub");
      await step("awaiting_return", { reasonCode: "no_answer" });
      await enterReturns(tx, { shipmentId: s.id, actorUserId: null });
    });
  }
  console.log("✅ اتجهّز مرتجعين على الرف");
}

prepare().catch((e) => {
  console.error("❌ فشل تجهيز قاعدة الاختبار:", e instanceof Error ? e.message : e);
  process.exit(1);
});
