-- ============================================================
--  اشتراكات الإشعارات (Web Push) + تفضيلات المستخدم
-- ------------------------------------------------------------
--  المستخدم الواحد ليه **كذا جهاز**: فون + لاب + تاب في نفس
--  الوقت. كل جهاز اشتراك مستقل، والمفتاح الفريد هو الـendpoint
--  اللي المتصفح بيديه (مش الجهاز ولا المستخدم).
--
--  ⚠️ الاشتراك بيموت من غير ما حد يقولنا (المستخدم شال التطبيق ·
--     مسح بيانات المتصفح · غيّر الجهاز). خدمة الدفع بترد ٤٠٤/٤١٠
--     ساعتها، وإحنا بنشيل الصف. عشان كده فيه failed_at و
--     last_seen_at — نعرف الميت من الحي من غير ما نخمّن.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- عنوان خدمة الدفع بتاعة المتصفح — ده المعرّف الحقيقي للاشتراك
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  -- اسم بيظهر للمستخدم في إعداداته: «فون سامسونج» / «لاب الشغل»
  device_label  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- أول فشل متتالي — بيتصفّر مع أول نجاح
  failed_at     timestamptz
);

-- نفس المتصفح بيرجّع نفس الـendpoint — التسجيل المتكرر بيحدّث مش بيكرّر
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uq
  ON push_subscriptions (endpoint);

-- الإرسال بيبدأ دايمًا من «مين المستلمين؟» → اجيب أجهزتهم
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);

-- ------------------------------------------------------------
--  تفضيلات الإشعارات لكل مستخدم
-- ------------------------------------------------------------
--  الافتراضي: **كل حاجة شغّالة**. الصف بيتعمل بس لما المستخدم
--  يقفل حاجة — يعني غياب الصف = مفعّل، وده اللي بيخلّي إضافة
--  أحداث جديدة تشتغل لوحدها من غير ما نلمس صفوف قديمة.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- اسم الحدث (delivered · settlement_paid · …) أو '*' لكل الأحداث
  event     text NOT NULL,
  -- 'inapp' جوّه السيستم · 'push' على الجهاز
  channel   text NOT NULL,
  enabled   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event, channel)
);

COMMENT ON TABLE notification_prefs IS
  'غياب الصف = مفعّل. الصف بيتكتب بس لما المستخدم يقفل حدث/قناة.';
