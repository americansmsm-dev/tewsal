/**
 * ============================================================
 *  النسخ الاحتياطي — ٣ وجهات
 * ------------------------------------------------------------
 *  بياخد نسخة كاملة بـ pg_dump في ملف مؤرّخ، ويقدر:
 *   --verify    بروفة استرجاع في قاعدة مؤقتة + التأكد إن
 *               الدفتر متوازن (مدين = دائن) في النسخة نفسها
 *   --upload    نسخة خارجية على Cloudflare R2
 *   --telegram  الملف نفسه على قناة تليجرام + ملخّص
 *
 *  الاستخدام (كل ١٢ ساعة من مهمة مجدولة):
 *    npx tsx scripts/backup.ts --verify --upload --telegram
 *
 *  الوجهة المحلية: BACKUP_DIR (افتراضي ./backups)
 *  الاحتفاظ:       BACKUP_RETAIN (افتراضي ٢٨ = ١٤ يوم على
 *                  إيقاع كل ١٢ ساعة)
 *
 *  ⚠️ أي فشل بيتبعت كتنبيه على تليجرام — السكوت مايتقريش نجاح.
 * ============================================================
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { isR2Configured, putObject } from "../src/lib/r2";
import {
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramDocument,
  tryTelegramAlert,
  TELEGRAM_SAFE_BYTES,
} from "../src/lib/telegram";
import { readFileSync } from "node:fs";

const URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
const DIR = process.env.BACKUP_DIR ?? join(process.cwd(), "backups");
const RETAIN = Number(process.env.BACKUP_RETAIN ?? 28);
const verify = process.argv.includes("--verify");
const upload = process.argv.includes("--upload");
const telegram = process.argv.includes("--telegram");

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
function nowCairo(): string {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short",
  }).format(new Date());
}
function run(cmd: string, args: string[], env?: Record<string, string>) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} مش متسطّب؟ ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} فشل (${r.status}): ${r.stderr?.slice(0, 500)}`);
  return r.stdout;
}

interface BackupFile { path: string; bytes: number; mb: string }

function backup(): BackupFile {
  mkdirSync(DIR, { recursive: true });
  const out = join(DIR, `tewsal-${ts()}.dump`);
  console.log(`⏳ بياخد نسخة → ${out}`);
  // صيغة custom (-Fc) مضغوطة وبتسمح بالاسترجاع الانتقائي
  try {
    run("pg_dump", ["-Fc", "-f", out, URL]);
  } catch (err) {
    // ⚠️ pg_dump الفاشل بيسيب ملف ناقص. لازم يتشال، وإلا التنظيف
    //    ممكن يمسح نسخة سليمة ويسيب البايظة مكانها.
    try { unlinkSync(out); } catch { /* مكانش اتعمل أصلًا */ }
    throw err;
  }
  const bytes = statSync(out).size;
  if (bytes === 0) {
    unlinkSync(out);
    throw new Error("النسخة طلعت فاضية (٠ بايت) — اتشالت");
  }
  const mb = (bytes / 1048576).toFixed(2);
  console.log(`✅ النسخة خلصت — ${mb} ميجا`);

  // تنظيف النسخ القديمة (احتفظ بآخر RETAIN)
  const dumps = readdirSync(DIR).filter((f) => f.startsWith("tewsal-") && f.endsWith(".dump")).sort();
  const drop = dumps.slice(0, Math.max(0, dumps.length - RETAIN));
  for (const f of drop) { unlinkSync(join(DIR, f)); console.log(`🗑️ اتشال القديم: ${f}`); }
  return { path: out, bytes, mb };
}

interface VerifyResult { ok: boolean; users: string; lines: string; balance: string }

