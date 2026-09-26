-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید و مستقل: سیستم تخمین بسته‌بندی + تلرانس حمل
-- ==========================================================================
-- این Migration معماری فعلی ارسال را جایگزین نمی‌کند. جدول‌های زیر دست‌نخورده
-- می‌مانند: shipping_methods, shipping_classes, shipping_table_rates,
-- product_shipping_rates, products.shipping_class_id/weight_grams/length_cm/
-- width_cm/height_cm, orders.shipping_cost.
--
-- این Migration یک لایه «قبل از» موتور فعلی اضافه می‌کند (طبق دستور توسعه،
-- بخش ۲۵): از روی وزن/ابعاد واقعی محصول (که همچنان دست‌نخورده باقی می‌ماند)
-- یک «وزن قابل‌محاسبه» (Chargeable Weight) تخمین می‌زند و همان مقدار،
-- به‌جای وزن خام محصول، وارد resolveShippingOptionsForCart موجود می‌شود.
--
-- همه ستون‌های جدید Nullable/Default-دار هستند — محصولات/کلاس‌های/روش‌های
-- ارسال قبلی بدون این اطلاعات، دقیقاً مثل قبل کار می‌کنند (Fallback به
-- Profile عمومی، طبق src/packaging-estimation.js).
--
-- اجرا (فقط همین یک فایل جدید؛ Migrationهای قبلی دوباره اجرا نشوند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/packaging-estimation.sql
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ۱) Packaging Profile — قابل مدیریت از پنل، هیچ مقداری Hard-code نیست.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packaging_profiles (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  code                        TEXT NOT NULL UNIQUE,   -- شناسه پایدار داخلی، مثل 'SMALL_PART'
  name                        TEXT NOT NULL,          -- نام قابل‌نمایش در پنل
  description                TEXT,

  -- تلرانس ابعاد (سانتی‌متر) — به هر بُعد محصول اضافه می‌شود، نه یک عدد
  -- ثابت سراسری (بخش ۷ دستور).
  length_tolerance_cm         REAL NOT NULL DEFAULT 0,
  width_tolerance_cm          REAL NOT NULL DEFAULT 0,
  height_tolerance_cm         REAL NOT NULL DEFAULT 0,

  -- تلرانس وزن — افزایش ثابت (گرم) + درصد افزایش، هر دو قابل‌تنظیم و
  -- می‌توانند هم‌زمان صفر باشند (بخش ۸ دستور).
  weight_tolerance_grams      INTEGER NOT NULL DEFAULT 0,
  weight_tolerance_percent    REAL NOT NULL DEFAULT 0,

  -- حداقل ابعاد/وزن بسته — کف محافظه‌کارانه برای قطعات کوچک/بدون اطلاعات
  -- کامل (بخش ۶ و ۱۴ دستور). هرگز صفر به‌عنوان مقدار معتبر حمل تلقی نشود.
  min_package_length_cm       REAL NOT NULL DEFAULT 10,
  min_package_width_cm        REAL NOT NULL DEFAULT 10,
  min_package_height_cm       REAL NOT NULL DEFAULT 5,
  min_shipping_weight_grams   INTEGER NOT NULL DEFAULT 200,

  protection_level            TEXT NOT NULL DEFAULT 'standard' CHECK (protection_level IN ('standard', 'fragile')),
  packaging_group              TEXT,                   -- مثلاً 'bulky' — برای گزارش/تفکیک آینده

  -- آیا اقلام این Profile می‌توانند با اقلام کوچک دیگر در یک بسته سفارش
  -- چندقلمی تجمیع شوند؟ (بخش ۱۰ دستور)
  allow_combine_with_other_items INTEGER NOT NULL DEFAULT 1,
  -- الزام ارسال جداگانه — صرف‌نظر از تجمیع (بخش ۱۱ دستور)
  require_separate_shipment       INTEGER NOT NULL DEFAULT 0,

  is_default                  INTEGER NOT NULL DEFAULT 0, -- Profile عمومی Fallback (فقط یکی باید ۱ باشد)
  active                       INTEGER NOT NULL DEFAULT 1,
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  created_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packaging_profiles_active ON packaging_profiles(active);

-- Profileهای نمونه — این اعداد به‌عنوان حقیقت تجاری/فنی قطعی تلقی نشوند
-- (طبق تذکر صریح بخش ۷ دستور)؛ همه از پنل قابل ویرایش‌اند.
INSERT OR IGNORE INTO packaging_profiles
  (code, name, description, length_tolerance_cm, width_tolerance_cm, height_tolerance_cm,
   weight_tolerance_grams, weight_tolerance_percent,
   min_package_length_cm, min_package_width_cm, min_package_height_cm, min_shipping_weight_grams,
   protection_level, packaging_group, allow_combine_with_other_items, require_separate_shipment,
   is_default, sort_order)
VALUES
  ('GENERIC', 'عمومی (پیش‌فرض سیستم)',
   'وقتی هیچ Shipping Class/Profile اختصاصی تنظیم نشده باشد استفاده می‌شود.',
   3, 3, 3, 300, 5, 15, 12, 8, 300, 'standard', NULL, 1, 0, 1, 0),

  ('SMALL_PART', 'قطعه کوچک بدون بسته‌بندی کارخانه‌ای',
   'شیرآلات، شلنگ، اتصالات، قطعات کوچک — از بسته‌بندی استاندارد شرکت حمل استفاده می‌شود، نه +۱۰ سانتی‌متر ثابت.',
   2, 2, 2, 150, 3, 15, 12, 8, 250, 'standard', NULL, 1, 0, 0, 10),

  ('FACTORY_PACKAGED', 'دارای بسته‌بندی کارخانه‌ای',
   'پکیج، آبگرمکن، برخی تجهیزات/ابزار — ابعاد کارتن کارخانه معمولاً نزدیک به ابعاد ثبت‌شده محصول است؛ تلرانس کم.',
   4, 4, 4, 500, 3, 20, 20, 15, 1000, 'standard', NULL, 0, 0, 0, 20),

  ('BULKY', 'کالای بزرگ/حجیم',
   'پکیج، آبگرمکن، رادیاتور، تجهیزات حجیم — تلرانس بیشتر و Packaging Group مستقل؛ می‌تواند ارسال جداگانه داشته باشد.',
   6, 6, 6, 1000, 4, 30, 30, 20, 2000, 'standard', 'bulky', 0, 1, 0, 30),

  ('FRAGILE', 'کالای حساس/شکننده',
   'سطح محافظت بالاتر — تلرانس محافظتی بیشتر برای جلوگیری از آسیب حمل.',
   5, 5, 5, 700, 8, 18, 15, 10, 500, 'fragile', NULL, 0, 0, 0, 40);

-- --------------------------------------------------------------------------
-- ۲) اتصال خودکار: هر Shipping Class می‌تواند یک Packaging Profile پیش‌فرض
--    داشته باشد — یعنی مدیر فقط Shipping Class را برای محصول انتخاب می‌کند
--    (کاری که از قبل انجام می‌داد) و Packaging Profile خودکار تشخیص داده
--    می‌شود؛ نیازی به انتخاب دستی دوباره نیست (بخش ۲۳ دستور).
-- --------------------------------------------------------------------------
ALTER TABLE shipping_classes ADD COLUMN default_packaging_profile_id INTEGER REFERENCES packaging_profiles(id);

