-- =========================================================================
-- فقط خواندنی (Read-only) — برای اجرا در D1 Console. هیچ داده‌ای تغییر نمی‌کند.
-- هدف: مشخص کردن اینکه چرا INSERT در shipping_quote_history رکورد جدیدی نمی‌سازد.
-- =========================================================================

-- ۱) Schema واقعی جدول (به‌ویژه CHECK constraintهای پنهان روی calculation_mode و status)
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shipping_quote_history';

-- ۲) ۱۰ رکورد آخر Audit
SELECT id, created_at, provider_code, calculation_mode, status, error_code, substr(error_message, 1, 160) AS error_message
FROM shipping_quote_history ORDER BY id DESC LIMIT 10;

-- ۳) حالت محاسبه ذخیره‌شده و تنظیمات Provider
SELECT shipping_calculation_mode FROM site_settings WHERE id = 1;
SELECT code, status, mode, fallback_provider_code, config_json FROM shipping_providers WHERE code = 'tapin';

-- ۴) داده محصول تست (ابعاد/وزن که Tapin از آن استفاده می‌کند)
SELECT id, price, weight_grams, length_cm, width_cm, height_cm,
       package_length_cm, package_width_cm, package_height_cm, package_weight_grams,
       packaging_profile_id, shipping_class_id
FROM products WHERE id = 8;
