-- قطع الأوردر (تعديل ٢): التسليم/الاستلام الجزئي بالقطعة
CREATE TABLE IF NOT EXISTS shipment_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  name_ar       text NOT NULL,
  sku           text,
  qty           integer NOT NULL DEFAULT 1,
  unit_price_p  bigint NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending',  -- pending · delivered · returned
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shipment_items_shipment_idx ON shipment_items (shipment_id);
