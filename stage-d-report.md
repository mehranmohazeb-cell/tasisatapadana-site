# گزارش نهایی Stage D — پاکسازی نهایی باقی‌مانده‌های Legacy Shipping

## ۱) Source of Truth
- ZIP مرجع: `tasisatapadana-site-stageC-remove-legacy-shipping-fields.zip`
- SHA-256 اعلام‌شده: `d1307e4ccac41e9eed9114d1485796594338e088b411c14394d20131f84be89e`
- SHA-256 محاسبه‌شدهٔ فایل دریافتی: **دقیقاً مطابق**. کار فقط روی همین ZIP انجام شد.

## ۲) Pre-change Audit (باقی‌مانده‌های Stage C)
جستجوی کل پروژه (قبل از تغییر) برای: `product.html.bak`، `.product-shipping-info`، `shipping_cost|method|time`، `renderShippingBlock`، `resolveShippingInfo`، `STORE_DEFAULT_SHIPPING_`. تفکیک دو گروه همیشه رعایت شد: ستون‌های **محصول** (`products.*`) در برابر ستون‌های **سفارش** (`orders.shipping_cost`، `shipping_method_id/name`).

| مورد | وضعیت قبل از Stage D | حکم |
|---|---|---|
| `public/store/product.html.bak` | وجود داشت (شامل `renderShippingBlock` و `.product-shipping-info`) | حذف شد |
| `.product-shipping-info` | ۲ قاعده در `public/store/store.css` (خط ۶۸۲ و ۶۹۴) + یک مورد در `.bak`؛ هیچ المان فعالی نداشت | حذف شد |
| سه کلید قدیمی در GET ادمین محصولات | در `src/index.js` (SELECT لیست ادمین) | حذف شد |
| `renderShippingBlock` / `resolveShippingInfo` / `STORE_DEFAULT_SHIPPING_` | فقط در `.bak`، گزارش‌ها، تست‌ها و یک کامنت `src/index.js` | سورس فعال: ۰ (کامنت بازنویسی شد) |
| `orders.shipping_cost`، `shipping_method_id/name`، `expected/actual_shipping_cost` | وابستگی واقعی سفارش/Checkout | **دست‌نخورده** |

## ۳) Changes (دقیق)
| فایل | تغییر |
|---|---|
| `public/store/product.html.bak` | **حذف شد** |
| `public/store/store.css` | حذف دقیقاً ۱۸ خط: کامنت سرتیتر همین بلوک + دو قاعدهٔ `.product-shipping-info` و `.product-shipping-info div` (۴۰۳ بایت). پایان خط‌ها (CRLF) و بقیهٔ فایل بایت‌به‌بایت حفظ شد |
| `src/index.js` | (الف) حذف `shipping_cost, shipping_method, shipping_time` از SELECT لیست ادمین محصولات؛ (ب) بازنویسی یک کامنت تا نام‌های حذف‌شده در سورس نماند. هیچ منطق دیگری تغییر نکرد |
| `test/admin-shipping-stage-c.test.mjs` | **یک assertion عمداً برعکس شد** (قبلاً می‌گفت «ادمین هنوز سه ستون را برمی‌گرداند»؛ حالا «برنمی‌گرداند و داده‌ی D1 دست‌نخورده است») — مستقیماً نتیجهٔ تغییر خواسته‌شده |
| `test/admin-shipping-stage-d.test.mjs` | جدید — ۲۱ تست |
| `test/browser/stage-d-legacy-cleanup.browser.py` | جدید — ۳۰ تست Chromium واقعی |
| `stage-d-report.md` | جدید |

هیچ‌چیز در `public/admin/` تغییر نکرد (UI ادمین از Stage C دیگر به این فیلدها وابسته نبود).

## ۴) Backup Removal
`public/store/product.html.bak` حذف شد. `.assetsignore` ساخته نشد و نسخهٔ مشابهی در `public/` ایجاد نشد؛ جست‌وجوی گستردهٔ فایل‌های Backup انجام نشد (Scope فقط همین یک فایل). تست: فایل در سورس نیست؛ در مرورگر، `GET /store/product.html.bak` → ۴۰۴؛ `product.html` اصلی سالم سرو می‌شود. توجه: روی سایت زنده تا **Deploy بعدی** این فایل همچنان می‌تواند سرو شود (من Deploy نکردم)؛ بعد از Deploy پیشنهاد می‌شود آدرس مستقیم را یک‌بار دستی باز کنید.

## ۵) Admin API Cleanup
`GET /api/store/products` (ادمین، با `X-Admin-Token`) دیگر `shipping_cost`/`shipping_method`/`shipping_time` را برنمی‌گرداند. تست‌ها (Node و پاسخ واقعی در مرورگر): نبودن کلیدها و نبودن مقدار قدیمی در JSON؛ و سالم‌بودن بقیه: صفحه‌بندی، جست‌وجو (`q`)، فیلتر `active`، کلیدهای فرم محصول (کلاس، وزن/ابعاد، Packaging، تصاویر، specs)، احراز هویت (کاربر ناشناس محصول غیرفعال نمی‌بیند). Shipping Class، Shipping Summary و Override (چرخهٔ NULL ← freight ← normal) پس از تغییر همچنان کار می‌کنند.

