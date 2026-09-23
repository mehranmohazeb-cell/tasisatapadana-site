-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید و مستقل: Provider Abstraction برای ارسال
-- ==========================================================================
-- این Migration معماری فعلی Shipping Class + Table Rate را حذف/جایگزین
-- نمی‌کند. هدف: تبدیل موتور داخلی فعلی به یک "Internal Provider" در کنار
-- Providerهای آنلاین آینده (مثل Tapin)، بدون هیچ تغییری در جدول‌های:
--   shipping_methods, shipping_classes, shipping_table_rates,
--   product_shipping_rates, products.shipping_class_id/weight_grams/...
--
-- هیچ ستون/جدول موجودی حذف یا بازنویسی نمی‌شود. فقط ستون‌های Nullable/
-- Default-دار جدید به shipping_table_rates و site_settings اضافه می‌شود،
-- به‌علاوه ۳ جدول کاملاً جدید.
--
-- اجرا (فقط همین یک فایل جدید؛ migrationهای قبلی دوباره اجرا نشوند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/shipping-providers-and-quotes.sql
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ۱) رجیستری Provider — هر Provider (داخلی یا آنلاین) یک ردیف اینجا دارد.
--    هیچ Secret/API Key اینجا ذخیره نمی‌شود؛ فقط تنظیمات غیرمحرمانه.
--    Credentials واقعی همیشه از Worker Secrets (env) خوانده می‌شوند.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_providers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  code                   TEXT NOT NULL UNIQUE,      -- 'internal', 'tapin', 'post', 'tipax', ...
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL DEFAULT 'online' CHECK (type IN ('internal', 'online')),
  status                 TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  mode                   TEXT NOT NULL DEFAULT 'quote' CHECK (mode IN ('quote', 'disabled')),
  fallback_provider_code TEXT,                      -- کد Providerی که در صورت خطا/عدم موفقیت استفاده شود
  config_json           TEXT,                       -- تنظیمات غیرمحرمانه (نه Secret) به‌صورت JSON، مثلاً origin پیش‌فرض
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipping_providers_status ON shipping_providers(status);

-- Provider داخلی همیشه وجود دارد و همیشه فعال است (نمی‌تواند از این طریق
-- غیرفعال شود؛ چون Fallback نهایی سیستم است). Tapin به‌صورت غیرفعال و آماده
-- اتصال درج می‌شود تا وقتی Credential/Endpoint واقعی آماده شد، فقط از پنل
-- فعال شود — هیچ Endpoint فرضی برایش پیاده نشده (بخش ۷ دستور).
INSERT OR IGNORE INTO shipping_providers (code, name, type, status, mode, fallback_provider_code, sort_order) VALUES
  ('internal', 'موتور داخلی (Table Rate)', 'internal', 'active',   'quote', NULL,       10),
  ('tapin',    'تاپین (Tapin)',             'online',   'disabled', 'quote', 'internal', 20);

-- --------------------------------------------------------------------------
-- ۲) نسخه‌بندی تعرفه — هر Import (CSV/Excel/JSON) یک نسخه جدید می‌سازد.
--    نسخه قبلی هرگز حذف نمی‌شود؛ فقط وضعیت آن به archived تغییر می‌کند.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_tariff_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  version_label  TEXT NOT NULL,                 -- مثلاً "نسخه ۲ - Tapin - 1404/07/01"
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tapin', 'post', 'tipax', 'other')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  filename       TEXT,
  content_type   TEXT,
  checksum       TEXT,                          -- SHA-256 فایل خام، برای تشخیص فایل تکراری
  row_count      INTEGER NOT NULL DEFAULT 0,
  valid_row_count INTEGER NOT NULL DEFAULT 0,
  error_row_count INTEGER NOT NULL DEFAULT 0,
  -- فایل خام: چون هیچ R2 bucket در wrangler.toml این پروژه تعریف نشده،
  -- فایل خام (معمولاً CSV چندکیلوبایتی تعرفه) به‌صورت متن در همین جدول
  -- نگهداری می‌شود تا تاریخچه Import هرگز گم نشود. اگر در آینده حجم
  -- فایل‌ها بزرگ شد (مثلاً Excel چندمگابایتی)، توصیه معماری: یک R2 bucket
  -- جدید در wrangler.toml اضافه و raw_content به آن منتقل شود؛ این ستون
  -- در آن حالت فقط کلید/مسیر R2 را نگه می‌دارد، نه خود فایل را.
  raw_content    TEXT,
  uploaded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at   TEXT,
  created_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_shipping_tariff_versions_status ON shipping_tariff_versions(status);

