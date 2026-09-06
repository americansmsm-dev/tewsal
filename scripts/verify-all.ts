/**
 * ============================================================
 *  مشغّل كل فحوصات التحقق — عزل كامل لكل سكربت
 * ------------------------------------------------------------
 *  ⚠️ ليه المشغّل ده موجود:
 *     سكربتات verify-* بتتأكد من **إجماليات مطلقة** (مثلاً
 *     «إيراد الشحن = ١٩٠ ج»). لما تشغّلها ورا بعض على نفس
 *     القاعدة، بيانات كل واحد بتبوّظ اللي بعده وتطلع أخطاء
 *     كاذبة — يعني «الفحص الشامل» كان مستحيل أصلًا.
 *
 *  الحل: **قاعدة نضيفة لكل سكربت**:
 *    ١) بناء التطبيق مرة واحدة (next build)
 *    ٢) قاعدة قالب: migrate + seed + باسورد أدمن معروف
 *    ٣) لكل سكربت: قاعدة جديدة من القالب (سريعة) + سيرفر
 *       عليها + تشغيل السكربت + إغلاق + مسح
 *    ٤) مسح القالب
 *
 *  الاستخدام:
 *    DATABASE_URL=postgres://postgres@127.0.0.1:54320/tewsal \
 *      npx tsx scripts/verify-all.ts
 *
 *  خيارات:
 *    --no-build      يستخدم البناء الموجود (أسرع لو مغيّرتش كود)
 *    --only=a,b      سكربتات بعينها (بالاسم من غير verify-)
 *    --port=3199     بورت السيرفر المؤقت
 *    --keep          مايمسحش القواعد (للتشخيص)
 * ============================================================
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const KEEP = process.argv.includes("--keep");
const NO_BUILD = process.argv.includes("--no-build");
const PORT = Number(arg("port") ?? 3199);
const ONLY = arg("only")?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = process.env.SESSION_SECRET ?? "verify-all-secret-32-chars-minimum!!";

const stamp = Date.now();
const tmpl = `tewsal_tmpl_${stamp}`;
const adminUrl = DB_URL.replace(/\/[^/]+$/, "/postgres");
const urlFor = (db: string) => DB_URL.replace(/\/[^/]+$/, `/${db}`);

const SKIP = new Set(["verify-all"]);

function sh(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* لسه بيقوم */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { encoding: "utf8" });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* راح */ }
  }
}

function startServer(dbUrl: string): ChildProcess {
  return spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, DATABASE_URL: dbUrl, SESSION_SECRET: SECRET, NODE_ENV: "production" },
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });
}

async function main() {
  // onnotice فاضية عشان تنبيهات Postgres ماتغرقش نتيجة الفحص
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const results: Array<{ name: string; ok: boolean; summary: string; fails: string[] }> = [];
  const createdDbs: string[] = [];

  try {
    // ── ١) البناء ──
    if (!NO_BUILD || !existsSync(join(process.cwd(), ".next", "BUILD_ID"))) {
      console.log("🏗️  ببني التطبيق (مرة واحدة)...");
      const b = sh("npx", ["next", "build"], { DATABASE_URL: DB_URL, SESSION_SECRET: SECRET });
      if (b.code !== 0) {
        console.error(`❌ البناء فشل:\n${b.out.slice(-2000)}`);
        process.exitCode = 1;
        return;
      }
      console.log("✅ البناء تمام");
    }

    // ── ٢) قاعدة القالب ──
    console.log(`\n🗄️  قاعدة قالب: ${tmpl}`);
    await admin.unsafe(`CREATE DATABASE ${tmpl}`);
    createdDbs.push(tmpl);
    for (const [label, script] of [
      ["الهجرات", "scripts/migrate.ts"],
      ["البذور", "scripts/seed.ts"],
      ["باسورد الأدمن", "scripts/reset-admin.ts"],
    ] as const) {
      const r = sh("npx", ["tsx", script], { DATABASE_URL: urlFor(tmpl) });
      if (r.code !== 0) {
        console.error(`❌ ${label} فشلت:\n${r.out.slice(-1500)}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✅ ${label}`);
    }

    // ── ٣) الفحوصات — قاعدة نضيفة لكل واحد ──
    const all = readdirSync(join(process.cwd(), "scripts"))
      .filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((n) => !SKIP.has(n))
      .filter((n) => ONLY.length === 0 || ONLY.includes(n.replace(/^verify-/, "")))
      .sort();

    console.log(`\n${"═".repeat(62)}\n  ${all.length} سكربت — كل واحد على قاعدة نضيفة\n${"═".repeat(62)}\n`);

    for (let i = 0; i < all.length; i++) {
      const name = all[i]!;
      const db = `tewsal_v${stamp}_${i}`;
      process.stdout.write(`  ${String(i + 1).padStart(2)}/${all.length}  ${name.padEnd(30, ".")} `);

      let server: ChildProcess | null = null;
      try {
        await admin.unsafe(`CREATE DATABASE ${db} TEMPLATE ${tmpl}`);
        createdDbs.push(db);
        server = startServer(urlFor(db));
        if (!(await waitForHealth(60_000))) {
          results.push({ name, ok: false, summary: "السيرفر ماقامش", fails: [] });
          console.log("❌ (السيرفر ماقامش)");
          continue;
        }
        const r = sh("npx", ["tsx", `scripts/${name}.ts`], {
          DATABASE_URL: urlFor(db), BASE, BASE_URL: BASE,
        });
        const lines = r.out.split("\n");
        const summary = lines.reverse().find((l) => l.includes("✅") || l.includes("❌"))?.trim() ?? "";
        const fails = r.out.split("\n").filter((l) => l.includes("❌")).slice(0, 4).map((l) => l.trim());
        const ok = r.code === 0;
        results.push({ name, ok, summary, fails });
        console.log(ok ? "✅" : "❌");
        if (!ok) for (const f of fails) console.log(`         ${f}`);
      } finally {
        if (server) { killTree(server); await new Promise((r) => setTimeout(r, 800)); }
        if (!KEEP) {
          try { await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); } catch { /* بعدين */ }
        }
      }
    }

    // ── ٤) الملخّص ──
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${"═".repeat(62)}`);
    if (failed.length === 0) {
      console.log(`✅ كل الفحوصات نجحت — ${results.length}/${results.length} سكربت`);
    } else {
      console.log(`❌ ${failed.length} سكربت فشل من ${results.length}:`);
      for (const f of failed) console.log(`   · ${f.name}  ${f.summary}`);
    }
    console.log(`${"═".repeat(62)}\n`);
    process.exitCode = failed.length === 0 ? 0 : 1;
  } catch (err) {
    console.error("\n❌ وقع:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (!KEEP) {
      for (const db of createdDbs.reverse()) {
        try { await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); } catch { /* تجاهل */ }
      }
      console.log("🗑️  اتمسحت قواعد الاختبار");
    } else {
      console.log(`ℹ️  القواعد متسابة (القالب: ${tmpl})`);
    }
    await admin.end();
  }
}

main();
