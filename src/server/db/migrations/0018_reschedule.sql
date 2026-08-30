-- تأجيل التسليم: المندوب يعلّم الأوردر «مؤجل» لتاريخ إعادة محاولة.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz;
