-- ==========================================================================
-- تأسیسات آپادانا — Migration: معماری عمومی محتوای فنی (نسخه ۳ — اصلاح اصولی)
-- ==========================================================================
-- چرا این Migration لازم شد (خلاصه؛ توضیح کامل در technical-format-report.md):
--
-- نسخه قبلی (v2) دو مشکل واقعی داشت که فقط با تغییر Schema قابل حل بودند:
--
-- ۱) تداخل بین یک واحد شناخته‌شده (مثلاً «Pa») و یک قانون عمومی
--    subscript (پیشوند «P»): چون هر دو روی متن «Pa» تطابق دارند، بدون یک
--    مکانیزم اولویت‌بندی، ممکن بود واحد Pascal اشتباهاً به Pₐ (زیرنویس)
--    تبدیل شود. حل این تداخل به یک مکانیزم عمومی «اولویت بین rule_typeها»
--    نیاز داشت که در کد (src/technical-format.js) پیاده شده، نه در Schema؛
--    اما یک rule_type جدید («exception») برای پوشش موارد استثنای صریح که
--    خودِ دستور صراحتاً خواسته بود، فقط با تغییر Schema ممکن است.
--
-- ۲) قانون auto_script قبلی همیشه دنباله را با یک الگوی ثابت [A-Za-z0-9]{1,3}
--    تشخیص می‌داد. این برای notationهایی مثل m² / m³ (که فقط باید رقم
--    بپذیرند، نه حرف) خطرناک بود — مثلاً کلمه معمولی «map» می‌توانست با
--    پیشوند «m» اشتباهی به «mₐₚ» تبدیل شود. دو ستون جدید (suffix_mode و
--    max_suffix_len) این رفتار را per-rule و از پنل/دیتابیس قابل‌تنظیم
--    می‌کنند، بدون نیاز به هیچ تغییر کدی برای notation بعدی.
--
-- چون rule_type قبلی با CHECK محدود به ('token','unit','auto_script') بود
-- و SQLite امکان ALTER مستقیم CHECK را نمی‌دهد، جدول با همان الگوی
-- استاندارد SQLite بازسازی می‌شود (ساخت جدول جدید → کپی داده → حذف قدیمی →
-- تغییرنام) — تمام قوانین موجود (Q، P، °C) دقیقاً حفظ می‌شوند.
--
-- اجرا (فقط همین یک فایل جدید؛ Migrationهای قبلی technical-format-rules*
-- دوباره اجرا نشوند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/technical-format-rules-v3.sql
-- ==========================================================================

CREATE TABLE technical_format_rules_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type      TEXT NOT NULL CHECK (rule_type IN ('token', 'unit', 'auto_script', 'exception')),
  match_value    TEXT NOT NULL,
  display_value  TEXT NOT NULL DEFAULT '',
  script_type    TEXT CHECK (script_type IN ('subscript', 'superscript') OR script_type IS NULL),
  -- suffix_mode فقط برای auto_script معنا دارد:
  --   'alnum'  → دنباله می‌تواند حرف یا رقم باشد (پیش‌فرض؛ برای Qn/Qm/Pmax/...)
  --   'digits' → دنباله فقط می‌تواند رقم باشد (برای نمادهایی مثل m²/m³ که
  --              نباید هیچ کلمه معمولی حرفی را بگیرند)
  suffix_mode    TEXT CHECK (suffix_mode IN ('alnum', 'digits') OR suffix_mode IS NULL),
  -- حداکثر طول دنباله بعد از پیشوند (پیش‌فرض ۳، همان مقدار ثابت قبلی که
  -- حالا per-rule و بدون تغییر کد قابل تنظیم است؛ سقف امنیتی ۶ در خودِ
  -- موتور نیز رعایت می‌شود تا یک مقدار غلط کل کلمه را نگیرد).
  max_suffix_len INTEGER NOT NULL DEFAULT 3,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO technical_format_rules_new
  (id, rule_type, match_value, display_value, script_type, suffix_mode, max_suffix_len, active, sort_order, created_at, updated_at)
SELECT
  id, rule_type, match_value, display_value, script_type,
  CASE WHEN rule_type = 'auto_script' THEN 'alnum' ELSE NULL END,
  3,
  active, sort_order, created_at, updated_at
FROM technical_format_rules;

DROP TABLE technical_format_rules;
ALTER TABLE technical_format_rules_new RENAME TO technical_format_rules;

CREATE UNIQUE INDEX IF NOT EXISTS idx_technical_format_rules_unique
  ON technical_format_rules(rule_type, match_value);
CREATE INDEX IF NOT EXISTS idx_technical_format_rules_active
  ON technical_format_rules(active);

-- --------------------------------------------------------------------------
-- ردیف‌های جدید — طبق فهرست دستور، فقط واحدهایی که ریسک برخورد پایینی
-- دارند (چندحرفی، بعید است با کد مدل/نام محصول اشتباه گرفته شوند) به‌صورت
-- پیش‌فرض فعال می‌شوند. واحدهای تک‌حرفی پرریسک (W، V، A) عمداً seed
-- نشده‌اند؛ دلیل کامل در گزارش. مدیر می‌تواند با یک INSERT مشابه، هر کدام
-- را در آینده اضافه کند — بدون نیاز به Deploy یا تغییر کد.
-- --------------------------------------------------------------------------
INSERT INTO technical_format_rules (rule_type, match_value, display_value, sort_order) VALUES
  ('unit', 'F',   '°F',  21),
  ('unit', 'bar', 'bar', 22),
  ('unit', 'Pa',  'Pa',  23),
  ('unit', 'kPa', 'kPa', 24),
  ('unit', 'MPa', 'MPa', 25),
  ('unit', 'kW',  'kW',  26),
  ('unit', 'kWh', 'kWh', 27),
  ('unit', 'Hz',  'Hz',  28),
  ('unit', 'RPM', 'RPM', 29);

-- notation عمومی بالانویس برای واحد سطح/حجم (m² / m³ / ...) — یک قانون
-- واحد، همه توان‌های آینده روی m را هم پوشش می‌دهد (مثلاً m4 در صورت نیاز
-- مهندسی نامعمول)، بدون افزودن Rule جدید. suffix_mode='digits' یعنی این
-- قانون هرگز کلمه حرفی معمولی که با «m» شروع شود را نمی‌گیرد.
INSERT INTO technical_format_rules (rule_type, match_value, script_type, suffix_mode, max_suffix_len, sort_order) VALUES
  ('auto_script', 'm', 'superscript', 'digits', 1, 7);
