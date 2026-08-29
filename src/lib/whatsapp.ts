/**
 * ============================================================
 *  مزوّد واتساب — WhatsApp Business Cloud API
 * ------------------------------------------------------------
 *  لو المتغيرات مش متضبطة، الإشعار بيتسجّل «simulated» بدل ما
 *  يتبعت — عشان كل الفلو يشتغل من غير حساب واتساب. لما تتوفر
 *  المفاتيح، بيبعت فعليًا عبر Graph API.
 * ============================================================
 */
export function isWhatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
}

/** رقم مصري 01XXXXXXXXX → صيغة واتساب الدولية 201XXXXXXXXX */
function toIntl(phone: string): string {
  const p = phone.replace(/\D/g, "");
  return p.startsWith("0") ? "2" + p : p.startsWith("2") ? p : "2" + p;
}

/**
 * يبعت رسالة واتساب. بيرمي خطأ لو فشل. مبيتندهش لو مش متضبط
 * (الخدمة الأعلى بتتحقق بـ isWhatsappConfigured الأول).
 */
export async function sendWhatsapp(toPhone: string, body: string): Promise<{ providerId: string }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toIntl(toPhone),
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`واتساب رفض (${res.status}): ${err.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[] };
  return { providerId: json.messages?.[0]?.id ?? "unknown" };
}
