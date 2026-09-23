-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید: Shipping Class + Table Rate Shipping
-- ==========================================================================
-- چرا این Migration لازم شد:
-- ساختار فعلی («shipping_methods» + «product_shipping_rates») فقط اجازه
-- می‌داد هزینه ارسال به‌صورت «سراسری» یا «دقیقاً برای یک محصول خاص» تعریف
-- شود. با افزایش تعداد محصولات، وارد کردن دستی تعرفه برای تک‌تک محصولات
-- غیرقابل مدیریت می‌شود. این Migration یک لایه میانی اضافه می‌کند:
--
--   محصول → Shipping Class (گروه حمل، مثل «سبک»/«سنگین»/«حجیم»)
--   Shipping Class + روش ارسال + شرایط (وزن/تعداد/مقصد/مبلغ) → Table Rate
--
-- این یک سیستم موازی نیست — دقیقاً روی همان shipping_methods (FK) و در
-- کنار product_shipping_rates موجود (که همچنان بالاترین اولویت را دارد)
-- سوار می‌شود. اولویت نهایی در کد (resolveShippingOptionsForCart) این است:
--   ۱. product_shipping_rates (استثنای دستی همان محصول) — بالاترین اولویت
--   ۲. shipping_table_rates (بر اساس Shipping Class محصول + شرایط سبد)
--   ۳. shipping_methods.cost (هزینه پیش‌فرض سراسری) — آخرین Fallback
--
-- کاملاً افزایشی و امن: هیچ ستون/جدول موجودی تغییر یا حذف نمی‌شود. محصولات
-- فعلی بدون Shipping Class همچنان دقیقاً مثل قبل (پیش‌فرض روش ارسال یا
-- override اختصاصی خودشان) کار می‌کنند — نیازی به ورود مجدد اطلاعات نیست.
--
-- اجرا (فقط همین یک فایل جدید):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/shipping-classes-and-rates.sql
-- ==========================================================================

-- گروه‌های حمل (نام‌ها فقط نمونه‌اند؛ مدیر از پنل هر تعداد گروه دلخواه
-- می‌تواند بسازد/ویرایش/غیرفعال کند).
CREATE TABLE IF NOT EXISTS shipping_classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_classes_name ON shipping_classes(name);
CREATE INDEX IF NOT EXISTS idx_shipping_classes_active ON shipping_classes(active);

-- اتصال محصول به یک Shipping Class + اطلاعات وزن/ابعاد (بخش ۱۳ دستور).
-- واحدها: وزن بر حسب گرم (دقیق‌تر و بدون اعشار برای محاسبه)، ابعاد بر حسب
-- سانتی‌متر. همه این ستون‌ها Nullable هستند — محصولات قدیمی بدون این
-- اطلاعات هم دقیقاً مثل قبل کار می‌کنند.
ALTER TABLE products ADD COLUMN shipping_class_id INTEGER REFERENCES shipping_classes(id);
ALTER TABLE products ADD COLUMN weight_grams INTEGER;
ALTER TABLE products ADD COLUMN length_cm INTEGER;
ALTER TABLE products ADD COLUMN width_cm INTEGER;
ALTER TABLE products ADD COLUMN height_cm INTEGER;

CREATE INDEX IF NOT EXISTS idx_products_shipping_class ON products(shipping_class_id);

-- تعرفه‌های چندشرطی (Table Rate). هر ردیف یک «قانون» است؛ همه شرط‌ها
-- اختیاری‌اند (NULL = بدون محدودیت روی آن شرط). shipping_class_id هم
-- NULL می‌تواند باشد یعنی این قانون صرف‌نظر از Shipping Class اعمال شود.
-- افزودن شرط جدید در آینده فقط با افزودن یک ستون جدید Nullable ممکن است،
-- بدون نیاز به بازنویسی کل جدول یا منطق تطبیق.
CREATE TABLE IF NOT EXISTS shipping_table_rates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shipping_method_id  INTEGER NOT NULL REFERENCES shipping_methods(id),
  shipping_class_id   INTEGER REFERENCES shipping_classes(id),
  min_weight_grams    INTEGER,
  max_weight_grams    INTEGER,
  min_quantity        INTEGER,
  max_quantity        INTEGER,
  min_cart_value      INTEGER,
  max_cart_value      INTEGER,
  destination_city    TEXT,
  cost                INTEGER NOT NULL,
  active              INTEGER NOT NULL DEFAULT 1,
  priority            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipping_table_rates_method ON shipping_table_rates(shipping_method_id);
CREATE INDEX IF NOT EXISTS idx_shipping_table_rates_class ON shipping_table_rates(shipping_class_id);
CREATE INDEX IF NOT EXISTS idx_shipping_table_rates_active ON shipping_table_rates(active);
