-- كشوف المرتجعات: نفس جدول كشوف التوصيل بس بنوع مختلف.
-- من غير العمود ده، إغلاق كشف المرتجعات كان هيعدّ «المسلَّم»
-- (delivered) فيطلع صفر دايمًا — لأن المرتجع بيخلص بحالة
-- returned_to_merchant مش delivered.
ALTER TABLE "run_sheets"
  ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'delivery';

-- فهرس على النوع + الحالة عشان شاشات الكشوف تفلتر بسرعة
CREATE INDEX IF NOT EXISTS "run_sheets_type_status_idx"
  ON "run_sheets" ("type", "status");
