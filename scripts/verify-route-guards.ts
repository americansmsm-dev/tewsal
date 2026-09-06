/**
 * ============================================================
 *  فحص حراس الصلاحيات على كل نقطة API
 * ------------------------------------------------------------
 *  بيقرا كل ملفات app/api/**\/route.ts ويتأكد إن:
 *   ١) كل ملف فيه معالج (GET/POST/PATCH/PUT/DELETE) عليه حارس
 *      (requireUser / requireRole / requirePermission / authToken)
 *   ٢) أي ملف من غير حارس لازم يكون في قايمة «العامة» صراحةً
 *      — يعني نسيان الحارس بيطلع فورًا مش بعد ما حد يستغله
 *   ٣) النقاط اللي بتغيّر بيانات (POST/PATCH/PUT/DELETE) مايكونش
 *      حارسها requireUser لوحده من غير أي فحص دور — إلا لو
 *      متسجّلة كاستثناء مقصود (بيانات المستخدم نفسه)
 *
 *  فحص ثابت — مش محتاج قاعدة ولا سيرفر.
 *    npx tsx scripts/verify-route-guards.ts
 * ============================================================
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** نقاط عامة بقصد — من غير تسجيل دخول */
const PUBLIC_ROUTES = new Set([
  "app/api/health/route.ts",              // فحص حياة السيرفر
  "app/api/v1/auth/login/route.ts",       // الدخول نفسه
  "app/api/v1/auth/logout/route.ts",      // الخروج (بيمسح الكوكي)
  "app/api/v1/track/[awb]/route.ts",      // تتبّع العميل (بيانات مقنّعة)
  "app/api/public/v1/rate/route.ts",      // تقييم العميل بعد التسليم
]);

/**
 * نقاط بتغيّر بيانات وحارسها requireUser بس **بقصد** — لأن
 * المستخدم بيعدّل بياناته هو، والملكية بتتفحص جوّه الكود.
 */
const SELF_SERVICE = new Set([
  "app/api/v1/profile/route.ts",
  "app/api/v1/profile/avatar/route.ts",
  "app/api/v1/notifications/read/route.ts",
  "app/api/v1/auth/2fa/route.ts",
]);

/**
 * نقاط بتفحص الدور بآلية أدق من requireRole: آلة الحالات
 * بتحدّد الأدوار المسموحة **لكل انتقال على حدة** (canTransition)،
 * وده أدق من قايمة أدوار واحدة على الملف كله.
 */
const STATE_MACHINE_GUARDED = new Set([
  "app/api/v1/shipments/[id]/transitions/route.ts",
]);

const GUARDS = ["requireRole", "requirePermission", "requireUser", "authToken"];
const ROLE_GUARDS = ["requireRole", "requirePermission", "authToken"];
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const MUTATING = ["POST", "PATCH", "PUT", "DELETE"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

function main() {
  const root = process.cwd();
  const files = walk(join(root, "app", "api")).map((f) => relative(root, f).replace(/\\/g, "/")).sort();

  console.log(`\n═══ حراس الصلاحيات — ${files.length} ملف API ═══\n`);

  const unguarded: string[] = [];
  const mutatingUserOnly: string[] = [];
  let handlerCount = 0;

  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    const methods = METHODS.filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src));
    handlerCount += methods.length;

    const hasAnyGuard = GUARDS.some((g) => src.includes(g));
    const hasRoleGuard = ROLE_GUARDS.some((g) => src.includes(g));

    if (!hasAnyGuard && !PUBLIC_ROUTES.has(rel)) unguarded.push(rel);

    // نقطة بتغيّر بيانات + حارسها requireUser بس = خطر (إلا لو self-service)
    const mutates = methods.some((m) => MUTATING.includes(m));
    const smGuarded = STATE_MACHINE_GUARDED.has(rel) && src.includes("canTransition");
    if (mutates && hasAnyGuard && !hasRoleGuard && !PUBLIC_ROUTES.has(rel) && !SELF_SERVICE.has(rel) && !smGuarded) {
      mutatingUserOnly.push(rel);
    }
  }

  console.log(`  ℹ️ إجمالي المعالجات: ${handlerCount}\n`);

  check("١) مفيش نقطة من غير أي حارس", unguarded.length === 0, unguarded.join(" · "));
  for (const f of unguarded) console.log(`       ⚠️ ${f}`);

  check(
    "٢) مفيش نقطة بتغيّر بيانات محروسة بـ requireUser لوحده (بدون فحص دور)",
    mutatingUserOnly.length === 0,
    mutatingUserOnly.join(" · ")
  );
  for (const f of mutatingUserOnly) console.log(`       ⚠️ ${f}`);

  // النقاط العامة لازم تفضل قليلة ومقصودة
  const declaredPublic = [...PUBLIC_ROUTES].filter((p) => files.includes(p));
  check("٣) النقاط العامة المعلنة كلها موجودة فعلًا", declaredPublic.length === PUBLIC_ROUTES.size,
    `معلن ${PUBLIC_ROUTES.size} · موجود ${declaredPublic.length}`);
  console.log(`       النقاط العامة: ${declaredPublic.length} — ${declaredPublic.map((p) => p.replace("app/api/", "")).join(" · ")}`);

  // كل ملف لازم يكون فيه معالج واحد على الأقل
  const empty = files.filter((rel) => {
    const src = readFileSync(join(root, rel), "utf8");
    return !METHODS.some((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src));
  });
  check("٤) كل ملف route فيه معالج واحد على الأقل", empty.length === 0, empty.join(" · "));

  console.log("\n" + "─".repeat(54));
  console.log(fail === 0 ? `✅ كل نقاط الـAPI محروسة (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
  console.log("─".repeat(54) + "\n");
  process.exitCode = fail === 0 ? 0 : 1;
}

main();
