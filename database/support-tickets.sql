-- ==========================================================================
-- تأسیسات آپادانا — Migration: سیستم تماس با ما / تیکت پشتیبانی
-- ==========================================================================
--
-- این فایل جدا از database/orders-and-customers.sql نگه داشته شده چون به یک
-- موضوع متفاوت (پشتیبانی/ارتباط با مشتری) مربوط است، اما از همان جدول
-- customers و همان زیرساخت SMS (جدول sms_notifications) استفاده می‌کند.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/support-tickets.sql
-- (این فایل هم مثل orders-and-customers.sql فقط یک‌بار اجرا می‌شود.)
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) تیکت‌های پشتیبانی
--    مهمان و مشتری ثبت‌نام‌شده هر دو می‌توانند تیکت ثبت/پیگیری کنند.
--    order_id برای «اتصال تیکت به سفارش» در آینده از هم‌اکنون در نظر گرفته شده.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_id   INTEGER,
  order_id      INTEGER,
  name          TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  email         TEXT,
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'received', -- received | in_review | answered | closed
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- --------------------------------------------------------------------------
-- 2) پیام‌های رفت‌وبرگشتی تیکت (پیام اول مشتری هم این‌جا ثبت می‌شود تا کل
--    گفتگو در یک ساختار یکپارچه قابل نمایش باشد)
--    attachment_url از هم‌اکنون برای «فایل ضمیمه» در آینده آماده است.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL,
  sender_type     TEXT NOT NULL, -- customer | admin
  message         TEXT NOT NULL,
  attachment_url  TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

-- --------------------------------------------------------------------------
-- 3) صف ایمیل — مشابه sms_notifications، فعلاً فقط ذخیره می‌شود.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER,
  ticket_id  INTEGER,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at    TEXT
);

-- --------------------------------------------------------------------------
-- 4) اتصال صف پیامک موجود به تیکت (بدون بازنویسی جدول sms_notifications)
-- --------------------------------------------------------------------------

ALTER TABLE sms_notifications ADD COLUMN ticket_id INTEGER;

-- --------------------------------------------------------------------------
-- 5) ایندکس‌ها
-- --------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_tracking_code
  ON tickets(tracking_code);

CREATE INDEX IF NOT EXISTS idx_tickets_customer_id
  ON tickets(customer_id);

CREATE INDEX IF NOT EXISTS idx_tickets_mobile
  ON tickets(mobile);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id
  ON ticket_messages(ticket_id);

CREATE INDEX IF NOT EXISTS idx_email_notifications_order_id
  ON email_notifications(order_id);

CREATE INDEX IF NOT EXISTS idx_email_notifications_ticket_id
  ON email_notifications(ticket_id);

CREATE INDEX IF NOT EXISTS idx_sms_notifications_ticket_id
  ON sms_notifications(ticket_id);
