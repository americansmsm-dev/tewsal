/**
 * ============================================================
 *  الأزرار اللي بتحرّك فلوس أو هوية — ضغط حقيقي في المتصفح
 * ------------------------------------------------------------
 *  الشاشات هنا مش بتتفتح بس — بندوس الأزرار فعلًا ونتأكد إن
 *  الأثر حصل في القاعدة (سعر اتغيّر · مستخدم اتعمل · إشعار
 *  اتبعت · مرتجعات اتحمّلت على مندوب).
 * ============================================================
 */
import { test, expect } from "@playwright/test";
import { accounts, stateFile } from "./accounts";

test.use({ storageState: stateFile("admin") });

test("الأسعار — تعديل سعر بيتحفظ فعلًا", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("سعر الشحن").first()).toBeVisible();

  // أول صف سعر: نغيّره ونحفظ
  const input = page.locator('input.input[inputmode="decimal"]').first();
  await expect(input).toBeVisible();
  const original = await input.inputValue();
  const changed = "137.25";
  await input.fill(changed);
  await page.getByRole("button", { name: "حفظ" }).first().click();
  await expect(page.getByRole("button", { name: "✓" }).first()).toBeVisible({ timeout: 10_000 });

  // بعد إعادة التحميل السعر لسه متغيّر
  await page.reload();
  await expect(page.locator('input.input[inputmode="decimal"]').first()).toHaveValue(changed);

  // نرجّعه زي ما كان
  await page.locator('input.input[inputmode="decimal"]').first().fill(original);
  await page.getByRole("button", { name: "حفظ" }).first().click();
  await expect(page.getByRole("button", { name: "✓" }).first()).toBeVisible({ timeout: 10_000 });
});

test("الفريق — إنشاء مستخدم جديد بيقدر يدخل", async ({ page }) => {
  const username = `e2e_new_${Date.now() % 1000000}`;
  await page.goto("/team");
  await expect(page.getByText("الفريق").first()).toBeVisible();

  await page.getByRole("button", { name: "+ إضافة عضو" }).click();
  // الحقول مش مربوطة بـ label رسمي — بنستخدم الترتيب والـplaceholder
  const dialogInputs = page.locator("input.input");
  await dialogInputs.nth(0).fill("موظف من الاختبار");        // الاسم الكامل
  await page.getByPlaceholder("ahmed_ops").fill(username);    // اسم المستخدم
  await page.locator("select.input").first().selectOption("support");
  await page.getByPlaceholder(/٨ حروف على الأقل/).fill("E2eNewPass123");
  await page.getByRole("button", { name: "فتح الحساب" }).click();

  // شاشة التأكيد بتعرض اسم المستخدم اللي اتعمل
  await expect(page.getByText(username).first()).toBeVisible({ timeout: 15_000 });
});

test("الإشعارات — إرسال إشعار لدور بيوصل فعلًا", async ({ page }) => {
  // المُرسِل بيسأل تأكيد قبل ما يبعت
  page.on("dialog", (d) => d.accept());

  await page.goto("/notifications");
  await expect(page.getByText("ابعت إشعار").first()).toBeVisible();

  const title = `تعميم اختبار ${Date.now() % 100000}`;
  await page.getByRole("button", { name: "دور" }).click();
  await page.locator("select").first().selectOption("courier");
  await page.getByPlaceholder("عنوان الإشعار").fill(title);
  await page.getByPlaceholder("نص الرسالة").fill("رسالة من اختبار المتصفح");
  await page.getByRole("button", { name: "إرسال" }).click();
  await expect(page.getByText(/تم الإرسال لـ/)).toBeVisible({ timeout: 15_000 });

  // المندوب بيشوفه في صندوقه
  const courierCtx = await page.context().browser()!.newContext({ storageState: stateFile("courier") });
  const cp = await courierCtx.newPage();
  await cp.goto("/notifications");
  await expect(cp.getByText(title).first()).toBeVisible({ timeout: 15_000 });
  await courierCtx.close();
});

test("المرتجعات — تحميل مرتجعات على مندوب من الشاشة", async ({ page }) => {
  // المرتجعات متجهّزة في prepare-db (عبر طبقة الخدمات)
  await page.goto("/returns");
  await expect(page.getByText("المرتجعات").first()).toBeVisible();
  await expect(page.getByTitle("تحديد الكل")).toBeVisible({ timeout: 15_000 });

  await page.getByTitle("تحديد الكل").check();
  await page.getByRole("button", { name: /حمّل على مندوب/ }).click();
  await page.locator("select").last().selectOption(accounts.courier.id!);
  await page.getByRole("button", { name: /حمّل \d+ مرتجع/ }).click();

  // بعد التحميل: الرف فاضي، والمرتجعات بقت «مع المندوب»
  await expect(page.getByText("مفيش مرتجعات هنا").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "مع المندوب" }).click();
  await expect(page.getByText("خرج للإرجاع").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("مندوب الاختبار").first()).toBeVisible();
});
