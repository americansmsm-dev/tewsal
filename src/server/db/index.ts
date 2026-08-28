/**
 * ============================================================
 *  الاتصال بقاعدة البيانات
 * ------------------------------------------------------------
 *  ⚠️ ملاحظات مهمة:
 *   - في الإنتاج بنتصل عبر PgBouncer (تجميع الاتصالات) عشان
 *     نستحمل الذروة بدون استنزاف اتصالات Postgres.
 *   - الـ migrations بتتنفذ من سكربت منفصل، **مش** من التطبيق —
 *     لأن نسختين شغالين هيتسابقوا على نفس الـ migration.
 * ============================================================
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL مش متعرّف — ظبطه في متغيرات البيئة قبل تشغيل التطبيق"
  );
}

/**
 * عميل postgres.js
 * - max: عدد الاتصالات في المجمّع
 * - transform: بنسيبه افتراضي عشان أسماء الأعمدة تفضل زي ما هي
 */
const client = postgres(connectionString, {
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  // ⚠️ لازم يبقى UTC — العرض بيتحول لتوقيت القاهرة في الواجهة
  types: {
    bigint: postgres.BigInt,
  },
});

export const db = drizzle(client, { schema, logger: process.env.DB_LOG === "1" });

export { schema, client };
export type Db = typeof db;
