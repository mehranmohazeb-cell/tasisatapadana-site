-- ==========================================================================
-- تأسیسات آپادانا — Migration: وضعیت عملیاتی سراسری فروشگاه/خدمات
-- ==========================================================================
--
-- این Migration مستقل و افزودنی است (فقط CREATE TABLE IF NOT EXISTS)؛ هیچ
-- جدول موجودی تغییر نمی‌کند. هدف: امکان توقف/فعال‌سازی موقت «ثبت سفارش
-- جدید» و «ثبت درخواست خدمت جدید» توسط Admin، بدون تغییر کد و بدون Deploy.
--
-- توجه: در نسخه فعلی پروژه هیچ API/مسیر Backend برای «ثبت درخواست خدمت»
-- وجود ندارد (صفحه خدمات صرفاً اطلاعاتی است و «ثبت سفارش» به‌صورت تماس
-- تلفنی است). ستون services_status صرفاً زیرساخت آماده برای آینده است و
-- در حال حاضر هیچ مسیر Backend به آن متکی نیست.
--
-- تنها یک سطر (id=1) همیشه در این جدول وجود دارد — از این جدول به‌عنوان
-- تنظیمات سراسری تک‌رکوردی استفاده می‌شود.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/site-status.sql
-- (مثل سایر فایل‌های این پوشه، فقط یک‌بار اجرا می‌شود.)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS site_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  store_status        TEXT NOT NULL DEFAULT 'open',    -- open | paused
  services_status     TEXT NOT NULL DEFAULT 'open',    -- open | paused
  store_updated_at    TEXT,
  services_updated_at TEXT
);

INSERT OR IGNORE INTO site_settings (id, store_status, services_status)
VALUES (1, 'open', 'open');
