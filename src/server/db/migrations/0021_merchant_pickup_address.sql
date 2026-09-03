-- عنوان استلام محفوظ للتاجر — بيكتبه مرة واحدة ويقدر يعدّله،
-- بدل ما يعيد كتابته في كل طلب استلام.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pickup_address text;
