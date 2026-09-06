-- الإشعارات الداخلية — صندوق وارد لكل مستخدم (مندوب/تاجر/إدارة).
-- مختلف عن notification_log (اللي للعميل عبر واتساب): ده جوّه السيستم،
-- بيتقرا بالجرس والبولنج، وبيتبعت تلقائي عند الأحداث أو يدويًا من المالك.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "event" text NOT NULL,
  "title_ar" text NOT NULL,
  "body_ar" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" ("user_id", "is_read", "created_at");
