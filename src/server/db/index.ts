/**
 * ============================================================
 *  الاتصال بقاعدة البيانات
 * ------------------------------------------------------------
 *  ⚠️ ملاحظات مهمة:
 *   - الـ migrations بتتنفذ من سكربت منفصل، **مش** من التطبيق —
 *     لأن نسختين شغالين هيتسابقوا على نفس الـ migration.
 *   - **المهلات**: استعلام واحد معلّق كان بياخد اتصال من الحوض
 *     **للأبد**. دلوقتي القاعدة نفسها بتقطعه:
 *       · statement_timeout               — أقصى وقت لاستعلام
 *       · lock_timeout                    — أقصى انتظار على قفل صف
 *       · idle_in_transaction_session_timeout — ترانزاكشن سايبة مفتوحة
 *     دي بتتبعت كبارامترات بدء الاتصال، يعني بتتطبّق على كل
 *     اتصالات التطبيق بس — السكربتات (هجرات · باك أب · بذور
 *     الحمل) بتفتح عملاءها الخاصة وماتتأثرش.
 *   - **PgBouncer**: لو `PGBOUNCER=1` بنقفل الـ prepared statements
 *     (شرط وضع تجميع الترانزاكشن). ولازم في `pgbouncer.ini`:
 *       track_extra_parameters = statement_timeout,lock_timeout,idle_in_transaction_session_timeout
 *     ولو النسخة أقدم من 1.21، خلّي `DB_STARTUP_TIMEOUTS=0` عشان
 *     مانبعتش البارامترات دي وقت البدء (بس ساعتها المهلات
 *     بتتظبط من ناحية السيرفر على الدور نفسه).
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

const num = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** خلف PgBouncer في وضع الترانزاكشن — لازم نقفل الـ prepared statements */
const behindPooler = process.env.PGBOUNCER === "1";

/**
 * المهلات كبارامترات بدء الاتصال. القيم بالمللي ثانية.
 *  · استعلام 30 ثانية = مشكلة، مش شغل طبيعي
 *  · انتظار قفل 10 ثواني = تنافس، أحسن يفشل بسرعة ويعيد المحاولة
 *  · ترانزاكشن سايبة 60 ثانية = كود بايظ ماسك قفل
 */
const timeouts =
  process.env.DB_STARTUP_TIMEOUTS === "0"
    ? {}
    : {
        statement_timeout: num("DB_STATEMENT_TIMEOUT_MS", 30_000),
        lock_timeout: num("DB_LOCK_TIMEOUT_MS", 10_000),
        idle_in_transaction_session_timeout: num("DB_IDLE_TX_TIMEOUT_MS", 60_000),
      };

/**
 * عميل postgres.js
 * - max: عدد الاتصالات في المجمّع (ارفعه مع PgBouncer قدّامه)
 * - transform: بنسيبه افتراضي عشان أسماء الأعمدة تفضل زي ما هي
 */
const client = postgres(connectionString, {
  max: num("DB_POOL_MAX", 20),
  idle_timeout: num("DB_IDLE_TIMEOUT_S", 20),
  connect_timeout: num("DB_CONNECT_TIMEOUT_S", 10),
  max_lifetime: num("DB_MAX_LIFETIME_S", 30 * 60),
  prepare: !behindPooler,
  connection: {
    application_name: process.env.DB_APP_NAME ?? "tewsal",
    ...timeouts,
  },
  // ⚠️ لازم يبقى UTC — العرض بيتحول لتوقيت القاهرة في الواجهة
  types: {
    bigint: postgres.BigInt,
  },
});

export const db = drizzle(client, { schema, logger: process.env.DB_LOG === "1" });

export { schema, client };
export type Db = typeof db;
