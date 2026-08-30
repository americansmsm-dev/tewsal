-- البروفايل الاحترافي: صورة وعنوان لكل مستخدم (مندوب/تاجر/مدير).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS address   text;