-- --------------------------------------------------------------------------
-- ۳) اتصال هر ردیف Table Rate به نسخه/منبعی که آن را وارد کرده (بخش ۱۴).
--    Nullable/Default — ردیف‌های دستی قبلی بدون تغییر، source='manual'
--    و tariff_version_id=NULL می‌گیرند (یعنی «پیش از سیستم نسخه‌بندی»).
-- --------------------------------------------------------------------------
ALTER TABLE shipping_table_rates ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE shipping_table_rates ADD COLUMN tariff_version_id INTEGER REFERENCES shipping_tariff_versions(id);

CREATE INDEX IF NOT EXISTS idx_shipping_table_rates_tariff_version ON shipping_table_rates(tariff_version_id);

-- --------------------------------------------------------------------------
-- ۴) تاریخچه/Cache استعلام آنلاین (بخش ۱۵). هرگز خودکار تبدیل به Table Rate
--    نمی‌شود — فقط Audit/Cache با TTL برای جلوگیری از استعلام تکراری.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_quote_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_code     TEXT NOT NULL,
  carrier           TEXT,
  service           TEXT,
  origin            TEXT,
  destination_city  TEXT,
  destination_province TEXT,
  weight_grams      INTEGER,
  cart_value        INTEGER,
  quoted_cost        INTEGER,
  currency          TEXT NOT NULL DEFAULT 'IRT', -- تومان (واحد داخلی پروژه)
  available         INTEGER NOT NULL DEFAULT 1,
  quote_id          TEXT,                        -- شناسه Quote سمت Provider (در صورت وجود)
  metadata_json     TEXT,                        -- سایر داده غیرمحرمانه پاسخ Provider
  quoted_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ttl_seconds       INTEGER NOT NULL DEFAULT 900, -- اعتبار Cache؛ Checkout نهایی طبق بخش ۱۸ دوباره استعلام می‌گیرد
  used_in_order_id  INTEGER REFERENCES orders(id) -- فقط اگر واقعاً مبنای یک سفارش نهایی قرار گرفت
);

CREATE INDEX IF NOT EXISTS idx_shipping_quote_history_provider ON shipping_quote_history(provider_code);
CREATE INDEX IF NOT EXISTS idx_shipping_quote_history_quoted_at ON shipping_quote_history(quoted_at);

-- --------------------------------------------------------------------------
-- ۵) حالت محاسبه ارسال (بخش ۱۷) — روی همان الگوی site_settings موجود
--    (رکورد تک id=1) که پروژه از قبل برای توقف/فعال‌سازی فروشگاه دارد.
--    پیش‌فرض 'internal' یعنی رفتار امروز دقیقاً حفظ می‌شود؛ هیچ Providerی
--    خودکار روشن نمی‌شود.
-- --------------------------------------------------------------------------
ALTER TABLE site_settings ADD COLUMN shipping_calculation_mode TEXT NOT NULL DEFAULT 'internal';
-- مقادیر مجاز (در کد اعتبارسنجی می‌شود، نه CHECK، چون ALTER TABLE ADD COLUMN
-- در SQLite/D1 اجازه افزودن CHECK وابسته به مقدار پیش‌فرض را به همین شکل نمی‌دهد):
--   'internal'                 → فقط موتور داخلی (رفتار فعلی/پیش‌فرض)
--   'online'                   → فقط Provider آنلاین فعال (بدون Fallback خودکار)
--   'online_fallback_internal' → ابتدا Provider آنلاین، در صورت خطا/عدم Quote → موتور داخلی
