-- ==========================================================================
-- تأسیسات آپادانا — Migration: دسته‌بندی محصولات + روابط محصولات +
-- زیرساخت «مشتریان همراه این محصول خریده‌اند» + پرچم‌های نمایش عمومی آینده
-- ==========================================================================
--
-- کاملاً افزودنی (additive) است:
--   - فقط جدول جدید می‌سازد (CREATE TABLE IF NOT EXISTS)
--   - فقط ستون جدید به جدول‌های موجود «products» و «site_settings» اضافه
--     می‌کند (ALTER TABLE ADD COLUMN، همگی NULL/پیش‌فرض‌دار)
--   - هیچ DROP، DELETE، TRUNCATE یا تغییری روی داده‌های موجود (محصولات،
--     مشخصات، تصاویر، برند، قیمت و ...) انجام نمی‌دهد. محصولات فعلی دقیقاً
--     با همان مقادیر باقی می‌مانند؛ category_id برای همه آنها فعلاً NULL
--     خواهد بود (یعنی «بدون دسته») تا از پنل مدیریت تعیین شود.
--
-- نکته اجرا (مثل migrationهای قبلی پروژه):
-- SQLite/D1 از "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" پشتیبانی نمی‌کند.
-- این فایل قرار است فقط یک‌بار روی دیتابیس فعلی اجرا شود. اگر بخشی از آن
-- قبلاً اجرا شده، همان بخش را قبل از اجرای دوباره حذف کنید تا خطای
-- "duplicate column name" نگیرید.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/categories-and-relations.sql
-- (برای تست محلی، پرچم --remote را حذف کنید.)
-- ==========================================================================


-- --------------------------------------------------------------------------
-- ۱) دسته‌بندی محصولات — یک جدول خودارجاع (self-referential) به‌جای دو
--    جدول جدا برای «دسته اصلی» و «زیردسته»؛ با parent_id یک درخت نامحدود
--    (نه فقط دو سطح) پشتیبانی می‌شود، بدون نیاز به Hard-code کردن هیچ نامی.
--    ایجاد/ویرایش/فعال‌سازی/غیرفعال‌سازی/تغییر والد، همگی فقط تغییر ردیف در
--    همین جدول هستند — نیازی به تغییر کد Worker یا Deploy مجدد نیست.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  parent_id   INTEGER,               -- NULL = دسته اصلی (ریشه)
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id, sort_order);


-- --------------------------------------------------------------------------
-- ۲) اتصال محصول به دسته — ستون جدید و nullable روی جدول موجود products.
--    محصولات فعلی نیازی به ایجاد مجدد ندارند؛ فقط این یک ستون برایشان از
--    پنل مدیریت پر می‌شود. برند/مدل/SKU/قیمت/تصاویر/مشخصات فعلی دست‌نخورده
--    می‌مانند (این migration به آن ستون‌ها کاری ندارد).
-- --------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);


-- --------------------------------------------------------------------------
-- ۳) روابط بین محصولات — یک جدول عمومی و قابل توسعه با ستون relation_type،
--    به‌جای سه جدول جدا برای مرتبط/مشابه/مکمل. نوع رابطه جدید در آینده فقط
--    یک مقدار متنی تازه در همین ستون است؛ نیازی به Migration جدید نیست.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_relations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          INTEGER NOT NULL,
  related_product_id  INTEGER NOT NULL,
  relation_type       TEXT NOT NULL,   -- related | similar | complementary | (آینده: ...)
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (related_product_id) REFERENCES products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_relations_unique
  ON product_relations(product_id, related_product_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_product_relations_lookup
  ON product_relations(product_id, relation_type, sort_order);


-- --------------------------------------------------------------------------
-- ۴) «مشتریان همراه این محصول خریده‌اند» — جدول شمارنده تجمیعی (denormalized)
--    به‌جای JOIN زنده و سنگین روی همه سفارش‌های تاریخ. هر بار سفارش جدیدی با
--    بیش از یک قلم ثبت شود، برای هر جفت محصول داخل همان سفارش، شمارنده هر دو
--    جهت (A→B و B→A) یک واحد اضافه می‌شود. با رشد تعداد سفارش‌ها، خواندن
--    پیشنهاد برای یک محصول همیشه فقط یک SELECT ساده و ایندکس‌شده می‌ماند.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_co_purchases (
  product_id         INTEGER NOT NULL,
  co_product_id      INTEGER NOT NULL,
  times_together     INTEGER NOT NULL DEFAULT 0,
  last_purchased_at  TEXT,
  PRIMARY KEY (product_id, co_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_co_purchases_ranking
  ON product_co_purchases(product_id, times_together DESC);


-- --------------------------------------------------------------------------
-- ۵) پرچم‌های نمایش عمومی (Feature Flags) — روی همان جدول تک‌رکوردی
--    site_settings که از قبل برای توقف/فعال‌سازی فروشگاه استفاده می‌شود.
--    مقدار پیش‌فرض همه صفر (خاموش) است تا هیچ قابلیت جدیدی بدون تصمیم صریح
--    مدیر از پنل، برای مشتری نمایش داده نشود. فعال‌سازی هرکدام در آینده فقط
--    یک تغییر مقدار از پنل مدیریت است، نه تغییر کد.
-- --------------------------------------------------------------------------

ALTER TABLE site_settings ADD COLUMN show_categories_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_settings ADD COLUMN show_related_products INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_settings ADD COLUMN show_similar_products INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_settings ADD COLUMN show_cart_suggestions INTEGER NOT NULL DEFAULT 0;
