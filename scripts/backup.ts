/**
 * ============================================================
 *  النسخ الاحتياطي — مرحلة ك
 * ------------------------------------------------------------
 *  بياخد نسخة كاملة من قاعدة البيانات بـ pg_dump في ملف مؤرّخ،
 *  ويقدر يعمل بروفة استرجاع في قاعدة مؤقتة ويتأكد إن العدد سليم.
 *
 *  نسخة:      DATABASE_URL=... npx tsx scripts/backup.ts
 *  بروفة:     DATABASE_URL=... npx tsx scripts/backup.ts --verify
 *  الوجهة:    BACKUP_DIR=/path (افتراضي ./backups)
 *
 *  ⚠️ الاسترجاع الفعلي على سيرفر الإنتاج + النسخ لوجهة خارجية
 *     (R2 و VPS B) عملية تشغيلية بيعملها المالك — دي الأداة.
 * ============================================================
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal";
const DIR = process.env.BACKUP_DIR ?? join(process.cwd(), "backups");
const RETAIN = Number(process.env.BACKUP_RETAIN ?? 14); // آخر ١٤ نسخة
const verify = process.argv.includes("--verify");

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
function run(cmd: string, args: string[], env?: Record<string, string>) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} مش متسطّب؟ ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} فشل (${r.status}): ${r.stderr?.slice(0, 500)}`);
  return r.stdout;
}

function backup() {
  mkdirSync(DIR, { recursive: true });
  const out = join(DIR, `tewsal-${ts()}.dump`);
  console.log(`⏳ بياخد نسخة → ${out}`);
  // صيغة custom (-Fc) مضغوطة وبتسمح بالاسترجاع الانتقائي
  run("pg_dump", ["-Fc", "-f", out, URL]);
  const mb = (statSync(out).size / 1048576).toFixed(2);
  console.log(`✅ النسخة خلصت — ${mb} ميجا`);

  // تنظيف النسخ القديمة (احتفظ بآخر RETAIN)
  const dumps = readdirSync(DIR).filter((f) => f.startsWith("tewsal-") && f.endsWith(".dump")).sort();
  const drop = dumps.slice(0, Math.max(0, dumps.length - RETAIN));
  for (const f of drop) { unlinkSync(join(DIR, f)); console.log(`🗑️ اتشال القديم: ${f}`); }
  return out;
}

function verifyRestore(dump: string) {
  const tmpDb = `tewsal_restore_${Date.now()}`;
  const admin = URL.replace(/\/[^/]+$/, "/postgres"); // نتصل بـ postgres عشان ننشئ قاعدة
  console.log(`⏳ بروفة استرجاع في قاعدة مؤقتة: ${tmpDb}`);
  // ملاحظة: psql عايز الخيارات (-c/-tAc) قبل وصلة الاتصال (-d URI)
  run("psql", ["-c", `CREATE DATABASE ${tmpDb}`, "-d", admin]);
  try {
    const target = URL.replace(/\/[^/]+$/, `/${tmpDb}`);
    // pg_restore بيرجّع تحذيرات مش أخطاء أحيانًا — نتجاهل الكود لكن نفحص العدّ بعدها
    spawnSync("pg_restore", ["-d", target, "--no-owner", dump], { encoding: "utf8" });
    const cnt = run("psql", ["-tAc", "SELECT COUNT(*) FROM journal_lines", "-d", target]).trim();
    const bal = run("psql", ["-tAc",
      "SELECT COALESCE(SUM(debit_p)-SUM(credit_p),0) FROM journal_lines", "-d", target]).trim();
    console.log(`   سطور اليومية المسترجعة: ${cnt}`);
    console.log(`   توازن الدفتر (لازم 0): ${bal}`);
    const ok = Number(cnt) > 0 && bal === "0";
    console.log(ok ? "✅ النسخة سليمة وقابلة للاسترجاع ومتوازنة" : "❌ النسخة فيها مشكلة — راجع فورًا");
    process.exitCode = ok ? 0 : 1;
  } finally {
    run("psql", ["-c", `DROP DATABASE IF EXISTS ${tmpDb} WITH (FORCE)`, "-d", admin]);
    console.log(`🗑️ القاعدة المؤقتة اتشالت`);
  }
}

try {
  const dump = backup();
  if (verify) verifyRestore(dump);
  else console.log("ℹ️ للتأكد إنها قابلة للاسترجاع: أعد التشغيل بـ --verify");
} catch (err) {
  console.error("❌ فشل:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
