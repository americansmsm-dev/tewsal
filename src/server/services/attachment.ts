/**
 * ============================================================
 *  مرفقات الشحنة — Attachments (صور الإثبات والتوقيعات)
 * ------------------------------------------------------------
 *  presignUpload   — يطلّع رابط رفع مؤقت لـ R2 (المندوب بيرفع مباشرة).
 *  recordAttachment — يسجّل المفتاح في shipment_attachments بعد الرفع.
 *  listAttachments  — يرجّع مرفقات الشحنة + روابط عرض مؤقتة.
 *
 *  ⚠️ الرفع بيروح R2 مباشرة (مش عبر السيرفر). لو R2 مش متضبط،
 *     الـ presign بيرجّع 503 لكن التسجيل والعرض بيشتغلوا.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import {
  isR2Configured,
  presignPut,
  presignGet,
  putObject,
  buildKey,
  extForContentType,
  ATTACHMENT_KINDS,
  type AttachmentKind,
} from "@/lib/r2";
import { type SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "rows" in r) return (r as { rows: T[] }).rows;
  return [];
}

const KINDS = new Set<string>(ATTACHMENT_KINDS as readonly string[]);

async function assertShipment(ex: SqlExecutor, shipmentId: string): Promise<void> {
  const s = rowsOf<{ id: string }>(
    await ex.execute(sql`SELECT id FROM shipments WHERE id = ${shipmentId}::uuid LIMIT 1`)
  )[0];
  if (!s) throw new HttpError(404, "NOT_FOUND", "الشحنة مش موجودة");
}

/** رابط رفع مؤقت لصورة إثبات. بيرجّع المفتاح اللي هيتسجّل بعد الرفع. */
export async function presignUpload(
  ex: SqlExecutor,
  input: { shipmentId: string; kind: string; contentType: string }
): Promise<{ uploadUrl: string; key: string; expiresInSec: number }> {
  if (!KINDS.has(input.kind)) throw new HttpError(400, "BAD_KIND", "نوع المرفق مش معروف");
  const ext = extForContentType(input.contentType);
  if (!ext) throw new HttpError(400, "BAD_TYPE", "نوع الملف لازم يكون صورة (jpg/png/webp)");
  if (!isR2Configured()) {
    throw new HttpError(503, "R2_NOT_CONFIGURED", "تخزين الصور (R2) مش متضبط لسه — محتاج مفاتيح R2");
  }
  await assertShipment(ex, input.shipmentId);

  const key = buildKey(input.shipmentId, input.kind, ext);
  const uploadUrl = await presignPut(key, input.contentType);
  return { uploadUrl, key, expiresInSec: 300 };
}

/** الحد الأقصى لحجم صورة الإثبات (٦ ميجا) */
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/**
 * رفع صورة إثبات عبر السيرفر (المندوب بيبعت الصورة للـ API،
 * والسيرفر يرفعها لـ R2). مفيش CORS، بيشتغل فورًا.
 */
export async function uploadAttachment(
  ex: SqlExecutor,
  input: { shipmentId: string; kind: string; contentType: string; bytes: Uint8Array; actorUserId: string | null }
): Promise<{ attachmentId: string; key: string }> {
  if (!KINDS.has(input.kind)) throw new HttpError(400, "BAD_KIND", "نوع المرفق مش معروف");
  const ext = extForContentType(input.contentType);
  if (!ext) throw new HttpError(400, "BAD_TYPE", "نوع الملف لازم يكون صورة (jpg/png/webp)");
  if (input.bytes.byteLength === 0) throw new HttpError(400, "EMPTY", "الملف فاضي");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, "TOO_LARGE", "الصورة أكبر من ٦ ميجا");
  if (!isR2Configured()) throw new HttpError(503, "R2_NOT_CONFIGURED", "تخزين الصور (R2) مش متضبط لسه");
  await assertShipment(ex, input.shipmentId);

  const key = buildKey(input.shipmentId, input.kind, ext);
  await putObject(key, input.bytes, input.contentType);
  const rec = await recordAttachment(ex, {
    shipmentId: input.shipmentId, kind: input.kind, r2Key: key,
    sizeBytes: input.bytes.byteLength, actorUserId: input.actorUserId,
  });
  return { attachmentId: rec.attachmentId, key };
}

/** تسجيل مرفق بعد رفعه (أو ربط مفتاح من التحول). آمن للتكرار على نفس المفتاح. */
export async function recordAttachment(
  ex: SqlExecutor,
  input: {
    shipmentId: string;
    kind: string;
    r2Key: string;
    sha256?: string | null;
    sizeBytes?: number | null;
    actorUserId: string | null;
  }
): Promise<{ attachmentId: string; alreadyExists: boolean }> {
  if (!KINDS.has(input.kind)) throw new HttpError(400, "BAD_KIND", "نوع المرفق مش معروف");
  if (!input.r2Key?.trim()) throw new HttpError(400, "BAD_KEY", "مفتاح الملف ناقص");
  await assertShipment(ex, input.shipmentId);

  // نفس المفتاح مبيتسجّلش مرتين
  const existing = rowsOf<{ id: string }>(
    await ex.execute(sql`SELECT id::text FROM shipment_attachments WHERE r2_key = ${input.r2Key} LIMIT 1`)
  )[0];
  if (existing) return { attachmentId: existing.id, alreadyExists: true };

  const row = rowsOf<{ id: string }>(
    await ex.execute(sql`
      INSERT INTO shipment_attachments (shipment_id, kind, r2_key, sha256, size_bytes, uploaded_by)
      VALUES (${input.shipmentId}::uuid, ${input.kind}, ${input.r2Key},
              ${input.sha256 ?? null}, ${input.sizeBytes ?? null}, ${input.actorUserId ?? null}::uuid)
      RETURNING id::text
    `)
  )[0]!;
  return { attachmentId: row.id, alreadyExists: false };
}

export interface AttachmentView {
  id: string;
  kind: string;
  r2Key: string;
  sizeBytes: number | null;
  uploadedAt: string;
  /** رابط عرض مؤقت — null لو R2 مش متضبط */
  viewUrl: string | null;
}

/** مرفقات الشحنة + روابط عرض مؤقتة (لو R2 متضبط). */
export async function listAttachments(
  ex: SqlExecutor,
  shipmentId: string
): Promise<AttachmentView[]> {
  const rows = rowsOf<{
    id: string; kind: string; r2_key: string; size_bytes: number | null; uploaded_at: string;
  }>(
    await ex.execute(sql`
      SELECT id::text, kind, r2_key, size_bytes, uploaded_at::text
      FROM shipment_attachments WHERE shipment_id = ${shipmentId}::uuid
      ORDER BY uploaded_at
    `)
  );
  const configured = isR2Configured();
  const out: AttachmentView[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      kind: r.kind,
      r2Key: r.r2_key,
      sizeBytes: r.size_bytes,
      uploadedAt: r.uploaded_at,
      viewUrl: configured ? await presignGet(r.r2_key) : null,
    });
  }
  return out;
}

export function attachmentKinds(): readonly AttachmentKind[] {
  return ATTACHMENT_KINDS;
}
