# گزارش نهایی Stage C — حذف نمایش فیلدهای قدیمی ارسال محصول

## ۱) Source of Truth
- ZIP مرجع: `tasisatapadana-site-stageB-product-route-override.zip`
- SHA-256 اعلام‌شده: `645a1bbcbd86cb87329c316481931b2a7f8154f4c92c455d24800c7fc7fe8f67`
- SHA-256 محاسبه‌شدهٔ فایل دریافتی: **مطابق** (دقیقاً برابر). کار با همین ZIP انجام شد.

## ۲) Pre-change Audit (قبل از هر تغییر، کل پروژه)
جستجو روی کل پروژه برای `shipping_cost / shipping_method / shipping_time` (به‌علاوهٔ شناسه‌های DOM با خط‌تیره، `shippingCost…`، `renderShippingBlock`، `resolveShippingInfo`، `STORE_DEFAULT_SHIPPING_*`). مهم: `shipping_cost` و `shipping_method*` در سفارش/Checkout **ستون‌های دیگری با همین نام** هستند (`orders.shipping_cost`, `shipping_method_id/name`) و ربطی به فیلدهای محصول ندارند؛ تفکیک با خواندن زمینهٔ هر مورد انجام شد.

| دسته | یافته‌ها (قبل از تغییر) | حکم |
|---|---|---|
| **A — Product Admin UI** | `products/index.html`: ۳ ورودی (`product-shipping-cost/method/time`) + یادداشت توضیحی Stage A؛ `products.js`: پر کردن فرم (۳ خط)، خواندن مقادیر (۳ خط)، ارسال در payload (۳ خط) | legacy نمایشی ← **حذف شد** |
| **B — Public Product** | `product.html`: تابع `renderShippingBlock` + فراخوانی آن | legacy نمایشی ← **حذف شد** |
| **C — SSR** | `index.js`: `shippingBlock` در `renderProductDetailSsrHtml`، `resolveShippingInfo` + ۳ ثابت پیش‌فرض (`رایگان/پست پیشتاز/حداکثر ۳ روز کاری`) در `buildProductViewModel`، دو SELECT (SSR و API) | legacy نمایشی ← **حذف شد** |
| **D — SEO / JSON-LD** | `buildProductJsonLd` **هیچ‌وقت** این فیلدها یا `shippingDetails` را نداشت (تست روی نسخهٔ Stage B هم همین را نشان داد). تنها مسیر ورود legacy به HTML خزنده‌ها، بلوک SSR بود که حذف شد | بدون وابستگی؛ تغییری لازم نبود |
| **E — API** | (۱) `GET /api/store/products/:slug` (عمومی): ۳ فیلد خام + پیش‌فرض‌های گمراه‌کننده؛ (۲) `GET /api/store/products` عمومی: `shipping_cost`؛ (۳) `GET` ادمین: ۳ ستون؛ (۴) `POST/PUT /api/store/products`: خواندن/نوشتن ۳ ستون | (۱)(۲) حذف شد؛ (۳) حفظ شد؛ (۴) نوشتن متوقف شد (بخش ۳) |
| **F — Order/Checkout/Business** | `orders.shipping_cost`، `shipping_method_id/name`، `expected_shipping_cost`، `actual_shipping_cost`، گزارش‌ها، صورت‌حساب، رادیوی `shipping_method` در checkout، alias ستون CSV «shipping_method» در Import تعرفه | **وابستگی واقعی، دست‌نخورده** — مربوط به فیلدهای محصول نیست |
| **G — DB/Migration** | `product-detail-enhancements.sql` (۳ ALTER روی products + ۱ روی orders)، چند کامنت در Migrationهای دیگر | **دست‌نخورده** |
| **H — Tests** | تست‌های Stage A/B و تست‌های قدیمی shipping/packaging (همه دربارهٔ `orders.shipping_cost` یا داده‌های Archive) | فقط یک assertion از Stage B اصلاح شد (بخش ۳) |

نتیجهٔ Audit دربارهٔ وابستگی واقعی: **هیچ‌یک از سه ستون محصول در Routing، محاسبهٔ هزینه، Checkout، ساخت سفارش یا Engine نقشی نداشت**؛ فقط نمایش.

