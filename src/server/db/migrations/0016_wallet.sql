-- محفظة التاجر (مرحلة التعديلات): علامة الأوردر الـwallet
-- حساب MERCHANT_WALLET نفسه بيتعمل تلقائيًا لكل تاجر أول إيداع
-- (زي MERCHANT_PAYABLE) — مفيش صف بذور محتاج.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS is_wallet_order boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- فهرس جزئي بيسرّع حساب المحجوز (شحن الأوردرات الـwallet اللي لسه في الطريق)
CREATE INDEX IF NOT EXISTS shipments_wallet_open_idx
  ON shipments (merchant_id)
  WHERE is_wallet_order = true;
