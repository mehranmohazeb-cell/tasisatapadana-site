-- ==========================================================================
-- تأسیسات آپادانا — Migration جدید: معماری عمومی محتوای فنی (نسخه ۲)
-- ==========================================================================
-- چرا این Migration لازم شد:
-- نسخه قبلی «technical_format_rules» فقط دو نوع قانون داشت: rule_type='token'
-- (جایگزینی دقیق یک کلمه، مثلاً Qn→Qₙ) و rule_type='unit' (عدد+واحد).
-- طبق این دستور، حل موردی (یک Rule جدا برای Qm، یک Rule جدا برای Pm، ...)
-- ممنوع است؛ باید یک مکانیزم عمومی زیرنویس/بالانویس ساخته شود که با یک
-- قانون واحد، همه ترکیب‌های آینده را هم پوشش دهد.
--
-- rule_type جدید: 'auto_script'
--   match_value = پیشوند (مثلاً "Q" یا "P")
--   script_type = 'subscript' یا 'superscript'
--   هر متنی که این پیشوند + یک یا چند نویسه قابل‌تبدیل (حروف/ارقام) را
--   داشته باشد، آن بخش را خودکار به یونیکد زیرنویس/بالانویس تبدیل می‌کند.
--   مثال: Q + "n" یا "m" یا "max" یا "min" → Qₙ, Qₘ, Qₘₐₓ, Qₘᵢₙ — همه با
--   همین یک قانون، بدون افزودن Rule جدا برای هرکدام. اگر یک نویسه معادل
--   یونیکد نداشته باشد (نویسه‌های نادر)، دست‌نخورده باقی می‌ماند — هرگز
--   تبدیل حدسی/نادرست انجام نمی‌شود.
--   همین قانون به‌صورت عمومی برای فرمول‌های ساده مثل H2O→H₂O هم کار می‌کند
--   اگر مدیر یک قانون auto_script با پیشوند "H" اضافه کند (پیش‌فرض این
--   پروژه چنین قانونی اضافه نمی‌کند چون ریسک برخورد با کدهای مدل مثل
--   "H100" وجود دارد؛ تصمیم اضافه‌کردن آن با مدیر است).
--
-- چون rule_type قبلی با CHECK محدود به ('token','unit') بود و SQLite امکان
-- ALTER مستقیم CHECK را نمی‌دهد، جدول با همان الگوی استاندارد SQLite
-- بازسازی می‌شود (ساخت جدول جدید → کپی داده → حذف قدیمی → تغییرنام) —
-- تمام قوانین موجود (از جمله قانون واحد °C) دقیقاً حفظ می‌شوند.
--
-- اجرا (فقط همین یک فایل جدید؛ Migrationهای قبلی دوباره اجرا نشوند):
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/technical-format-rules-v2.sql
-- ==========================================================================

CREATE TABLE technical_format_rules_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type     TEXT NOT NULL CHECK (rule_type IN ('token', 'unit', 'auto_script')),
  match_value   TEXT NOT NULL,
  display_value TEXT NOT NULL DEFAULT '',
  script_type   TEXT CHECK (script_type IN ('subscript', 'superscript') OR script_type IS NULL),
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO technical_format_rules_new
  (id, rule_type, match_value, display_value, script_type, active, sort_order, created_at, updated_at)
SELECT id, rule_type, match_value, display_value, NULL, active, sort_order, created_at, updated_at
FROM technical_format_rules;

DROP TABLE technical_format_rules;
ALTER TABLE technical_format_rules_new RENAME TO technical_format_rules;

CREATE UNIQUE INDEX IF NOT EXISTS idx_technical_format_rules_unique
  ON technical_format_rules(rule_type, match_value);
CREATE INDEX IF NOT EXISTS idx_technical_format_rules_active
  ON technical_format_rules(active);

-- قانون قبلی «Qn به‌صورت متن ثابت» با قانون عمومی جایگزین می‌شود (همان
-- خروجی Qₙ را می‌دهد، ولی حالا Qm/Qmax/Qmin/... را هم خودکار پوشش می‌دهد).
DELETE FROM technical_format_rules WHERE rule_type = 'token' AND match_value = 'Qn';

INSERT INTO technical_format_rules (rule_type, match_value, display_value, script_type, sort_order) VALUES
  ('auto_script', 'Q', 'زیرنویس خودکار بعد از Q (مثل Qn، Qm، Qmax، Qmin)', 'subscript', 5),
  ('auto_script', 'P', 'زیرنویس خودکار بعد از P (مثل Pn، Pm)', 'subscript', 6);