## ۶) CSS Cleanup
فقط بلوک `.product-shipping-info` حذف شد. قبل از حذف تأیید شد هیچ المان/اسکریپت/صفحهٔ فعالی آن را مصرف نمی‌کند (`public/` و `src/` = ۰ مورد). قواعد `.shipping-estimator` (۵ مورد) و CSS عمومی صفحهٔ محصول دست‌نخورده‌اند؛ در مرورگر، کادر برآوردگر همچنان با استایل نمایش داده می‌شود. هیچ CSS cleanup گسترده‌ای انجام نشد.

## ۷) Database Safety
- هیچ ستونی حذف یا Rename نشد: `products.shipping_cost/method/time` در schema هستند (تست `PRAGMA table_info`).
- هیچ داده‌ای حذف نشد: محصول دارای داده‌ی قدیمی بعد از GET ادمین، SSR، API عمومی، چندین Save محصول، Save کلاینت قدیمی و ذخیرهٔ Override، **همان مقدار قبلی** را دارد (Node و مرورگر).
- هیچ Migration ساخته نشد: پوشهٔ `database/` بایت‌به‌بایت یکسان است (۲۲ فایل، اثرانگشت ثابت در تست). D1 Production تغییر نکرد؛ تست‌ها فقط روی دیتابیس موقت حافظه‌ای اجرا شدند.

## ۸) Shipping Safety
- `src/shipping-routing.js`، `src/shipping-engine.js`، `src/packaging-estimation.js`: بایت‌به‌بایت یکسان (در تست قفل شده).
- Routing، Route Policy، Override، Shipping Class، Packaging، Tapin، VPS/Proxy، Checkout، City Selector، تعرفه‌ها، Providers، Calculation Mode، Quote History: تغییر نکردند. برآوردگر واقعی ارسال صفحهٔ محصول سالم است.
- رفتار POST/PUT محصول (Stage C) حفظ شد: ستون‌های قدیمی نه خوانده و نه نوشته می‌شوند؛ کلاینت قدیمی که آن‌ها را بفرستد بی‌اثر پذیرفته می‌شود (۲۰۰).

## ۹) Tests
| Suite | نتیجه |
|---|---|
| **admin-shipping-stage-d (جدید)** | ۲۱ سبز / ۰ شکست |
| admin-shipping-stage-c | ۱۶ / ۰ |
| admin-shipping-stage-b | ۲۰ / ۰ |
| admin-shipping-stage-a | ۲۹ / ۰ |
| shipping-routing | ۲۳ / ۰ |
| shipping-shared-quote | ۲۱ / ۰ |
| shipping-freight-message | ۶ / ۰ |
| shipping-preview-mode-override | ۸ / ۰ |
| shipping-audit-diagnostics | ۱۰ / ۰ |
| packaging-estimation | ۲۵ / ۰ |
| shipping-calculation-mode | ۹ / ۰ |
| shipping-quote-history | ۴ / ۰ |
| shipping-tariff-import | ۴ / ۰ |
| tapin-proxy | ۳۰ / ۰ |
| browser Stage B | ۴۵ / ۰ |
| browser Stage C | ۵۱ / ۰ |
| **browser Stage D (جدید)** | ۳۰ / ۰ |

تست‌های جدید Stage D (پوشش A تا F دستور): A) نبودن `.bak` و `.assetsignore`؛ B) GET ادمین بدون سه کلید + سلامت لیست/Product Admin/Class/Override/Summary؛ C) ستون‌ها در schema، داده بدون تغییر، `database/` بدون Migration جدید یا `DROP/RENAME COLUMN` روی ستون‌های ارسال محصول؛ D) Save محصول حافظ داده‌ی قدیمی (فرم جدید، چند Save، کلاینت قدیمی، Override، محصول جدید)؛ E) SSR و `product.html` و API عمومی؛ F) نبودن `.product-shipping-info` و وجود CSS برآوردگر؛ G) قفل هش موتور و نبودن نام‌های حذف‌شده در سورس فعال.
**اعتبارسنجی خود تست‌ها:** روی نسخهٔ Stage C (قبل از تغییر) → ۶ شکست و ۱۵ موفق؛ بعد از تغییر → ۲۱ موفق.
**شفافیت:** در اجرای اول ۴ تست شکست خوردند؛ هر ۴ ایراد خود تست بود، نه محصول (داده‌ی آزمایشی با Override اولیه، پنجرهٔ بررسی SQL بیش‌ازحد گسترده که Query سفارش مجاور را می‌گرفت، Migration تاریخی `site_settings` که `RENAME COLUMN` دارد، و کامنت داخل `<script>` صفحه). همه اصلاح شدند و هیچ تستی حذف یا غیرفعال نشد.

