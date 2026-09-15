-- ==========================================================================
-- تأسیسات آپادانا — Migration: OTP Engine + SMS History + Customer Profile
-- ==========================================================================
--
-- این migration کاملاً افزودنی (additive) است:
--   - فقط جدول جدید می‌سازد (CREATE TABLE IF NOT EXISTS)
--   - فقط ستون جدید به جدول موجود «customers» اضافه می‌کند (ALTER TABLE ADD COLUMN)
--   - هیچ DROP، DELETE، TRUNCATE یا تغییر مخربی روی داده‌های موجود انجام نمی‌دهد.
--   - هیچ جدول یا ستون قبلی (products, orders, tickets, customers, customer_sessions, ...)
--     تغییر یا حذف نمی‌شود؛ فقط ستون‌های تازه به customers اضافه می‌شوند.
--
-- نکته اجرا (مثل migrationهای قبلی پروژه):
-- SQLite/D1 از "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" پشتیبانی نمی‌کند.
-- این فایل قرار است فقط یک‌بار روی دیتابیس فعلی اجرا شود. اگر بخشی از آن
-- قبلاً اجرا شده، همان بخش را قبل از اجرای دوباره حذف کنید تا خطای
-- "duplicate column name" نگیرید.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/otp-and-sms-history.sql
-- (برای تست محلی، پرچم --remote را حذف کنید.)
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) ستون‌های افزودنی روی customers (بخش ۱۹ / پروفایل مشتری)
--    مقدار پیش‌فرض phone_verified برای ردیف‌های قبلی هم 0 می‌شود؛ یک UPDATE
--    جداگانه در پایین همین فایل، مشتریان از قبل موجود (که با موفقیت
--    ثبت‌نام/ورود کرده‌اند) را verified علامت می‌زند تا رفتار فعلی سایت برای
--    آنها تغییر نکند. ورود با رمز عبور اصلاً به phone_verified وابسته نیست،
--    پس این ستون برای کاربران قبلی صرفاً اطلاعاتی است، نه مسدودکننده.
-- --------------------------------------------------------------------------

ALTER TABLE customers ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN birthday TEXT;
ALTER TABLE customers ADD COLUMN sms_marketing_consent INTEGER NOT NULL DEFAULT 0;

-- مشتریان از قبل موجود (پیش از این migration) از قبل با موفقیت وارد سایت
-- شده‌اند؛ آنها را verified علامت می‌زنیم تا داده‌ها بی‌دلیل ناقص به‌نظر نرسند.
-- این UPDATE هیچ داده‌ای را حذف یا خراب نمی‌کند، فقط یک ستون تازه را پر می‌کند.
UPDATE customers SET phone_verified = 1 WHERE phone_verified = 0;


-- --------------------------------------------------------------------------
-- 2) آماده‌سازی یادآوری سرویس دوره‌ای (بخش ۲۰) — فعلاً فقط ستون‌ها،
--    بدون هیچ منطق Cron فعال (طبق دستور: فقط architecture آماده شود)
-- --------------------------------------------------------------------------

ALTER TABLE customers ADD COLUMN last_service_at TEXT;
ALTER TABLE customers ADD COLUMN next_service_at TEXT;


-- --------------------------------------------------------------------------
-- 3) کدهای یک‌بار مصرف (OTP) — بخش ۸ و ۹
--    کد خام هرگز ذخیره نمی‌شود؛ فقط code_hash (خروجی همان تابع hashPassword
--    موجود در src/index.js، برای جلوگیری از تکرار منطق رمزنگاری).
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS otp_codes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile            TEXT NOT NULL,
  code_hash         TEXT NOT NULL,
  purpose           TEXT NOT NULL,       -- register | login | password_reset | phone_change
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | verified
  expires_at        TEXT NOT NULL,
  consumed_at       TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_mobile_purpose
  ON otp_codes (mobile, purpose, created_at);


-- --------------------------------------------------------------------------
-- 4) تاریخچه مرکزی پیامک‌ها (بخش ۱۴) — برای audit/debugging/گزارش‌گیری آینده
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sms_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         INTEGER,
  mobile              TEXT NOT NULL,
  event_type          TEXT NOT NULL,     -- کلید Template Registry، مثل AUTH_VERIFY
  purpose             TEXT,              -- برای OTPها: register | login | password_reset | phone_change
  template_id         INTEGER,           -- NULL یعنی هنوز template واقعی نداشت و ارسال نشد
  status              TEXT NOT NULL,     -- sent | failed | skipped_no_template
  provider            TEXT NOT NULL DEFAULT 'sms.ir',
  provider_message_id TEXT,
  error_code          TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at             TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_mobile ON sms_messages (mobile);
CREATE INDEX IF NOT EXISTS idx_sms_messages_event_type ON sms_messages (event_type);
