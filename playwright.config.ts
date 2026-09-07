import { defineConfig, devices } from "@playwright/test";

/**
 * ============================================================
 *  اختبارات المتصفح — كل شاشة وكل زرار لكل دور
 * ------------------------------------------------------------
 *  ⚠️ بيشتغل على **قاعدة اختبار منفصلة** (tewsal_e2e) بتتعمل
 *     من الأول في global-setup — عشان مايلمسش بياناتك.
 *
 *  التشغيل:  npm run e2e
 *  بواجهة:   npm run e2e:ui
 * ============================================================
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54320/tewsal";
export const E2E_DB_URL = BASE_DB.replace(/\/[^/]+$/, "/tewsal_e2e");
export const E2E_SECRET = "e2e-secret-32-characters-minimum-ok!";

export default defineConfig({
  testDir: "./e2e",
  // قاعدة واحدة مشتركة → تشغيل متسلسل عشان النتيجة تبقى مؤكدة
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB_URL,
      SESSION_SECRET: E2E_SECRET,
      NODE_ENV: "production",
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
