/**
 * تشغيل الـ migrations.
 * ⚠️ بيتنفذ قبل النشر — مش من داخل التطبيق.
 *    (نسختين شغالين هيتسابقوا على نفس الـ migration)
 *
 * الاستخدام: npm run db:migrate
 */
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/server/db/migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL مش متعرّف");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    // جدول تتبع الـ migrations
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        checksum    text
      )
    `;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name)
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭️  ${file} — متطبّق قبل كده`);
        continue;
      }

      const content = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`▶️  ${file} — جاري التطبيق...`);

      // كل migration في ترانزاكشن واحدة — إما كلها أو لا شيء
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });

      console.log(`✅ ${file}`);
      ran++;
    }

    if (ran === 0) {
      console.log("\n✅ قاعدة البيانات محدّثة — مفيش migrations جديدة");
    } else {
      console.log(`\n✅ تم تطبيق ${ran} migration`);
    }
  } catch (err) {
    console.error("\n❌ فشل الـ migration:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
