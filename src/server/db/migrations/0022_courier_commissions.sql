-- محاسبة عمولات المناديب — المحاسب هو اللي بيحدد المبلغ ويأكّده.
-- السيستم بيقترح (عدد الأوردرات × السعر الافتراضي) والمحاسب يعدّل قبل التسجيل.
CREATE TABLE IF NOT EXISTS "courier_commissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "courier_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "shipments_count" integer NOT NULL DEFAULT 0,
  "amount_per_order_p" bigint NOT NULL DEFAULT 0,
  "total_p" bigint NOT NULL DEFAULT 0,
  "note" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE restrict,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "courier_commissions_code_uq" ON "courier_commissions" ("code");
CREATE INDEX IF NOT EXISTS "courier_commissions_courier_idx" ON "courier_commissions" ("courier_id", "created_at");

-- كل أوردر يتحاسب عليه **مرة واحدة بس** — الفهرس الفريد هو الضمان
CREATE TABLE IF NOT EXISTS "courier_commission_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "commission_id" uuid NOT NULL REFERENCES "courier_commissions"("id") ON DELETE cascade,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE restrict,
  "amount_p" bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "courier_commission_items_shipment_uq" ON "courier_commission_items" ("shipment_id");
CREATE INDEX IF NOT EXISTS "courier_commission_items_commission_idx" ON "courier_commission_items" ("commission_id");