-- --------------------------------------------------------------------------
-- ۳) Override اختصاصی محصول (بخش ۱۲ و ۱۳ دستور).
--    - packaging_profile_id: انتخاب دستی Profile برای همین محصول (اختیاری؛
--      اگر خالی باشد از default_packaging_profile_id کلاس یا Profile عمومی
--      استفاده می‌شود).
--    - package_*: اگر اطلاعات واقعی بسته‌بندی یک محصول در آینده پیدا شود
--      («Product Override» «»Packaging Profile Default»)؛ در این حالت هیچ
--      تخمینی اعمال نمی‌شود، همین مقادیر مستقیماً استفاده می‌شوند.
--    - packaging_confidence: سطح اطمینان داخلی (REAL/VERIFIED/ESTIMATED/
--      CONSERVATIVE) — فقط برای گزارش/تحلیل داخلی مدیریت، به مشتری نمایش
--      داده نمی‌شود (بخش ۱۳ دستور). خالی = سیستم خودش در زمان محاسبه تعیین
--      می‌کند (ESTIMATED یا CONSERVATIVE بسته به کامل‌بودن داده).
-- --------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN packaging_profile_id INTEGER REFERENCES packaging_profiles(id);
ALTER TABLE products ADD COLUMN package_length_cm REAL;
ALTER TABLE products ADD COLUMN package_width_cm REAL;
ALTER TABLE products ADD COLUMN package_height_cm REAL;
ALTER TABLE products ADD COLUMN package_weight_grams INTEGER;
ALTER TABLE products ADD COLUMN packaging_confidence TEXT;

CREATE INDEX IF NOT EXISTS idx_products_packaging_profile ON products(packaging_profile_id);

-- --------------------------------------------------------------------------
-- ۴) ضریب وزن حجمی — به هر روش ارسال وابسته است، نه یک عدد عمومی
--    Hard-code شده (بخش ۹ دستور)؛ چون سرویس‌های حمل مختلف قواعد متفاوت
--    دارند. NULL = از پیش‌فرض محافظه‌کارانه کد استفاده می‌شود (مستند در
--    src/packaging-estimation.js) تا وقتی مدیر عدد واقعی سرویس حمل را
--    از پنل وارد کند.
-- --------------------------------------------------------------------------
ALTER TABLE shipping_methods ADD COLUMN volumetric_divisor INTEGER;

-- --------------------------------------------------------------------------
-- ۵) ثبت هزینه واقعی حمل + اختلاف با تخمین (بخش ۱۶ دستور). orders.shipping_cost
--    موجود همان «Estimated Shipping Cost» است؛ این دو ستون جدید «Actual» و
--    «Variance» را کامل می‌کنند، بدون بازطراحی سفارش/پرداخت.
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN actual_shipping_cost INTEGER;
ALTER TABLE orders ADD COLUMN shipping_cost_variance INTEGER;
ALTER TABLE orders ADD COLUMN shipping_cost_recorded_at TEXT;
