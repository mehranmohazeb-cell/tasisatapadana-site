-- ==========================================================================
-- تأسیسات آپادانا — Migration: استانداردسازی دائمی علائم و واحدهای فنی
-- ==========================================================================
-- این جدول، منبع واحد و قابل‌مدیریت قوانین تبدیل نمایشی متن‌های فنی است.
-- داده خام محصولات (توضیحات، مدل، مشخصات فنی) در D1 دست‌نخورده و ساده
-- باقی می‌ماند؛ این قوانین فقط در لایه نمایش (Backend، قبل از ارسال پاسخ)
-- اعمال می‌شوند.
--
-- rule_type = 'token'  → جایگزینی دقیق یک نماد مستقل (مثلاً Qn → Qₙ)
-- rule_type = 'unit'   → جایگزینی واحد فنی که همیشه بعد از یک عدد می‌آید
--                        (مثلاً «60 C» → «60 °C»)؛ match_value فقط خودِ
--                        نویسه واحد است (C)، نه عدد.
--
-- افزودن قانون جدید (برای هر نماد/واحد فعلی یا آینده) فقط با افزودن یک
-- ردیف جدید انجام می‌شود؛ نیازی به تغییر کد یا Deploy نیست.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/technical-format-rules.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS technical_format_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type     TEXT NOT NULL CHECK (rule_type IN ('token', 'unit')),
  match_value   TEXT NOT NULL,
  display_value TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_technical_format_rules_unique
  ON technical_format_rules(rule_type, match_value);

CREATE INDEX IF NOT EXISTS idx_technical_format_rules_active
  ON technical_format_rules(active);

-- دو نمونه دقیقاً طبق درخواست (Qn → Qₙ و عدد+C → عدد+°C). این‌ها فقط
-- «نمونه‌های پیش‌فرض» هستند؛ سیستم برای هر نماد/واحد دیگری هم به همین شکل
-- کار می‌کند.
INSERT INTO technical_format_rules (rule_type, match_value, display_value, sort_order) VALUES
  ('token', 'Qn', 'Qₙ', 10),
  ('unit',  'C',  '°C', 20);
