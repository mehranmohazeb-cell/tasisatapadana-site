-- ==========================================================================
-- تأسیسات آپادانا — Migration: اصلاح کامل سیستم اعلان سفارش‌های جدید
-- ==========================================================================
-- هدف: جایگزینی منطق قدیمی «شمارش سفارش‌های pending» با یک جدول اعلان واقعی
-- که هم از اعلان تکراری برای یک سفارش جلوگیری می‌کند (UNIQUE روی order_id)
-- و هم وضعیت خوانده‌شده/نشده مستقل نگه می‌دارد.
--
-- نکته مهم درباره داده‌های موجود: این Migration داده سفارش‌ها را دست‌نخورده
-- نگه می‌دارد. فقط برای سفارش‌هایی که همین الان وضعیت «pending» دارند یک
-- اعلان خوانده‌نشده ساخته می‌شود (چون این‌ها واقعاً هنوز نیاز به رسیدگی
-- دارند)؛ سفارش‌های آزمایشی/قدیمی‌ای که از قبل لغو شده یا به وضعیت دیگری
-- تغییر کرده‌اند، هیچ‌وقت اعلان نمی‌گیرند و «جدید» محسوب نمی‌شوند.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/order-notifications.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS order_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read    INTEGER NOT NULL DEFAULT 0,
  read_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_notifications_is_read ON order_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_order_notifications_order_id ON order_notifications(order_id);

-- Backfill یک‌باره: فقط سفارش‌های واقعاً «در حال بررسی» فعلی، اعلان خوانده‌نشده
-- می‌گیرند. سفارش‌های لغوشده/تکمیل‌شده/ارسال‌شده (از جمله سفارش‌های آزمایشی
-- قدیمی) عمداً از این Backfill کنار گذاشته شده‌اند.
INSERT INTO order_notifications (order_id, created_at, is_read)
SELECT id, COALESCE(created_at, CURRENT_TIMESTAMP), 0
FROM orders
WHERE status = 'pending';
