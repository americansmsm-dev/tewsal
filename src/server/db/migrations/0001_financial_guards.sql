-- ============================================================
--  الحُرّاس المالية — قيود على مستوى قاعدة البيانات
-- ------------------------------------------------------------
--  ⚠️ الملف ده هو اللي بيخلي ضياع الفلوس **مستحيل هيكليًا**.
--     كل قيد هنا بيشتغل حتى لو الكود فيه بق.
-- ============================================================

-- ------------------------------------------------------------
-- ١) تسلسل رقم البوليصة
-- ------------------------------------------------------------
-- ⚠️ لازم SEQUENCE مش MAX()+1 — ده اللي بيمنع البوالص المكررة
--    وقت الإنشاء المتزامن أو بعد استرجاع نسخة احتياطية.
CREATE SEQUENCE IF NOT EXISTS awb_sequence
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

COMMENT ON SEQUENCE awb_sequence IS
  'تسلسل رقم البوليصة — استخدم nextval() فقط، ممنوع MAX()+1';


-- ------------------------------------------------------------
-- ٢) ⚠️ أهم قيد في السيستم كله: توازن القيد المحاسبي
-- ------------------------------------------------------------
-- بيتحقق عند COMMIT (DEFERRABLE) عشان نقدر نضيف السطور
-- واحد ورا التاني جوه نفس الترانزاكشن.
--
-- لو مجموع المدين != مجموع الدائن لأي قيد -> الترانزاكشن
-- كلها بترجع. مفيش طريقة يعدي بيها قيد غير متوازن.

CREATE OR REPLACE FUNCTION assert_journal_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_id   uuid;
  v_debits     bigint;
  v_credits    bigint;
  v_line_count int;
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  SELECT COALESCE(SUM(debit_p), 0),
         COALESCE(SUM(credit_p), 0),
         COUNT(*)
    INTO v_debits, v_credits, v_line_count
    FROM journal_lines
   WHERE entry_id = v_entry_id;

  -- القيد اتمسح بالكامل (cascade) — مفيش حاجة نتحقق منها
  IF v_line_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION
      'القيد % لازم يكون فيه سطرين على الأقل (لقينا %)',
      v_entry_id, v_line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION
      'قيد غير متوازن! القيد %: مدين % قرش ≠ دائن % قرش (الفرق %)',
      v_entry_id, v_debits, v_credits, ABS(v_debits - v_credits)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_journal_entry_balanced();

COMMENT ON FUNCTION assert_journal_entry_balanced() IS
  'بيرفض أي قيد يومية مش متوازن — بيشتغل عند COMMIT';


-- ------------------------------------------------------------
-- ٣) القيود متتعدلش ومتتمسحش أبدًا
-- ------------------------------------------------------------
-- الغلط بيتصلّح بقيد عكسي جديد، مش بتعديل القديم.
-- ده بيخلي التاريخ المالي كامل ومحدش يقدر يمسح أثره.

CREATE OR REPLACE FUNCTION forbid_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ممنوع تعديل أو حذف القيود المحاسبية — استخدم قيد عكسي (reversal)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  WHEN (OLD.posted_at IS NOT NULL)
  EXECUTE FUNCTION forbid_journal_mutation();


-- ------------------------------------------------------------
-- ٤) تاريخ الحالات إضافة فقط
-- ------------------------------------------------------------
-- الرسالة بتتغيّر حسب الجدول — عشان اللي يقرا الخطأ يعرف
-- بالظبط إيه اللي اتمنع، مش رسالة عامة مضلّلة.
CREATE OR REPLACE FUNCTION forbid_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ممنوع تعديل أو حذف % — السجل إضافة فقط',
    CASE TG_TABLE_NAME
      WHEN 'shipment_status_history' THEN 'تاريخ حالات الشحنة'
      WHEN 'audit_log'               THEN 'سجل التدقيق'
      WHEN 'scan_events'             THEN 'أحداث المسح'
      ELSE TG_TABLE_NAME
    END
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_history_append_only
  BEFORE UPDATE OR DELETE ON shipment_status_history
  FOR EACH ROW
  EXECUTE FUNCTION forbid_history_mutation();


-- ------------------------------------------------------------
-- ٥) سجل التدقيق إضافة فقط
-- ------------------------------------------------------------
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION forbid_history_mutation();


-- ------------------------------------------------------------
-- ٦) الشحنة مستحيل تدخل تسويتين
-- ------------------------------------------------------------
-- (الفهرس الفريد على settlement_items.shipment_id بيعمل ده،
--  والقيد ده طبقة تانية بتمنع التعديل بعد الدفع)
CREATE OR REPLACE FUNCTION forbid_paid_settlement_change()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM settlements WHERE id = COALESCE(NEW.settlement_id, OLD.settlement_id);
  IF v_status = 'paid' THEN
    RAISE EXCEPTION
      'ممنوع تعديل بنود تسوية مدفوعة — استخدم تسوية تعديلية'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_settlement_items_locked
  BEFORE INSERT OR UPDATE OR DELETE ON settlement_items
  FOR EACH ROW
  EXECUTE FUNCTION forbid_paid_settlement_change();


-- ------------------------------------------------------------
-- ٧) فهارس البحث العربي السريع (pg_trgm)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS shipments_recipient_name_trgm
  ON shipments USING gin (recipient_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS shipments_address_trgm
  ON shipments USING gin (address_line gin_trgm_ops);


-- ------------------------------------------------------------
-- ٨) قيود منطقية على الشحنات
-- ------------------------------------------------------------
ALTER TABLE shipments
  ADD CONSTRAINT shipments_amounts_non_negative
  CHECK (
    cod_amount_p     >= 0 AND
    declared_value_p >= 0 AND
    price_p          >= 0 AND
    pieces_count     >= 1
  );

-- التأمين على القابل للكسر ملوش معنى لو الشحنة مش قابلة للكسر
ALTER TABLE shipments
  ADD CONSTRAINT shipments_fragile_logic
  CHECK (NOT (fragile_insured AND NOT is_fragile));

COMMENT ON COLUMN shipments.price_p IS
  'السعر وقت الإنشاء — مُثبّت، ممنوع إعادة حسابه';
COMMENT ON COLUMN shipment_status_history.recorded_at IS
  'ساعة السيرفر — ⚠️ دي اللي المالية بتقراها، مش occurred_at';
