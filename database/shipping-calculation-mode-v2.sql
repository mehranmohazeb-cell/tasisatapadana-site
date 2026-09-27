-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید و مستقل: هماهنگ‌سازی CHECK واقعی
-- site_settings.shipping_calculation_mode با حالت‌های مورد نیاز کد
-- ==========================================================================
-- چرا این Migration لازم شد:
-- تست مستقیم روی D1 واقعی این خطا را نشان داد:
--   "D1_ERROR: CHECK constraint failed: shipping_calculation_mode IN
--    (table_rate, 'engine): SQLITE_CONSTRAINT"
-- یعنی ستون واقعی site_settings.shipping_calculation_mode در Production از
-- قبل یک CHECK constraint دارد که فقط 'table_rate' و 'engine' را مجاز
-- می‌داند (این CHECK در هیچ‌کدام از فایل‌های این پوشه ثبت نشده بود — یعنی
-- ستون واقعی روی D1 از مسیر دیگری غیر از database/shipping-providers-and-
-- quotes.sql ساخته/اصلاح شده است). نه 'internal' (مقدار پیش‌فرض قدیمی همان
-- فایل) و نه 'online' (مقدار جدید مورد نیاز پنل Providers) هیچ‌کدام در این
-- CHECK مجاز نبودند؛ دقیقاً همین باعث شکست «ذخیره» در پنل مدیریت می‌شد.
--
-- بازبینی این نسخه (بعد از خطای مشابه در shipping_tariff_versions که ثابت
-- کرد Schemaهای واقعی Production می‌توانند از تمام فایل‌های این پوشه فراتر
-- بروند): نسخه قبلی این فایل کل جدول site_settings را با یک لیست ثابت از
-- ستون‌ها بازسازی می‌کرد (ساخت جدول جدید → کپی → حذف قدیمی → تغییرنام).
-- چون Schema کامل و قطعی site_settings در Production در اختیار نیست (فقط
-- فهرست ستون‌های ثبت‌شده در Migrationهای همین پوشه شناخته‌شده است، نه
-- خروجی واقعی PRAGMA table_info روی Production)، آن روش ریسک داشت: اگر
-- Production حتی یک ستون ناشناخته دیگر روی site_settings داشته باشد،
-- بازسازی کامل جدول آن ستون را برای همیشه حذف می‌کرد.
--
-- به همین دلیل این نسخه یک روش کاملاً متفاوت و امن‌تر استفاده می‌کند که
-- هرگز جدول را به‌طور کامل بازسازی نمی‌کند و هیچ‌وقت به فهرست کامل
-- ستون‌های جدول نیاز ندارد — فقط دقیقاً همان یک ستونی که باید تغییر کند را
-- لمس می‌کند و کاملاً به بقیه جدول (هر ستونی که باشد، شناخته‌شده یا نه)
-- دست‌نخورده می‌ماند:
--   ۱) ستون فعلی shipping_calculation_mode (با CHECK قدیمی محدود) به یک
--      نام موقت تغییر نام می‌یابد (RENAME COLUMN — کل جدول دست‌نخورده
--      می‌ماند، فقط همین یک ستون).
--   ۲) یک ستون shipping_calculation_mode تازه، با CHECK جدید و گسترده‌تر،
--      اضافه می‌شود (ADD COLUMN؛ چون این ستون تازه است، محدودیت شناخته‌شده
--      D1/SQLite درباره CHECK وابسته‌به‌پیش‌فرض روی ADD COLUMN اینجا مطرح
--      نیست، چون CHECK فقط به مقدار خودِ همین ستون وابسته است، نه ستون
--      دیگری، و DEFAULT انتخابی ('engine') از قبل عضو همان CHECK است).
--   ۳) مقدار واقعی قبلی (هرچه بود: 'table_rate' یا 'engine') از ستون موقت
--      به ستون جدید کپی می‌شود؛ اگر مقداری خارج از فهرست مجاز جدید بود (که
--      طبق تعریف قبلی نباید پیش بیاید)، به‌صورت ایمن 'engine' می‌گیرد —
--      همان رفتار Fail-Safe فعلی کد.
--   ۴) ستون موقت حذف می‌شود (DROP COLUMN — باز هم فقط همین یک ستون، نه کل
--      جدول).
-- نتیجه دقیقاً همان چیزی است که نسخه قبلی می‌خواست (CHECK از
-- IN ('table_rate','engine') به IN ('table_rate','engine','online',
-- 'online_fallback_internal') گسترش می‌یابد، DEFAULT از 'internal' به
-- 'engine' اصلاح می‌شود)، اما بدون هیچ فرضی درباره باقی ستون‌های جدول و
-- بدون هیچ ریسکی برای ستون‌های ناشناخته احتمالی Production.
--
-- مقدار پیش‌فرض ستون از 'internal' (که خودش دیگر در CHECK واقعی مجاز
-- نیست) به 'engine' اصلاح شد — دقیقاً همان مقداری که کد از این پس برای
-- «فقط موتور داخلی» می‌نویسد (src/shipping-engine.js:
-- toStoredCalculationMode). این تغییر پیش‌فرض هیچ رفتاری را عوض نمی‌کند؛
-- چون هم 'engine' و هم مقدار قبلاً ذخیره‌شده 'table_rate' هر دو در کد به
-- یک معنا («internal» / فقط موتور داخلی) تعبیر می‌شوند.
--
-- اجرا (فقط همین یک فایل؛ Migrationهای قبلی دوباره اجرا نشوند؛ این فایل
-- خودش هم فقط یک‌بار قابل اجراست، چون ستون موقت را در پایان حذف می‌کند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/shipping-calculation-mode-v2.sql
-- ==========================================================================

ALTER TABLE site_settings
  RENAME COLUMN shipping_calculation_mode TO shipping_calculation_mode_legacy_v1;

ALTER TABLE site_settings
  ADD COLUMN shipping_calculation_mode TEXT NOT NULL DEFAULT 'engine'
    CHECK (shipping_calculation_mode IN ('table_rate', 'engine', 'online', 'online_fallback_internal'));

UPDATE site_settings
SET shipping_calculation_mode = CASE
  WHEN shipping_calculation_mode_legacy_v1 IN ('table_rate', 'engine', 'online', 'online_fallback_internal')
    THEN shipping_calculation_mode_legacy_v1
  ELSE 'engine'
END;

ALTER TABLE site_settings DROP COLUMN shipping_calculation_mode_legacy_v1;