## ۳) Changes Made
| فایل | تغییر |
|---|---|
| `public/admin/products/index.html` | حذف ۳ فیلد و یادداشت توضیحی Stage A دربارهٔ آن‌ها (بخش‌های Class/Override/Summary/Packaging/وزن و ابعاد دست‌نخورده) |
| `public/admin/products/products.js` | حذف پر کردن/خواندن/ارسال سه فیلد در فرم و payload |
| `public/store/product.html` | حذف `renderShippingBlock` و فراخوانی آن؛ **برآوردگر واقعی ارسال (شهر + `/shipping-methods`) دست‌نخورده** |
| `src/index.js` | (الف) حذف `resolveShippingInfo` و ۳ ثابت پیش‌فرض؛ (ب) حذف `...shipping` از `buildProductViewModel`؛ (ج) حذف بلوک `shippingBlock` از SSR؛ (د) حذف ۳ ستون از SELECT عمومی تک‌محصول، لیست عمومی و SSR؛ (هـ) **POST/PUT محصول دیگر این ۳ ستون را نمی‌خوانند و نمی‌نویسند** |
| `test/admin-shipping-stage-c.test.mjs` | جدید — ۱۶ تست (SSR، JSON-LD، API، حفظ داده، UI، عدم‌تغییر موتور) |
| `test/browser/stage-c-server.mjs`، `stage-c-legacy-fields.browser.py` | جدید — تست Chromium واقعی با Worker واقعی + SSR واقعی (فقط تست) |
| `test/browser/stage-b-product-override.browser.py` | **یک assertion عمداً اصلاح شد**: «سه فیلد قدیمی در فرم هستند» ← «دیگر نیستند» (مستقیماً نتیجهٔ حذف صحیح) |

### نکتهٔ مهم: چرا نوشتن POST/PUT هم تغییر کرد
با حذف فیلدها از فرم، `PUT` قدیمی با نبودن فیلدها مقدار `null` می‌نوشت و **داده‌های موجود D1 را در اولین ذخیرهٔ هر محصول پاک می‌کرد** (این رفتار روی نسخهٔ Stage B با تست تأیید شد و ۹ تست جدید روی آن شکست می‌خورند). برای رعایت «داده حذف نشود»، نوشتن این ۳ ستون متوقف شد: PUT آن‌ها را دست نمی‌زند و POST آن‌ها را NULL می‌گذارد. اگر کلاینت قدیمی هنوز این فیلدها را بفرستد، **بی‌صدا نادیده گرفته می‌شود** (۲۰۰ می‌دهد، بدون خطا).

### تصمیم دربارهٔ APIهای عمومی (بخش E دستور)
در پروژه فقط `product.html` (که حذف شد) این فیلدها را از API عمومی می‌خواند و هیچ مصرف‌کنندهٔ دیگری (store.js، cart، checkout…) نداشت. پاسخ هم پیش‌فرض‌های گمراه‌کنندهٔ «رایگان/پست پیشتاز/۳ روز» را تولید می‌کرد. بنابراین از پاسخ عمومی حذف شد. **ریسک شناخته‌شده:** مصرف‌کنندهٔ خارج از ریپو (اگر باشد) این کلیدها را دیگر نمی‌بیند. بازگرداندن آن یک‌خطی است.

## ۴) Preserved Dependencies (عمداً باقی ماند)
1. **ستون‌های `products.shipping_cost/method/time` در D1 و داده‌هایشان** — Archive.
2. **`GET` ادمین محصولات (`index.js:2457`) همچنان این ۳ ستون را می‌خواند** — فقط‌خواندنی، مخصوص ادمین، بدون مصرف‌کنندهٔ UI؛ برای جلوگیری از شکستن قرارداد ادمین و دید Archive. حذف نهایی → مرحلهٔ بعد (نیازمند تصمیم).
3. `orders.shipping_cost`، `shipping_method_id/name`، `expected_shipping_cost`، `actual_shipping_cost` و گزارش‌هایشان — Checkout/سفارش (وابستگی واقعی).
4. رادیوی `shipping_method` در checkout.html و alias ستون CSV در Import تعرفه — نام‌های بی‌ربط به محصول.
5. برآوردگر ارسال صفحهٔ محصول و `GET /api/store/shipping-methods` — مکانیزم واقعی موجود؛ هیچ متن/قیمت جایگزینی ساخته نشد.
6. برچسب «Shipping Class (برای تعرفه گروهی)» در فرم محصول — برچسب خود کلاس است، نه فیلد قدیمی؛ تغییرش خارج از Scope است.

