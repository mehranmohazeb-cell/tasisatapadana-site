-- ==========================================================================
-- تأسیسات آپادانا — Migration: Product Detail Page Enhancements
-- ==========================================================================
--
-- کاملاً افزودنی است: فقط ALTER TABLE ADD COLUMN (nullable/با DEFAULT) روی
-- جدول‌های موجود products/product_images، و یک CREATE TABLE IF NOT EXISTS
-- جدید برای مشخصات فنی. هیچ DROP/DELETE/TRUNCATE و هیچ تغییری روی داده‌های
-- موجود انجام نمی‌دهد. محصولات و تصاویر فعلی دقیقاً با همان مقادیر قبلی
-- باقی می‌مانند؛ ستون‌های جدید برایشان NULL/پیش‌فرض خواهند بود.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/product-detail-enhancements.sql
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ۱) اطلاعات پایه محصول (برند/مدل/SKU) — بخش ۱ دستور
-- --------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN model TEXT;
ALTER TABLE products ADD COLUMN sku TEXT;

-- --------------------------------------------------------------------------
-- ۲) قیمت تخفیف‌خورده — اگر compare_at_price بزرگ‌تر از price باشد یعنی
--    تخفیف فعال است؛ در غیر این صورت تخفیفی نمایش داده نمی‌شود.
-- --------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN compare_at_price INTEGER;

-- --------------------------------------------------------------------------
-- ۳) ارسال — NULL یعنی از پیش‌فرض سراسری فروشگاه (در کد Worker) استفاده شود.
-- --------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN shipping_cost INTEGER;
ALTER TABLE products ADD COLUMN shipping_method TEXT;
ALTER TABLE products ADD COLUMN shipping_time TEXT;

-- --------------------------------------------------------------------------
-- ۴) گارانتی و بازگشت — NULL/۰ یعنی این مورد برای این محصول نمایش داده نشود.
-- --------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN warranty_months INTEGER;
ALTER TABLE products ADD COLUMN warranty_provider TEXT;
ALTER TABLE products ADD COLUMN return_days INTEGER;

-- --------------------------------------------------------------------------
-- ۵) متن جایگزین تصویر (alt) — برای هر ردیف در product_images موجود
-- --------------------------------------------------------------------------

ALTER TABLE product_images ADD COLUMN alt TEXT;

-- --------------------------------------------------------------------------
-- ۶) مشخصات فنی قابل مدیریت (بخش ۷ دستور) — جدول جدید
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_specs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  label       TEXT NOT NULL,
  value       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_specs_product_id ON product_specs (product_id, sort_order);

-- --------------------------------------------------------------------------
-- ۷) شفافیت هزینه ارسال روی خود سفارش (بخش ۳/۴ دستور) — orders.total از قبل
--    هزینه ارسال را داخل خودش دارد، اما تا امروز به‌صورت جدا ذخیره نمی‌شد،
--    پس فاکتور نمی‌توانست آن را به‌عنوان یک ردیف شفاف/جدا نشان دهد. این ستون
--    فقط برای سفارش‌های جدید پر می‌شود؛ سفارش‌های قبلی NULL/۰ می‌مانند و total
--    آنها دست‌نخورده باقی می‌ماند.
-- --------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN shipping_cost INTEGER NOT NULL DEFAULT 0;

