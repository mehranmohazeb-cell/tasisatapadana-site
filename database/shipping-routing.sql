-- ==========================================================================
-- تأسیسات آپادانا — Migration مرحله ۲: Routing قطعی ارسال (Normal / Freight / پیک اصفهان)
-- ==========================================================================
-- کاملاً افزایشی (ADD COLUMN / CREATE TABLE IF NOT EXISTS) و بدون تغییر داده‌های فعلی:
-- با اجرای این فایل هیچ محصولی خودکار «باربری» نمی‌شود (همه NULL/normal می‌مانند).
--
-- ۱) shipping_classes.route_policy : 'normal' | 'freight'  (NULL = normal)
--    محور اصلی تشخیص «غیرعادی»: کلاس حمل پکیج/آبگرمکن/رادیاتور را مدیر روی 'freight' می‌گذارد.
-- ۲) products.shipping_route_override : 'normal' | 'freight' | NULL (Override مدیریتی محصول)
-- ۳) orders.shipping_payment_mode : 'free' | 'prepaid' | 'receiver_pays'
--    تفکیک «ارسال رایگان» از «پس‌کرایه» (دیگر فقط با shipping_cost=0 تشخیص داده نمی‌شود)
--    orders.shipping_route / shipping_max_dispatch_days : Snapshot مسیر و حداکثر روز ارسال
-- ۴) shipping_route_audit : تاریخچهٔ تغییر مسیر کلاس/Override (قابل Audit و برگشت)
--
-- اجرا (فقط همین یک فایل — هر ALTER فقط یک‌بار؛ اجرای دوباره duplicate column می‌دهد):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/shipping-routing.sql
-- ==========================================================================

ALTER TABLE shipping_classes ADD COLUMN route_policy TEXT CHECK (route_policy IN ('normal', 'freight'));
ALTER TABLE products ADD COLUMN shipping_route_override TEXT CHECK (shipping_route_override IN ('normal', 'freight'));
ALTER TABLE orders ADD COLUMN shipping_payment_mode TEXT CHECK (shipping_payment_mode IN ('free', 'prepaid', 'receiver_pays'));
ALTER TABLE orders ADD COLUMN shipping_route TEXT;
ALTER TABLE orders ADD COLUMN shipping_max_dispatch_days INTEGER;

CREATE TABLE IF NOT EXISTS shipping_route_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('shipping_class', 'product')),
  entity_id   INTEGER NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shipping_route_audit_entity ON shipping_route_audit(entity_type, entity_id);

-- نکته: «حداقل مبلغ سفارش برای پیک رایگان اصفهان» عمداً ستون/Setting فعال ندارد؛
-- نیاز به تصمیم مدیریتی دربارهٔ رفتار زیر حداقل (گزارش مرحله ۲، بخش ۱۹).