## ۵) Database Safety
- هیچ ستونی حذف یا Rename نشد.
- هیچ داده‌ای حذف نشد (تست: PUT از فرم جدید داده‌های قدیمی را حفظ می‌کند؛ تست مرورگر روی Worker واقعی همین را تأیید کرد).
- هیچ Migration (حذف ستون یا غیرآن) ساخته نشد؛ پوشهٔ `database/` بایت‌به‌بایت یکسان است.
- D1 Production تغییر نکرد و هیچ SQL روی آن اجرا نشد.

## ۶) Shipping Safety
- `src/shipping-routing.js`، `src/shipping-engine.js`، `src/packaging-estimation.js`: **بایت‌به‌بایت یکسان** (و در تست قفل شده با هش).
- Routing، Tapin، VPS/Proxy، Checkout، City Selector، تعرفه‌ها، Providers، Calculation Mode، Quote History: **تغییر نکردند**.
- رفتار Stage A و B (Route Policy، Summary، Snapshot، Override، دکمهٔ ذخیرهٔ جدا، Unsaved، تأییدیهٔ ذخیرهٔ محصول): حفظ شد و با تست‌های هر دو Stage تأیید شد.

## ۷) Tests
| Suite | نتیجه |
|---|---|
| **admin-shipping-stage-c (جدید)** | ۱۶ سبز / ۰ شکست |
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
| browser Stage B (Chromium) | ۴۵ / ۰ |
| **browser Stage C (Chromium، جدید)** | ۵۱ / ۰ |

**اعتبارسنجی خود تست‌ها:** اجرای تست‌های جدید روی نسخهٔ Stage B (قبل از تغییر) → ۹ شکست و ۷ موفق؛ بعد از تغییر → ۱۶ موفق. (۷ موفق شامل JSON-LD است، چون JSON-LD هیچ‌وقت legacy نداشت.)
**اصلاح تست‌های سخت‌گیر در حین کار** (کد اصلی نبود): سه assertion اولیهٔ من بیش‌ازحد گسترده بودند (شامل `shipping_method_id` در Product Shipping Rates، یک کامنت JS دربارهٔ برچسب، و کامنت Stage C) و با regex/الگوی دقیق‌تر جایگزین شدند؛ در تست مرورگر هم DOM رندرشده بدون `<script>` بررسی می‌شود چون کامنت داخل اسکریپت صفحه برای مشتری نمایش داده نمی‌شود (تأیید شد). هیچ تستی حذف یا غیرفعال نشد.

## ۸) Browser Test
**تست واقعی Chromium (Playwright) انجام شد** — Worker واقعی + D1 آزمایشی؛ ادمین و صفحهٔ عمومی SSR هر دو واقعی (فقط دسته‌بندی‌های ادمین شبیه‌سازی شد). بررسی‌ها: نبودن ۳ فیلد/placeholder/برچسب قدیمی در فرم، وجود Class/Override/Summary/Packaging/وزن و ابعاد، رفتار Override (Unsaved، ذخیرهٔ جدا، بازخوانی از Server)، ذخیرهٔ واقعی محصول بدون پاک‌شدن داده‌های قدیمی، و روی صفحهٔ عمومی (هم HTML خام SSR و هم DOM نهایی پس از JS، برای دو محصول: با داده قدیمی و بدون آن) نبودن همهٔ متن‌های گمراه‌کننده + وجود برآوردگر. اسکرین‌شات‌ها بازبینی چشمی شد (`stageC-screenshots/`). محدودیت: مرورگر دیگر/موبایل بررسی نشد؛ تصویر محصول در اسکرین‌شات شکسته است چون فایل آزمایشی وجود ندارد.

## ۹) Final Search (۱۰۰ مورد در کل پروژه؛ دسته‌بندی)
**نباید باقی می‌ماندند — وضعیت: ۰ مورد**
- Product Admin UI legacy: ۰
- Public Product (`product.html`) legacy display: ۰
- SSR legacy presentation: ۰
- SEO/JSON-LD legacy: ۰

