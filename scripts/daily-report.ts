/**
 * ============================================================
 *  التقرير اليومي — مرحلة ك
 * ------------------------------------------------------------
 *  ملخّص يومي بحالة الفلوس: الفروقات، التعديلات اليدوية،
 *  العكوسات، تحصيل مختلف، الخصومات المعلّقة، إشعارات اليوم.
 *  بيتطبع في الكونسول، وبيتبعت واتساب لو WHATSAPP + REPORT_PHONE
 *  متضبطين (وإلا بيتطبع بس).
 *
 *  الاستخدام: npm run daily-report   (أو كرون يومي الصبح)
 * ============================================================
 */
import postgres from "postgres";

function egp(p: bigint | string): string {
  const v = BigInt(p || "0");
  const neg = v < 0n; const a = neg ? -v : v;
  return `${neg ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${(a % 100n).toString().padStart(2, "0")} ج`;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/tewsal", { max: 1 });
  try {
    const [rev] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM journal_entries WHERE is_reversal=true AND entry_date::date=now()::date`;
    const [manual] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type='manual' AND kind NOT IN ('expense','storage_fee') AND entry_date::date=now()::date`;
    const [ded] = await sql<{ n: number; s: string }[]>`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_p),0)::text AS s FROM courier_deductions WHERE status='pending'`;
    const [over] = await sql<{ s: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p),0)::text AS s FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code='CASH_OVER_SUSPENSE'`;
    const [notif] = await sql<{ sent: number; sim: number; cost: string }[]>`
      SELECT COUNT(*) FILTER (WHERE status='sent')::int AS sent, COUNT(*) FILTER (WHERE status='simulated')::int AS sim,
             COALESCE(SUM(cost_p),0)::text AS cost FROM notification_log WHERE created_at::date=now()::date`;
    const [profit] = await sql<{ r: string; e: string }[]>`
      SELECT COALESCE(SUM(jl.credit_p - jl.debit_p) FILTER (WHERE a.type='revenue'),0)::text AS r,
             COALESCE(SUM(jl.debit_p - jl.credit_p) FILTER (WHERE a.type='expense'),0)::text AS e
      FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id`;
    const [today] = await sql<{ delivered: number; cod: string }[]>`
      SELECT COUNT(*)::int AS delivered, COALESCE(SUM(cod_collected_p),0)::text AS cod
      FROM shipments WHERE status IN ('delivered','partially_delivered') AND delivered_at::date=now()::date`;

    const netProfit = BigInt(profit!.r) - BigInt(profit!.e);
    const flags = Number(rev!.n) + Number(manual!.n) + (Number(ded!.n) > 0 ? 1 : 0) + (BigInt(over!.s) > 0n ? 1 : 0);

    const lines = [
      `📊 تقرير توصّل اليومي — ${new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "full" }).format(new Date())}`,
      ``,
      `🚚 تسليمات النهاردة: ${today!.delivered} · تحصيل ${egp(today!.cod)}`,
      `💰 صافي الربح التراكمي: ${egp(netProfit.toString())}`,
      ``,
      `⚠️ نقاط انتباه:`,
      `• عكوسات النهاردة: ${rev!.n}`,
      `• تعديلات يدوية: ${manual!.n}`,
      `• خصومات مناديب معلّقة: ${ded!.n} (${egp(ded!.s)})`,
      `• زيادة نقدية معلّقة: ${egp(over!.s)}`,
      ``,
      `📩 إشعارات اليوم: ${notif!.sent} مبعوت · ${notif!.sim} محاكاة · تكلفة ${egp(notif!.cost)}`,
      ``,
      flags === 0 ? `✅ مفيش نقاط حرجة النهاردة` : `⛔ ${flags} نقطة محتاجة مراجعة`,
    ];
    const report = lines.join("\n");
    console.log("\n" + report + "\n");

    // إرسال واتساب لو متضبط
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.REPORT_PHONE) {
      const p = process.env.REPORT_PHONE.replace(/\D/g, "");
      const to = p.startsWith("0") ? "2" + p : p;
      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: report } }),
      });
      console.log(res.ok ? "✅ التقرير اتبعت واتساب" : `⚠️ فشل إرسال الواتساب (${res.status})`);
    } else {
      console.log("ℹ️ الواتساب مش متضبط — التقرير اتطبع بس (أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID و REPORT_PHONE للإرسال)");
    }
    await sql.end();
  } catch (err) {
    console.error("❌ فشل التقرير:", err instanceof Error ? err.message : err);
    await sql.end();
    process.exitCode = 1;
  }
}
main();
