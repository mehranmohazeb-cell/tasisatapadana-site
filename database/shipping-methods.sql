-- ==========================================================================
-- تأسیسات آپادانا — Migration: سیستم کامل و قابل مدیریت روش‌های ارسال
-- ==========================================================================
-- روش‌های ارسال (پست، تیپاکس، پیک اصفهان، پس‌کرایه و هر روش آینده) کاملاً
-- از پنل مدیریت قابل تعریف/ویرایش/فعال‌سازی هستند؛ بدون تغییر کد یا Deploy.
--
-- cost_type: 'prepaid' = هزینه ارسال هنگام خرید از درگاه دریافت می‌شود.
--            'cod'     = پس‌کرایه؛ هزینه ارسال از مبلغ پرداخت اینترنتی
--                        کسر می‌شود و در سفارش به‌صورت واضح ثبت می‌گردد.
--
-- scope: 'all'  = برای همه مقصدها نمایش داده می‌شود.
--        'city' = فقط برای شهر مشخص‌شده در allowed_city (مثل «پیک اصفهان»).
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/shipping-methods.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS shipping_methods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  cost          INTEGER NOT NULL DEFAULT 0,
  cost_type     TEXT NOT NULL DEFAULT 'prepaid' CHECK (cost_type IN ('prepaid', 'cod')),
  active        INTEGER NOT NULL DEFAULT 1,
  scope         TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'city')),
  allowed_city  TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipping_methods_active ON shipping_methods(active);

-- ستون‌های جدید روی orders — روش ارسال انتخاب‌شده به‌صورت Snapshot (نام و
-- نوع هزینه در لحظه ثبت سفارش) ذخیره می‌شود، تا تغییر بعدی روش‌های ارسال
-- در پنل مدیریت، سفارش‌های قبلی را تغییر ندهد.
ALTER TABLE orders ADD COLUMN shipping_method_id INTEGER;
ALTER TABLE orders ADD COLUMN shipping_method_name TEXT;
ALTER TABLE orders ADD COLUMN shipping_is_cod INTEGER NOT NULL DEFAULT 0;

-- مبلغ واقعی قابل‌پرداخت به درگاه (بخش ۵ دستور): وقتی روش ارسال پس‌کرایه
-- باشد، هزینه ارسال از این مبلغ کسر است (چون آنلاین دریافت نمی‌شود).
-- ستون total همچنان جمع کامل سفارش (برای فاکتور/نمایش به مشتری) است و
-- دست‌نخورده باقی می‌ماند.
ALTER TABLE orders ADD COLUMN payable_amount INTEGER;

-- نمونه روش‌های ارسال — دقیقاً طبق مثال‌های درخواست. مدیر می‌تواند این‌ها
-- را ویرایش/غیرفعال کند یا روش جدید اضافه کند.
INSERT INTO shipping_methods (name, cost, cost_type, active, scope, allowed_city, sort_order) VALUES
  ('پست پیشتاز',              50000, 'prepaid', 1, 'all',  NULL,      10),
  ('تیپاکس',                  70000, 'prepaid', 1, 'all',  NULL,      20),
  ('پیک موتوری اصفهان',       40000, 'prepaid', 1, 'city', 'اصفهان',  30),
  ('ارسال پس‌کرایه',          60000, 'cod',     1, 'all',  NULL,      40);
