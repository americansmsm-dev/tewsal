/**
 * ============================================================
 *  توكنات الـ API والويب-هوك — مرحلة ح
 * ------------------------------------------------------------
 *  توكنات التجار (hash فقط، التوكن بيتعرض مرة واحدة) +
 *  نقاط الويب-هوك + إرسال الأحداث (best-effort بعد الترانزاكشن).
 * ============================================================
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}
function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

// ---------------------------------------------------------------
// التوكنات
// ---------------------------------------------------------------

export async function createToken(ex: SqlExecutor, input: { merchantId: string; name: string; actorUserId: string | null }): Promise<{ token: string; prefix: string }> {
  const raw = "tw_" + randomBytes(24).toString("hex");
  const prefix = raw.slice(0, 10);
  await ex.execute(sql`
    INSERT INTO api_tokens (merchant_id, name, token_hash, prefix, created_by)
    VALUES (${input.merchantId}::uuid, ${input.name}, ${hashToken(raw)}, ${prefix}, ${input.actorUserId ?? null}::uuid)`);
  return { token: raw, prefix };
}

/** مصادقة توكن الـ API → بيرجّع merchantId أو يرمي 401. */
export async function authToken(ex: SqlExecutor, raw: string): Promise<{ merchantId: string }> {
  if (!raw?.startsWith("tw_")) throw new HttpError(401, "BAD_TOKEN", "توكن غير صالح");
  const t = rowsOf<{ id: string; merchant_id: string }>(
    await ex.execute(sql`SELECT id::text, merchant_id::text FROM api_tokens WHERE token_hash = ${hashToken(raw)} AND is_active = true LIMIT 1`)
  )[0];
  if (!t) throw new HttpError(401, "BAD_TOKEN", "توكن غير صالح أو موقوف");
  await ex.execute(sql`UPDATE api_tokens SET last_used_at = now() WHERE id = ${t.id}::uuid`);
  return { merchantId: t.merchant_id };
}

export async function listTokens(ex: SqlExecutor, merchantId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`SELECT id::text, name, prefix, is_active, last_used_at, created_at FROM api_tokens WHERE merchant_id = ${merchantId}::uuid ORDER BY created_at DESC`)
  );
}
export async function revokeToken(ex: SqlExecutor, tokenId: string): Promise<{ revoked: boolean }> {
  await ex.execute(sql`UPDATE api_tokens SET is_active = false WHERE id = ${tokenId}::uuid`);
  return { revoked: true };
}

// ---------------------------------------------------------------
// الويب-هوك
// ---------------------------------------------------------------

export async function registerWebhook(ex: SqlExecutor, input: { merchantId: string; url: string; events?: string }): Promise<{ id: string }> {
  if (!/^https?:\/\//.test(input.url)) throw new HttpError(422, "BAD_URL", "الرابط لازم http/https");
  const id = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO webhook_endpoints (merchant_id, url, events, secret)
      VALUES (${input.merchantId}::uuid, ${input.url}, ${input.events ?? "*"}, ${"whsec_" + randomBytes(12).toString("hex")})
      RETURNING id::text`)
  )[0]!.id;
  return { id };
}
export async function listWebhooks(ex: SqlExecutor, merchantId: string) {
  return rowsOf<Record<string, unknown>>(
    await ex.execute(sql`SELECT id::text, url, events, is_active, created_at FROM webhook_endpoints WHERE merchant_id = ${merchantId}::uuid ORDER BY created_at DESC`)
  );
}
export async function deleteWebhook(ex: SqlExecutor, id: string): Promise<{ deleted: boolean }> {
  await ex.execute(sql`DELETE FROM webhook_endpoints WHERE id = ${id}::uuid`);
  return { deleted: true };
}

/**
 * إرسال حدث للويب-هوك — **best-effort بعد الترانزاكشن**. بينده
 * بـ db (مش tx) عشان مايعطّلش تغيير الحالة. بيسجّل كل محاولة.
 */
export async function fireWebhooks(ex: SqlExecutor, input: { merchantId: string; event: string; payload: unknown }): Promise<void> {
  const eps = rowsOf<{ id: string; url: string; secret: string | null }>(
    await ex.execute(sql`
      SELECT id::text, url, secret FROM webhook_endpoints
      WHERE merchant_id = ${input.merchantId}::uuid AND is_active = true
        AND (events = '*' OR events LIKE ${"%" + input.event + "%"})`)
  );
  await Promise.all(eps.map(async (e) => {
    let code: number | null = null, ok = false, error: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(e.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tewsal-event": input.event, ...(e.secret ? { "x-tewsal-signature": e.secret } : {}) },
        body: JSON.stringify({ event: input.event, data: input.payload }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      code = res.status; ok = res.ok;
    } catch (err) {
      error = err instanceof Error ? err.message : "فشل الإرسال";
    }
    await ex.execute(sql`INSERT INTO webhook_deliveries (endpoint_id, event, status_code, ok, error) VALUES (${e.id}::uuid, ${input.event}, ${code}, ${ok}, ${error})`);
  }));
}
