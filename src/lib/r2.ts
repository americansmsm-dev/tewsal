/**
 * ============================================================
 *  Cloudflare R2 — تخزين صور الإثبات والتوقيعات
 * ------------------------------------------------------------
 *  المندوب بيرفع الصورة **مباشرة** لـ R2 عبر رابط presigned PUT
 *  (مش عبر السيرفر) — أسرع وأخف على السيرفر. السيرفر بيسجّل
 *  المفتاح (r2Key) بس في shipment_attachments.
 *
 *  ⚠️ لو R2 مش متضبط (مفيش مفاتيح) الدوال بترمي خطأ واضح،
 *     والـ endpoint بيرجّع 503 — عشان باقي السيستم يفضل شغّال.
 *     تسجيل المرفق نفسه (المفتاح) بيشتغل من غير R2.
 * ============================================================
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** أنواع المرفقات المسموحة */
export const ATTACHMENT_KINDS = ["pod_photo", "signature", "damage", "id_photo", "packaging"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS_AR: Record<AttachmentKind, string> = {
  pod_photo: "صورة إثبات التسليم",
  signature: "توقيع",
  damage: "صورة تلف",
  id_photo: "صورة بطاقة",
  packaging: "صورة التغليف",
};

/** الامتدادات ونوع المحتوى المسموح — صور بس */
const CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

export function extForContentType(contentType: string): string | null {
  return CONTENT_TYPES[contentType] ?? null;
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (!isR2Configured()) {
    throw new Error("R2 مش متضبط — محتاج R2_ACCOUNT_ID و R2_ACCESS_KEY_ID و R2_SECRET_ACCESS_KEY و R2_BUCKET");
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

/** مفتاح تخزين منظّم: shipments/{id}/{kind}/{uuid}.{ext} */
export function buildKey(shipmentId: string, kind: string, ext: string): string {
  return `shipments/${shipmentId}/${kind}/${crypto.randomUUID()}.${ext}`;
}

/** رابط رفع مؤقت (PUT) — صالح ٥ دقايق */
export async function presignPut(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: 300 });
}

/** رابط عرض مؤقت (GET) — صالح ١٥ دقيقة */
export async function presignGet(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: 900 });
}

/**
 * رفع ملف لـ R2 **من السيرفر مباشرة** (مش عبر المتصفح) —
 * كده مفيش حاجة اسمها CORS، والرفع بيشتغل فورًا. مناسب لصور
 * الإثبات الصغيرة اللي المندوب بيرفعها عبر الـ API.
 */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await client().send(cmd);
}
