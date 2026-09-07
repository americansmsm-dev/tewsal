/**
 * تسجيل دخول كل دور مرة واحدة وحفظ الجلسة — باقي الاختبارات
 * بتستخدم الجلسات دي بدل ما تدخل كل مرة.
 */
import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { accounts, stateFile, ROLES, type RoleKey } from "./accounts";

setup("تسجيل دخول كل الأدوار", async ({ browser }) => {
  mkdirSync(join(process.cwd(), "e2e", ".auth"), { recursive: true });

  for (const role of ROLES) {
    const acc = accounts[role as RoleKey];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("اسم المستخدم أو رقم التليفون").fill(acc.username);
    await page.getByLabel("كلمة المرور").fill(acc.password);
    await page.getByRole("button", { name: "دخول" }).click();
    // الدخول بينقل لصفحة حسب الدور — بنستنى إننا خرجنا من /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await ctx.storageState({ path: stateFile(role) });
    await ctx.close();
  }
});