**مجاز و باقی‌مانده:**
| گروه | تعداد | محل |
|---|---|---|
| D1 schema / Migrationهای تاریخی | ۷ | `database/product-detail-enhancements.sql` (۴: ۳ ALTER محصول + ۱ ALTER سفارش)، `packaging-estimation.sql` (۲ کامنت)، `shipping-routing.sql` (۱ کامنت) |
| Business logic واقعی سفارش/Checkout (ستون‌های `orders.*`) | ۱۵ | `src/index.js` ×۹ (خطوط 2551، 2636، 4545، 4553، 4596، 6404، 6564، 6616، 7392)؛ `orders.js` ×۲؛ `checkout.html` ×۳؛ `invoice.html` ×۱ |
| alias ستون CSV در Import تعرفه (بی‌ربط به محصول) | ۱ | `src/index.js:4890` |
| Compatibility: `GET` ادمین محصولات (Archive، فقط‌خواندنی) | ۱ | `src/index.js:2457` |
| کامنت‌های توضیح Stage C | ۵ | `src/index.js` خطوط 67–69، 2905، 3084 |
| تست‌ها (قراردادی/تاریخی/تست‌های Stage C که عمداً این نام‌ها را بررسی می‌کنند) | ۶۱ | `test/**` |
| گزارش‌های تاریخی | ۲ | `packaging-estimation-report.md` |
| **CSS مرده** | ۲ | `public/store/store.css:682,694` — قاعدهٔ `.product-shipping-info` که دیگر هیچ المانی ندارد؛ بی‌اثر، برای جلوگیری از «تمیزکاری خارج از Scope» دست نخورد |
| **حل‌نشده — نیازمند تصمیم** | ۶ | `public/store/product.html.bak` (بخش ۱۰) |

## ۱۰) Known Limitations / نیازمند تصمیم
1. **`public/store/product.html.bak`** — یک فایل پشتیبان قدیمی در پوشهٔ استاتیک است که هنوز `renderShippingBlock` و متن «رایگان/روش ارسال/زمان ارسال» را دارد. چون زیر `public/` است احتمالاً توسط Static Assets عمومی سرو می‌شود (آدرس `/store/product.html.bak`)، هرچند از هیچ‌جا لینک نشده. طبق قانون «تمیزکاری خارج از Scope ممنوع» **دست نزدم**. تصمیم لازم: حذف فایل، یا حذف از خروجی Deploy (مثلاً `.assetsignore`)، یا نگه‌داشتن.
2. **`GET` ادمین محصولات هنوز ۳ ستون را برمی‌گرداند** (بخش ۴-۲). تصمیم لازم: در مرحلهٔ بعد هم حذف شود یا Archive قابل مشاهده بماند؟
3. **ساخت/ویرایش محصول با کلاینت قدیمی که این ۳ فیلد را می‌فرستد** — بی‌صدا نادیده گرفته می‌شود (نه خطا).
4. **مصرف‌کنندهٔ خارج از ریپو** از API عمومی (احتمال بسیار کم؛ بخش ۳).
5. CSS مرده‌ی `.product-shipping-info` (بخش ۹).
6. محصولاتی که قبلاً داده‌ی ارسال داشتند، داده‌شان در D1 هست ولی دیگر هیچ‌جا نمایش داده نمی‌شود و از ادمین قابل ویرایش نیست (عمداً).

## تأیید صریح
- هیچ Deploy انجام نشد.
- هیچ SQL روی D1 (Production یا غیر) اجرا نشد؛ تست‌ها فقط روی دیتابیس موقت حافظه‌ای (`node:sqlite`) اجرا شدند.
- هیچ تغییری در VPS/Proxy/Tapin اعمال نشد.
- Shipping Routing، Shipping Engine، Packaging Engine، Checkout، City Selector و تعرفه‌ها تغییر نکرده‌اند.
- هیچ ستون یا داده‌ای حذف نشده و Migration جدیدی ساخته نشده است.
- هیچ Shipping Class، route_policy یا Route جدیدی ایجاد نشده و هیچ آستانهٔ عددی تعریف نشده است.
- Stage D یا مراحل بعدی اجرا نشده‌اند.

### فایل‌های تغییر کرده نسبت به ZIP مرجع
`public/admin/products/index.html` · `public/admin/products/products.js` · `public/store/product.html` · `src/index.js` · `test/browser/stage-b-product-override.browser.py` (یک assertion)
**جدید:** `test/admin-shipping-stage-c.test.mjs` · `test/browser/stage-c-server.mjs` · `test/browser/stage-c-legacy-fields.browser.py` · `stage-c-report.md`

برای ادامه، دستور «ادامه بده» را دریافت کردم.
