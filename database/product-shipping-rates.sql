-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید: هزینه/قاعده ارسال اختصاصی هر محصول
-- ==========================================================================
-- چرا این Migration لازم شد:
-- ساختار قبلی "shipping_methods" فقط یک هزینه سراسری برای هر روش ارسال
-- داشت (مثلاً «پست پیشتاز = ۵۰,۰۰۰ تومان» برای همه محصولات). طبق این
-- دستور، محصولات مختلف (پکیج، شلنگ، قطعه یدکی...) ممکن است هزینه یا حتی
-- مجاز/غیرمجاز بودنِ متفاوتی برای همان روش ارسال داشته باشند.
--
-- این جدول یک رابطه اختیاری «محصول × روش ارسال» اضافه می‌کند — سیستم
-- موازی نیست، دقیقاً همان shipping_methods موجود را با FK گسترش می‌دهد:
--
--   - اگر برای یک (محصول، روش ارسال) هیچ ردیفی اینجا نباشد → همان هزینه
--     پیش‌فرض خودِ روش ارسال استفاده می‌شود (رفتار قبلی دست‌نخورده).
--   - اگر ردیفی با is_allowed=0 باشد → آن روش برای آن محصول اصلاً مجاز/
--     قابل‌انتخاب نیست (نه در برآورد، نه در Checkout نهایی).
--   - اگر ردیفی با custom_cost غیر NULL باشد → همان مبلغ به‌جای هزینه
--     پیش‌فرض روش ارسال، برای آن محصول به‌کار می‌رود.
--
-- این Migration کاملاً افزایشی و بی‌خطر است: هیچ ستون/جدول موجودی تغییر
-- نمی‌کند و برای محصولات قدیمی (بدون هیچ ردیفی در این جدول) رفتار دقیقاً
-- مثل قبل باقی می‌ماند — نیازی به ویرایش مجدد محصولات قدیمی نیست.
--
-- اجرا (فقط همین یک فایل جدید؛ ۵ Migration قبلی دوباره اجرا نشوند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/product-shipping-rates.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS product_shipping_rates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id         INTEGER NOT NULL REFERENCES products(id),
  shipping_method_id INTEGER NOT NULL REFERENCES shipping_methods(id),
  is_allowed         INTEGER NOT NULL DEFAULT 1,
  custom_cost        INTEGER,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_shipping_rates_unique
  ON product_shipping_rates(product_id, shipping_method_id);

CREATE INDEX IF NOT EXISTS idx_product_shipping_rates_product
  ON product_shipping_rates(product_id);