## ۱۰) Browser Test
**Chromium واقعی (Playwright) انجام شد**، با Worker واقعی + D1 آزمایشی و فایل‌های استاتیک واقعی. بررسی: `/store/product.html.bak` ← ۴۰۴؛ CSS سرو‌شده بدون `.product-shipping-info` و با `.shipping-estimator`؛ Product Admin: نبودن سه فیلد، پاسخ واقعی GET بدون سه کلید و بدون نشت مقدار، Shipping Class، Summary، Override سه‌حالته با دکمهٔ ذخیرهٔ جدا (freight ← NULL)، Save محصول بدون تغییر داده‌ی قدیمی؛ صفحهٔ عمومی دو محصول (با و بدون داده‌ی قدیمی): نبودن بلوک/متن قدیمی، وجود برآوردگر، اعمال CSS آن، بدون خطای JavaScript. اسکرین‌شات‌ها بازبینی چشمی شد (`stageD-screenshots/`). محدودیت: مرورگر دیگر/موبایل بررسی نشد؛ تصویر محصول در اسکرین‌شات به‌خاطر فایل آزمایشی ناموجود شکسته است.

## ۱۱) Final Search
**نام‌های حذف‌شده در سورس فعال (src/، public/، database/):** `product.html.bak` ۰ · `product-shipping-info` ۰ · `renderShippingBlock` ۰ · `resolveShippingInfo` ۰ · `STORE_DEFAULT_SHIPPING_` ۰. (فقط در تست‌هایی که عمداً نبودنشان را بررسی می‌کنند و در گزارش‌های تاریخی `.md` می‌آیند.)

**`shipping_cost|method|time` — کل ۹۵ مورد (شمارش پیش از افزودن همین گزارش؛ خودِ این گزارش هم این نام‌ها را به‌عنوان مستندات ذکر می‌کند):**
| گروه | تعداد | محل | وضعیت |
|---|---|---|---|
| Product Admin Legacy UI | ۰ | — | ✔ صفر |
| Public Product Legacy UI | ۰ | — | ✔ صفر |
| SSR Legacy | ۰ | — | ✔ صفر |
| Legacy Product API | ۰ | — | ✔ صفر |
| Legacy CSS / Backup عمومی | ۰ | — | ✔ صفر |
| Database schema / Migration تاریخی | ۷ | `database/` (۴ ALTER: ۳ ستون محصول + ۱ ستون سفارش؛ ۳ کامنت) | مجاز |
| Orders/Checkout واقعی | ۱۵ | `src/index.js` ×۹، `orders.js` ×۲، `checkout.html` ×۳ (نام فیلد رادیو)، `invoice.html` ×۱ | مجاز |
| alias ستون CSV Import تعرفه (بی‌ربط به محصول) | ۱ | `src/index.js:4889` | مجاز |
| کامنت‌های توضیح تصمیم Stage C | ۲ | `src/index.js:2904, 3083` | مجاز |
| تست‌ها (از جمله تست‌های Stage D که عمداً این نام‌ها را بررسی می‌کنند) | ۶۱ | `test/**` | مجاز |
| Documentation | ۹ | `stage-c-report.md` ×۷، `packaging-estimation-report.md` ×۲ | مجاز |

## ۱۲) Known Limitations
1. **Deploy:** تا Deploy بعدی، فایل `.bak` روی سایت زنده (اگر قبلاً Deploy شده) ممکن است هنوز سرو شود؛ پس از Deploy باید دستی تأیید شود. Deploy انجام نشد.
2. **ستون‌های قدیمی D1 هنوز وجود دارند** و برای محصولات قدیمی داده دارند، ولی از هیچ API یا UI قابل دیدن/ویرایش نیستند (عمداً؛ تصمیم حذف/Archive نهایی پایگاه داده با شماست).
3. **کلاینت قدیمی** که سه فیلد را به POST/PUT بفرستد خطا نمی‌گیرد و نادیده گرفته می‌شود.
4. در `store.css` کامنت‌های سرتیتر بعضی بخش‌ها (از جمله همان بلوک حذف‌شده) از قبل به‌صورت متن خراب (Mojibake) ذخیره شده‌اند؛ دست نزدم (خارج از Scope).
5. موردی که نیاز به تصمیم معماری داشته باشد پیدا نشد.

## تأیید صریح
- Deploy انجام نشد. هیچ SQL روی D1 (Production یا غیر) اجرا نشد. VPS/Proxy/Tapin دست نخورد.
- هیچ ستون یا داده‌ای حذف نشد و Migration جدیدی ساخته نشد.
- Routing، Engine، Packaging، Checkout، City Selector، تعرفه‌ها تغییر نکردند.
- فقط سه کار خواسته‌شده انجام شد؛ هیچ قابلیت جدید یا redesign اضافه نشد.
- Stage E یا هیچ مرحلهٔ بعدی اجرا نشد.

### فایل‌های تغییرکرده نسبت به ZIP مرجع
**حذف:** `public/store/product.html.bak`
**ویرایش:** `public/store/store.css` · `src/index.js` · `test/admin-shipping-stage-c.test.mjs` (یک assertion)
**جدید:** `test/admin-shipping-stage-d.test.mjs` · `test/browser/stage-d-legacy-cleanup.browser.py` · `stage-d-report.md`

برای ادامه، دستور «ادامه بده» را دریافت کردم.
