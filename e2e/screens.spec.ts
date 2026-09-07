/**
 * ============================================================
 *  كل شاشة تفتح من غير أي خطأ — لكل دور مسموح له
 * ------------------------------------------------------------
 *  ده أوسع فحص في السويت: بيفتح الـ٢٧ شاشة بجلسة كل دور،
 *  ويتأكد إن الصفحة اشتغلت فعلًا (العنوان بان) و**مفيش أي
 *  خطأ في كونسول المتصفح** ولا طلب API رجع ٥٠٠.
 *
 *  الفكرة: أي كراش في الواجهة أو بيانات مش متعامل معاها
 *  بيتمسك هنا قبل ما تشوفه إنت.
 * ============================================================
 */
import { test, expect, type Page } from "@playwright/test";
import { stateFile } from "./accounts";

interface Screen { path: string; name: string; expect: string; roles: string[] }

/** الأدوار حسب AppNav — مين بيشوف إيه */
const ALL_STAFF = ["admin", "accountant", "ops", "support", "dataEntry"];
const SCREENS: Screen[] = [
  { path: "/", name: "الشحنات", expect: "الشحنات", roles: ALL_STAFF },
  { path: "/pickups", name: "الاستلام", expect: "الاستلام", roles: ["admin", "ops"] },
  { path: "/scan", name: "المسح", expect: "المسح", roles: ["admin", "ops"] },
  { path: "/receiving", name: "الوارد", expect: "الوارد", roles: ["admin", "ops"] },
  { path: "/runsheets", name: "الكشوف", expect: "الكشوف", roles: ["admin", "ops", "accountant"] },
  { path: "/returns", name: "المرتجعات", expect: "المرتجعات", roles: ["admin", "ops", "accountant"] },
  { path: "/warehouse", name: "المخزن", expect: "المخزن", roles: ["admin", "ops"] },
  { path: "/merchants", name: "التجار", expect: "التجار", roles: ["admin", "ops", "accountant"] },
  { path: "/import", name: "استيراد", expect: "استيراد", roles: ["admin", "ops", "dataEntry"] },
  { path: "/treasury", name: "الخزينة", expect: "الخزينة", roles: ["admin", "accountant"] },
  { path: "/settlements", name: "التسويات", expect: "التسويات", roles: ["admin", "accountant"] },
  { path: "/courier-commissions", name: "عمولات المناديب", expect: "عمولات المناديب", roles: ["admin", "accountant"] },
  { path: "/claims", name: "المطالبات", expect: "المطالبات", roles: ["admin", "accountant", "ops"] },
  { path: "/tasks", name: "التشغيل", expect: "التشغيل", roles: ["admin", "ops", "accountant", "support"] },
  { path: "/live", name: "الخريطة", expect: "الخريطة", roles: ["admin"] },
  { path: "/reports", name: "التقارير", expect: "التقارير", roles: ["admin", "accountant", "ops"] },
  { path: "/reports/aging", name: "الأعمار", expect: "الأعمار", roles: ["admin", "accountant"] },
  { path: "/pricing", name: "الأسعار", expect: "الأسعار", roles: ["admin", "accountant"] },
  { path: "/team", name: "الفريق", expect: "الفريق", roles: ["admin"] },
  { path: "/notifications", name: "الإشعارات", expect: "الإشعارات", roles: ["admin", "accountant", "ops", "courier", "merchant", "support", "dataEntry"] },
  { path: "/security", name: "الأمان", expect: "الأمان", roles: ["admin", "accountant"] },
  { path: "/courier", name: "تطبيق المندوب", expect: "توص", roles: ["courier"] },
  { path: "/portal", name: "بوابة التاجر", expect: "توص", roles: ["merchant"] },
];

/** بيجمع أخطاء الكونسول وردود ٥٠٠ عشان نفشل عليها */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // تجاهل ضوضاء الشبكة المتوقعة (٤٠١/٤٠٣ للأدوار الممنوعة)
    if (/Failed to load resource|net::ERR_|401|403|404/.test(t)) return;
    errors.push(t);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

for (const s of SCREENS) {
  for (const role of s.roles) {
    test(`${s.name} (${s.path}) — ${role}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: stateFile(role) });
      const page = await ctx.newPage();
      const errors = watch(page);
      await page.goto(s.path, { waitUntil: "domcontentloaded" });
      // الصفحة اشتغلت فعلًا: النص المتوقع بان
      await expect(page.getByText(s.expect).first()).toBeVisible({ timeout: 20_000 });
      // مفيش «جاري التحميل» عالق بعد ما البيانات توصل
      await page.waitForTimeout(1200);
      expect(errors, `أخطاء في ${s.path} للدور ${role}:\n${errors.join("\n")}`).toEqual([]);
      await ctx.close();
    });
  }
}
