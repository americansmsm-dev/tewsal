/**
 * ============================================================
 *  الاستيراد المجمّع: دفعات · نجاح جزئي · مؤشر بلا تسريب
 * ------------------------------------------------------------
 *  الاستيراد كان ٢٠٠٠ صف في ترانزاكشن **واحدة**:
 *    · بتفضل مفتوحة ماسكة قفل وبتاكل اتصال من الحوض
 *    · وأول صف بيفشل كان بيفسد الترانزاكشن، فكل الصفوف اللي
 *      بعده بتفشل بـ«current transaction is aborted» — يعني
 *      غلطة في صف رقم ٣ بتضيّع ١٩٩٧ صف سليم من غير ما حد ياخد باله.
 *
 *  السكربت ده بيثبت التصليح:
 *    ١) دفعة أكبر من حجم الدفعة → أكتر من ترانزاكشن (chunks > 1)
 *    ٢) صف فاشل في النص → **اللي بعده بيتعمل عادي** (savepoint)
 *    ٣) التقرير بيقول بالظبط مين نجح ومين فشل وليه
 *    ٤) المؤشر (created_at, id) مابيكرّرش ومابيتخطّاش صفوف
 *       اتعملت في نفس اللحظة — وده بالظبط اللي الاستيراد بيعمله
 *
 *  DATABASE_URL=... BASE=http://127.0.0.1:3100 \
 *    npx tsx scripts/verify-import-capacity.ts
 * ============================================================
 */
const BASE = process.env.BASE ?? process.env.BASE_URL ?? "http://127.0.0.1:3100";
let pass = 0, fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (متوقع ${expected} · فعلي ${actual})`}`);
  ok ? pass++ : fail++;
}

function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const s = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("tewsal_session="));
    if (s) cookie = s.split(";")[0]!;
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

interface CommitResult { created: number; failed: number; chunks: number; errors: { index: number; error: string }[] }

async function main() {
  const api = client();
  const stamp = Date.now() % 100000;
  console.log("\n═══ الاستيراد المجمّع: دفعات ونجاح جزئي ═══\n");

  check("١) دخول", (await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin12345" })).status, 200);

  const m = await api("POST", "/api/v1/merchants", { code: `M-IMP-${stamp}`, nameAr: "تاجر الاستيراد", tier: "t1" });
  const merchantId = (m.json as { merchant: { id: string } }).merchant.id;
  check("٢) تاجر الاختبار اتعمل", m.status, 201);

  const row = (i: number, extra: Record<string, string> = {}) => ({
    recipientName: `مستلم ${i}`,
    recipientPhone: `0100${String(1000000 + i).slice(-7)}`,
    governorate: "القاهرة",
    addressLine: `شارع ${i}، المعادي`,
    codAmount: "250",
    ...extra,
  });

  // ── ١) المعاينة: القائمة السوداء باستعلام واحد ──
  console.log("  ── المعاينة ──");
  const bannedPhone = "01099887766";
  await api("POST", "/api/v1/blacklist", { phone: bannedPhone, reason: "رفض متكرر" });
  const prevRows = [...Array(40)].map((_, i) => row(i));
  prevRows[7] = { ...row(7), recipientPhone: bannedPhone };
  prevRows[9] = { ...row(9), governorate: "بلد مالهاش وجود" };
  const pv = await api("POST", "/api/v1/imports", { action: "preview", merchantId, rows: prevRows });
  const pvd = pv.json as { results: { index: number; ok: boolean; errors: string[] }[]; validCount: number };
  check("٣) المعاينة رجّعت ٤٠ صف", pvd.results?.length, 40);
  check("٤) الصالح = ٣٨", pvd.validCount, 38);
  check("٥) الأسود اتمسك", pvd.results?.[7]?.errors?.some((e) => e.includes("السوداء")), true);
  check("٦) المحافظة الغلط اتمسكت", pvd.results?.[9]?.ok, false);

  // ── ٢) التنفيذ على دفعات ──
  console.log("  ── التنفيذ على دفعات (١٢٠ صف · الدفعة ١٠٠) ──");
  const bulk = [...Array(120)].map((_, i) => row(1000 + i));
  const t0 = performance.now();
  const c1 = await api("POST", "/api/v1/imports", { action: "commit", merchantId, rows: bulk });
  const r1 = c1.json as unknown as CommitResult;
  console.log(`     ⏱️  ${((performance.now() - t0) / 1000).toFixed(1)} ثانية`);
  check("٧) الاستيراد نجح", c1.status, 201);
  check("٨) اتعمل ١٢٠ شحنة", r1.created, 120);
  check("٩) أكتر من ترانزاكشن واحدة", (r1.chunks ?? 0) > 1, true);
  check("١٠) صفر فشل", r1.failed, 0);

  // ── ٣) النجاح الجزئي: صف فاشل في النص ──
  // نفس merchantReference مرتين → الصف التاني بيرفض بفهرس فريد.
  // الاختبار الحقيقي: الصفوف **اللي بعده** لازم تتعمل عادي.
  console.log("  ── نجاح جزئي (الصف الفاشل مايوقّعش اللي بعده) ──");
  const ref = `REF-${stamp}`;
  const mixed = [
    row(2001, { merchantReference: ref }),
    row(2002, { merchantReference: ref }),   // ← مكرر: لازم يفشل لوحده
    row(2003),
    row(2004, { governorate: "مدينة الأحلام" }), // ← محافظة غلط
    row(2005),
  ];
  const c2 = await api("POST", "/api/v1/imports", { action: "commit", merchantId, rows: mixed });
  const r2 = c2.json as unknown as CommitResult;
  check("١١) اتعمل ٣ من ٥", r2.created, 3);
  check("١٢) فشل ٢", r2.failed, 2);
  check("١٣) الصف المكرر هو اللي فشل", r2.errors?.some((e) => e.index === 1), true);
  check("١٤) الصف اللي بعد الفاشل اتعمل", r2.errors?.some((e) => e.index === 2), false);
  check("١٥) آخر صف اتعمل", r2.errors?.some((e) => e.index === 4), false);
  const dupErr = r2.errors?.find((e) => e.index === 1)?.error ?? "";
  check("١٦) رسالة التكرار واضحة (مش «transaction is aborted»)", /متسجّل قبل كده/.test(dupErr), true);

  // ── ٤) المؤشر: ١٢٣ شحنة اتعملت في نفس اللحظة ──
  console.log("  ── المؤشر (created_at, id) ──");
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const q = `/api/v1/shipments?merchantId=${merchantId}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await api("GET", q);
    const d = page.json as { shipments: { id: string }[]; nextCursor: string | null };
    for (const s of d.shipments) seen.add(s.id);
    pages++;
    cursor = d.nextCursor;
    if (!cursor || pages > 20) break;
  }
  check("١٧) المؤشر اتقسّم على صفحات", pages > 1, true);
  check("١٨) كل الشحنات ظهرت مرة واحدة بالظبط", seen.size, 123);

  console.log("\n" + "─".repeat(56));
  console.log(fail === 0 ? `✅ الاستيراد المجمّع سليم (${pass})` : `❌ ${fail} فشل · ${pass} نجح`);
  console.log("─".repeat(56) + "\n");
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\n❌ وقع:", e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});

// وحدة مستقلة — عشان مايتصادمش مع سكربتات تانية في نطاق TypeScript العام
export {};
