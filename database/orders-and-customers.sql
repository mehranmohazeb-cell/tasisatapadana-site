-- ==========================================================================
-- تأسیسات آپادانا — Migration: سیستم کامل سفارش، آدرس و حساب مشتری
-- ==========================================================================
--
-- این فایل روی دیتابیس D1 فعلی که از قبل جداول زیر را دارد اجرا می‌شود:
--   products, product_images, orders, order_items
-- (این جداول قبلاً از طریق داشبورد/نسخه اولیه پروژه ساخته شده‌اند و در این
--  فایل دوباره ساخته نمی‌شوند.)
--
-- ستون‌های جدید به جدول‌های "orders" و "order_items" اضافه می‌شوند و جداول
-- تازه (customers, customer_addresses, customer_sessions,
-- order_status_history, sms_notifications) ساخته می‌شوند.
--
-- نکته بسیار مهم درباره اجرا:
-- SQLite/D1 از "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" پشتیبانی نمی‌کند.
-- این فایل قرار است فقط "یک‌بار" روی دیتابیس فعلی اجرا شود. اگر بخشی از آن
-- قبلاً اجرا شده، همان بخش را قبل از اجرای دوباره از فایل حذف کنید تا خطای
-- "duplicate column name" نگیرید. اجرای کامل و تازه (روی نسخه فعلی که تا امروز
-- دست‌نخورده است) بدون مشکل انجام می‌شود.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/orders-and-customers.sql
-- (برای تست محلی، پرچم --remote را حذف کنید.)
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) ستون‌های جدید روی جدول orders
--    (نام‌گذاری هماهنگ با ستون‌های موجود customer_name / customer_phone / total
--     نگه داشته شده تا API و پنل مدیریت فعلی بدون تغییر کار کنند.)
-- --------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN tracking_code TEXT;
ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);

ALTER TABLE orders ADD COLUMN province TEXT;
ALTER TABLE orders ADD COLUMN city TEXT;
ALTER TABLE orders ADD COLUMN street TEXT;
ALTER TABLE orders ADD COLUMN sub_street TEXT;
ALTER TABLE orders ADD COLUMN alley TEXT;
ALTER TABLE orders ADD COLUMN plaque TEXT;
ALTER TABLE orders ADD COLUMN unit TEXT;
ALTER TABLE orders ADD COLUMN postal_code TEXT;
ALTER TABLE orders ADD COLUMN address_note TEXT;
ALTER TABLE orders ADD COLUMN latitude REAL;
ALTER TABLE orders ADD COLUMN longitude REAL;

ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN payment_reference TEXT;

ALTER TABLE orders ADD COLUMN postal_carrier TEXT;
ALTER TABLE orders ADD COLUMN postal_tracking_code TEXT;

ALTER TABLE orders ADD COLUMN updated_at TEXT;


-- --------------------------------------------------------------------------
-- 2) ستون جدید روی order_items
--    نام و قیمت محصول از قبل در لحظه ثبت سفارش ذخیره می‌شد (product_name, price)؛
--    subtotal فقط جمع از پیش‌محاسبه‌شده (price * quantity) برای نمایش سریع‌تر است.
-- --------------------------------------------------------------------------

ALTER TABLE order_items ADD COLUMN subtotal INTEGER;


-- --------------------------------------------------------------------------
-- 3) مشتریان (ثبت‌نام اختیاری - سفارش مهمان همچنان فعال است)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- نشست‌های ورود (بدون نیاز به کتابخانه JWT خارجی؛ توکن تصادفی + انقضا)
CREATE TABLE IF NOT EXISTS customer_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- آدرس‌های ذخیره‌شده مشتری ثبت‌نام‌کرده (برای پرکردن خودکار فرم در سفارش بعدی)
CREATE TABLE IF NOT EXISTS customer_addresses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL,
  province      TEXT NOT NULL,
  city          TEXT NOT NULL,
  street        TEXT NOT NULL,
  sub_street    TEXT NOT NULL,
  alley         TEXT NOT NULL,
  plaque        TEXT NOT NULL,
  unit          TEXT,
  postal_code   TEXT NOT NULL,
  address_note  TEXT,
  latitude      REAL,
  longitude     REAL,
  is_default    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);


-- --------------------------------------------------------------------------
-- 4) تاریخچه وضعیت سفارش (هر تغییر وضعیت یک ردیف؛ برای پیگیری و پنل مدیریت)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  status     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);


-- --------------------------------------------------------------------------
-- 5) صف پیامک (SMS) — فعلاً فقط ذخیره می‌شود، هنوز به سرویس‌دهنده متصل نیست.
--    وقتی سرویس SMS ایرانی متصل شد، یک Worker/Cron جداگانه ردیف‌های status='pending'
--    را می‌خواند، پیامک را ارسال می‌کند و status را به sent/failed تغییر می‌دهد.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sms_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER,
  phone      TEXT NOT NULL,
  event_type TEXT NOT NULL,   -- order_created | status_changed | preparing | shipped | postal_code_added
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at    TEXT
);


-- --------------------------------------------------------------------------
-- 6) ایندکس‌ها
-- --------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_code
  ON orders(tracking_code);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token
  ON customer_sessions(token);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id
  ON customer_sessions(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id
  ON customer_addresses(customer_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON order_status_history(order_id);

CREATE INDEX IF NOT EXISTS idx_sms_notifications_order_id
  ON sms_notifications(order_id);
