-- ============================================================
--  فهارس القدرة — الطريق لـ١٠ آلاف أوردر/يوم
-- ------------------------------------------------------------
--  كل فهرس هنا مربوط باستعلام حقيقي بيتنفّذ في السيستم:
--  مفيش فهرس «احتياطي» — الفهرس الزيادة بيبطّئ الكتابة.
--
--  ⚠️ الهجرة بتتنفّذ جوّه ترانزاكشن، فمفيش CONCURRENTLY. على
--  قاعدة فيها ملايين الصفوف ده بيقفل الكتابة لدقايق — نفّذها
--  في وقت هادي، أو اعمل الفهارس يدويًا بـ CONCURRENTLY الأول
--  (الـ IF NOT EXISTS هيخلّي الهجرة تعدّي من غير ما تعيدها).
-- ============================================================

-- ------------------------------------------------------------
-- ١) الشاشة الرئيسية: ORDER BY created_at DESC
-- ------------------------------------------------------------
-- كان مفيش فهرس على created_at لوحده → مسح كامل للجدول + فرز
-- في كل فتحة للصفحة. الـ id في الفهرس عشان المؤشر (cursor)
-- يبقى (created_at, id) فمايتخطّاش صفوف اتعملت في نفس اللحظة.
CREATE INDEX IF NOT EXISTS shipments_created_id_idx
  ON shipments (created_at DESC, id DESC);

-- نفس الشاشة مع فلتر الحالة (أكتر استخدام: «قيد التوصيل»، «مرتجعات»)
CREATE INDEX IF NOT EXISTS shipments_status_created_idx
  ON shipments (status, created_at DESC, id DESC);

-- ------------------------------------------------------------
-- ٢) البحث: awb / رقم الموبايل بـ ILIKE '%...%'
-- ------------------------------------------------------------
-- الفهرس الفريد على awb والـ btree على الموبايل مابيخدموش
-- البحث بالاحتواء — لازم trgm (زي ما اتعمل للاسم والعنوان
-- في 0001). من غيرهم كل بحث = مسح كامل.
CREATE INDEX IF NOT EXISTS shipments_awb_trgm
  ON shipments USING gin (awb gin_trgm_ops);

CREATE INDEX IF NOT EXISTS shipments_phone_trgm
  ON shipments USING gin (recipient_phone gin_trgm_ops);

-- ------------------------------------------------------------
-- ٣) تاريخ الحالات: «امتى اتسلّمت من التاجر؟»
-- ------------------------------------------------------------
-- الاستعلام الفرعي في قائمة الشحنات بيدوّر على to_status = 'picked_up'
-- لكل صف. ssh_shipment_idx بيرتّب بـ recorded_at مش to_status.
CREATE INDEX IF NOT EXISTS ssh_shipment_status_idx
  ON shipment_status_history (shipment_id, to_status, occurred_at);

-- ------------------------------------------------------------
-- ٤) اليومية: ORDER BY entry_no DESC
-- ------------------------------------------------------------
-- bigserial **مش** بيعمل فهرس. تقرير اليومية كان بيمسح الدفتر كله.
CREATE INDEX IF NOT EXISTS je_entry_no_idx
  ON journal_entries (entry_no DESC);

-- سطور الحساب الواحد مرتبطة بقيودها — مسار رصيد التاجر والعهدة
CREATE INDEX IF NOT EXISTS jl_account_entry_idx
  ON journal_lines (account_id, entry_id);

-- ------------------------------------------------------------
-- ٥) الإشعارات: بيتنده كل ٢٠ ثانية لكل مستخدم
-- ------------------------------------------------------------
-- notifications_user_idx = (user_id, is_read, created_at) — الترتيب
-- ده مابيخدمش ORDER BY created_at DESC للمستخدم الواحد.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

-- ------------------------------------------------------------
-- ٦) فهرس ميت — بيتشال
-- ------------------------------------------------------------
-- journal_lines.courier_id بيتكتب بس عمره ما اتقرا في WHERE
-- (كل الاستعلامات بتفلتر بـ accounts.owner_id). فهرس بيتصان
-- على كل سطر يومية من غير فايدة.
-- (jl_merchant_idx بيفضل — مستخدم في فحص حذف التاجر.)
DROP INDEX IF EXISTS jl_courier_idx;