function verifyRestore(dump: string): VerifyResult {
  const tmpDb = `tewsal_restore_${Date.now()}`;
  const admin = URL.replace(/\/[^/]+$/, "/postgres");
  console.log(`⏳ بروفة استرجاع في قاعدة مؤقتة: ${tmpDb}`);
  // ملاحظة: psql عايز الخيارات (-c/-tAc) قبل وصلة الاتصال (-d URI)
  run("psql", ["-c", `CREATE DATABASE ${tmpDb}`, "-d", admin]);
  try {
    const target = URL.replace(/\/[^/]+$/, `/${tmpDb}`);
    // pg_restore بيرجّع تحذيرات مش أخطاء أحيانًا — نتجاهل الكود ونفحص العدّ بعدها
    spawnSync("pg_restore", ["-d", target, "--no-owner", dump], { encoding: "utf8" });
    // ⚠️ إثبات إن الاسترجاع نجح = جدول أساسي موجود وفيه بيانات.
    //    (مانعتمدش على عدد سطور اليومية لأن قاعدة جديدة لسه
    //     مفيهاش حركة مالية — وده مش فشل.)
    const users = run("psql", ["-tAc", "SELECT COUNT(*) FROM users", "-d", target]).trim();
    const lines = run("psql", ["-tAc", "SELECT COUNT(*) FROM journal_lines", "-d", target]).trim();
    const balance = run("psql", ["-tAc",
      "SELECT COALESCE(SUM(debit_p)-SUM(credit_p),0) FROM journal_lines", "-d", target]).trim();
    console.log(`   المستخدمين المسترجعين: ${users}`);
    console.log(`   سطور اليومية المسترجعة: ${lines}`);
    console.log(`   توازن الدفتر (لازم 0): ${balance}`);
    const ok = Number(users) > 0 && balance === "0";
    console.log(ok ? "✅ النسخة سليمة وقابلة للاسترجاع ومتوازنة" : "❌ النسخة فيها مشكلة — راجع فورًا");
    return { ok, users, lines, balance };
  } finally {
    run("psql", ["-c", `DROP DATABASE IF EXISTS ${tmpDb} WITH (FORCE)`, "-d", admin]);
    console.log(`🗑️ القاعدة المؤقتة اتشالت`);
  }
}

async function uploadToR2(dump: string): Promise<string | null> {
  if (!isR2Configured()) {
    console.log("⚠️ R2 مش متضبط — تخطّيت الرفع الخارجي");
    return null;
  }
  const key = `db-backups/${basename(dump)}`;
  console.log(`⏳ بيرفع النسخة الخارجية → R2:${key}`);
  await putObject(key, readFileSync(dump), "application/octet-stream");
  console.log(`✅ اترفعت نسخة خارجية على R2 (${key})`);
  return key;
}

/**
 * تليجرام: الملف نفسه لو تحت حد الأمان، وإلا ملخّص + مكان
 * النسخة الخارجية (عشان مايفشلش لمجرد إن القاعدة كبرت).
 */
async function sendToTelegram(file: BackupFile, summary: string, r2Key: string | null): Promise<void> {
  if (!isTelegramConfigured()) {
    console.log("⚠️ تليجرام مش متضبط — تخطّيت الإرسال (محتاج TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID)");
    return;
  }
  if (file.bytes <= TELEGRAM_SAFE_BYTES) {
    await sendTelegramDocument(file.path, summary);
    console.log("✅ النسخة اتبعتت على قناة تليجرام");
    return;
  }
  const note =
    `${summary}\n\n⚠️ النسخة أكبر من حد تليجرام (٥٠ ميجا) فمابعتش الملف.\n` +
    (r2Key ? `📦 النسخة الخارجية على R2: ${r2Key}` : "📦 مفيش نسخة خارجية — فعّل R2 فورًا.");
  await sendTelegramMessage(note);
  console.log("✅ اتبعت ملخّص على تليجرام (الملف أكبر من الحد)");
}

function buildSummary(file: BackupFile, v: VerifyResult | null, r2Key: string | null): string {
  const where = ["💾 السيرفر"];
  if (r2Key) where.push("☁️ R2");
  if (telegram && isTelegramConfigured()) where.push("📨 تليجرام");
  const lines = [
    "🗄️ نسخة احتياطية — توصّل",
    `🕓 ${nowCairo()}`,
    `📁 ${basename(file.path)}`,
    `📏 ${file.mb} ميجا`,
  ];
  if (v) {
    lines.push(`👥 المستخدمين: ${v.users} · 📊 سطور اليومية: ${v.lines}`);
    lines.push(v.ok ? "✅ استرجاع مجرَّب والدفتر متوازن" : `❌ فحص النسخة فشل (التوازن: ${v.balance})`);
  } else {
    lines.push("ℹ️ من غير بروفة استرجاع (شغّل بـ --verify)");
  }
  lines.push(`📍 اتخزنت في: ${where.join(" · ")}`);
  return lines.join("\n");
}

async function main() {
  const file = backup();
  const v = verify ? verifyRestore(file.path) : null;
  const r2Key = upload ? await uploadToR2(file.path) : null;

  const summary = buildSummary(file, v, r2Key);
  if (telegram) await sendToTelegram(file, summary, r2Key);
  console.log("\n" + summary + "\n");

  // لو البروفة فشلت، الخروج بخطأ + تنبيه — النسخة مش موثوقة
  if (v && !v.ok) {
    await tryTelegramAlert(`🚨 نسخة توصّل الاحتياطية فشلت في فحص الاسترجاع!\n${summary}`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("❌ فشل:", msg);
  await tryTelegramAlert(`🚨 فشل النسخ الاحتياطي لتوصّل\n🕓 ${nowCairo()}\n\n${msg}`);
  process.exitCode = 1;
});
