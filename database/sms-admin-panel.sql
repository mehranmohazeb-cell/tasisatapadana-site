-- ==========================================================================
-- تأسیسات آپادانا — Migration: SMS Template Admin Overrides
-- ==========================================================================
--
-- کاملاً افزودنی است: فقط یک جدول جدید می‌سازد (CREATE TABLE IF NOT EXISTS).
-- هیچ DROP/DELETE/TRUNCATE و هیچ تغییری روی جدول‌های قبلی
-- (customers, otp_codes, sms_messages, orders, tickets, ...) انجام نمی‌دهد.
--
-- این جدول overlay مدیر روی Template Registry مرکزی (در src/index.js) است:
-- Registry پایه در کد باقی می‌ماند (منبع عنوان/دسته/متغیرها)، ولی مدیر از
-- پنل مدیریت می‌تواند برای هر eventType مقدار template_id یا enabled را
-- override کند — بدون نیاز به ویرایش کد یا Deploy مجدد.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/sms-admin-panel.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sms_template_settings (
  event_type   TEXT PRIMARY KEY,
  template_id  INTEGER,
  enabled      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
