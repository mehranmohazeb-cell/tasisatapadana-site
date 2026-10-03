# گزارش نهایی — Admin Product & Shipping Modernization (Final Freeze / Release Candidate)

**Stage E functional changes: NONE**

## A) Source of Truth
- ZIP مرجع: `tasisatapadana-site-stageD-legacy-cleanup.zip`
- SHA-256 اعلام‌شده: `43d0b52bb4844c380e8f97ee68107a5c096a7a7cd7fccaa7e6d8ff60ababd891`
- SHA-256 محاسبه‌شده: **دقیقاً مطابق**.
- تنها تفاوت این Release Candidate با Stage D: افزودن همین فایل گزارش. هیچ فایل سورس، تست، Migration یا استاتیکی تغییر نکرد (`diff -r` کامل، و پس از اجرای همهٔ تست‌ها نیز درخت پروژه یکسان ماند).

## B) Final Architecture
مدل نهایی Product Admin:

```
Product
  → Shipping Class            (ماهیت حمل؛ shipping_classes + products.shipping_class_id)
  → Route Policy کلاس         (normal | freight؛ shipping_classes.route_policy)
  → Product Route Override    (استثنای محصول: NULL | normal | freight؛ products.shipping_route_override)
  → Packaging / مشخصات فیزیکی (Packaging Profile، وزن و ابعاد کالا و بسته)
  → Effective Route           (فقط از decideRoute در shipping-routing.js، خوانده‌شده از Server)
  → Shipping Engine           (دست‌نخورده)
```

صفحهٔ محصول: بخش مشخصات محصول (نام، برند، مدل، SKU، دسته، قیمت، موجودی، مشخصات، تصاویر) + بلوک «خلاصهٔ حمل و Override مسیر این محصول» با پنج گروه جدا (کلاس و Policy / Override با دکمهٔ ذخیرهٔ جدا / فیزیکی / Packaging / نتیجهٔ Routing و دلیل) + هشدارهای داده. صفحهٔ Shipping Classes: Route Policy صریح. صفحهٔ سفارش‌ها: Snapshot ارسال. هیچ UI قدیمی ارسال محصول باقی نمانده.

## C) Stage A (نهایی و حفظ‌شده)
Route Policy کلاس در GET/POST/PUT و UI (فقط normal/freight)؛ NULL به‌صورت «ثبت نشده» و مقدار نامعتبر D1 بدون تبدیل بی‌صدا؛ `GET /admin/shipping-routing/product-summary` (Effective Route، Reason، Flags از منطق موجود)؛ Snapshot سفارش (`shipping_route`, `shipping_payment_mode`, `shipping_max_dispatch_days`) بدون محاسبهٔ مجدد؛ Audit تغییر Policy کلاس؛ Fail-Safe در نبود ستون‌ها.

## D) Stage B (نهایی و حفظ‌شده)
Override سه‌حالته (پیش‌فرض کلاس→NULL، عادی→normal، باربری→freight) با Endpoint موجود `PUT /admin/shipping-routing/product`؛ دکمهٔ «ذخیرهٔ Override» جدا از «ذخیرهٔ محصول»؛ بدون Live Preview؛ مسیر مؤثر فقط از Server؛ وضعیت Unsaved؛ تأییدیه هنگام «ذخیرهٔ محصول» با Override ذخیره‌نشده؛ مقدار نامعتبر D1 قابل‌تشخیص و بدون اصلاح خودکار؛ Audit هر انتقال.

## E) Stage C (حذف Legacy Presentation)
`shipping_cost/method/time` محصول از فرم ادمین، صفحهٔ عمومی، SSR و API عمومی حذف شد؛ JSON-LD هیچ‌گاه آن‌ها را نداشت. POST/PUT محصول این ستون‌ها را نمی‌خواند و نمی‌نویسد (داده‌ی قدیمی NULL نمی‌شود؛ کلاینت قدیمی بی‌اثر پذیرفته می‌شود).

## F) Stage D (پاکسازی نهایی)
`public/store/product.html.bak` حذف شد؛ سه کلید قدیمی از GET ادمین محصولات حذف شد؛ CSS مرده `.product-shipping-info` (۱۸ خط) حذف شد؛ برآوردگر واقعی ارسال و CSS آن سالم است.

## G) Database
- `products.shipping_cost`, `products.shipping_method`, `products.shipping_time`: **باقی‌اند، و داده‌هایشان باقی است** (تست‌های Node و مرورگر روی GET ادمین، SSR، API عمومی، چندین Save محصول، کلاینت قدیمی و ذخیرهٔ Override).
- `database/`: ۲۲ فایل، اثرانگشت یکسان با Stage D و Stage C؛ **هیچ Migration جدیدی ساخته نشد**.
- هیچ `DROP/RENAME COLUMN` (روی ستون‌های ارسال محصول)، `DELETE`، `UPDATE` یا `ALTER` روی D1 اجرا نشد؛ هیچ ارتباطی با D1 واقعی برقرار نشد (تست‌ها فقط روی دیتابیس موقت حافظه‌ای).

## H) API (وضعیت نهایی)
| API | وضعیت |
|---|---|
| `GET /api/store/products/:slug` و `GET /api/store/products` (عمومی) | سه کلید قدیمی را برنمی‌گرداند |
| `GET /api/store/products` (ادمین) | سه کلید قدیمی را برنمی‌گرداند؛ بقیهٔ قرارداد سالم |
| `POST/PUT /api/store/products` | سه فیلد قدیمی را نمی‌نویسد/نمی‌خواند؛ داده‌ی قدیمی را پاک نمی‌کند |
| `/admin/shipping-classes` (GET/POST/PUT) | Stage A: `route_policy` + `route_policy_status` |
| `PUT /admin/shipping-routing/product`، `GET .../product-summary`، `GET /admin/shipping-routing` | قرارداد Stage A/B حفظ شده |
| `GET /api/store/orders` و `/orders/:id` (ادمین) | Snapshot ارسال (Stage A) |

## I) Routing
`src/shipping-routing.js` بایت‌به‌بایت یکسان با Stage D (SHA-256 `27ace08e4584cf550a0de879edfbd225845d9266c43feec10625821f1f21197c`). قوانین اصفهان، Freight، سبد چندمحصولی و حداکثر ۳ روز دست‌نخورده‌اند.

## J) Engine
`src/shipping-engine.js` (`099a18e92cd7df9aed1f724825d0eef2f18883718fb22c26de092c8f9a0b4ee9`) و `src/packaging-estimation.js` (`3af74117ed9d903b3f3b838d131a6cf68b6cf26297519d1760dda31724e17cef`): بایت‌به‌بایت یکسان. Tapin/VPS/Proxy، Checkout، City Selector، تعرفه‌ها، Providers، Calculation Mode، Quote History تغییر نکردند.

## K) Tests (همه سبز؛ هیچ تستی حذف/Skip/غیرفعال نشد)
**Node — جمع ۲۲۶ تست، ۰ شکست**

| Suite | نتیجه |
|---|---|
| admin-shipping-stage-a | ۲۹ |
| admin-shipping-stage-b | ۲۰ |
| admin-shipping-stage-c | ۱۶ |
| admin-shipping-stage-d | ۲۱ |
| shipping-routing | ۲۳ |
| shipping-shared-quote | ۲۱ |
| shipping-freight-message | ۶ |
| shipping-preview-mode-override | ۸ |
| shipping-audit-diagnostics | ۱۰ |
| packaging-estimation | ۲۵ |
| shipping-calculation-mode | ۹ |
| shipping-quote-history | ۴ |
| shipping-tariff-import | ۴ |
| tapin-proxy | ۳۰ |

**Python (VPS proxy، در لیست الزامی نبود ولی در پروژه است):** `test/vps/test_tapin_vps.py` — ۳۳ سبز / ۰ شکست (با Stubها؛ هیچ تماس واقعی با Tapin/VPS).

**Browser (Chromium واقعی، Playwright) — جمع ۱۲۶ تست، ۰ شکست:** Stage B: ۴۵ · Stage C: ۵۱ · Stage D: ۳۰.

**اصلاح یک خطای گزارش‌دهی من:** در پیام Stage D مجموع Node را «۲۲۸» نوشته بودم؛ مجموع درست همان suiteها ۲۲۶ است (خطای جمع، نه تست حذف‌شده).

## Orders (بخش ۱۰/۱۲ دستور)
تست مرورگر ماندگار برای Orders در پکیج نیست. پوشش: Node (Stage A: لیست و جزئیات، سفارش قدیمی null، Fail-Safe نبود ستون، عدم محاسبهٔ مجدد) + یک **بررسی موردی (Ad-hoc) در Chromium واقعی که در ZIP نیست**: ۶/۶ سبز — نمایش Snapshot برای سفارش باربری (`freight` / `receiver_pays` / ۳ روز)، پیک اصفهان (`isfahan_courier` / `free`)، «ثبت نشده» برای سفارش قدیمی، و ثابت‌بودن ردیف‌های سفارش‌ها بعد از دیدن جزئیات. اسکرین‌شات (فقط در پوشهٔ خروجی کنار ZIP، نه داخل آن): `FINAL-screenshots/orders-snapshot.png`. منطق سفارش/Checkout در `src/index.js` تغییری نکرده (توکن‌های `shipping_cost, shipping_method_id, shipping_method_name`، `expected_shipping_cost`، `actual_shipping_cost`، `shipping_payment_mode`، `shipping_route`، `shipping_max_dispatch_days` همه حاضرند).

## Browser (خلاصه)
Product Admin: لیست، ویرایش، Shipping Class، Policy، Override، ذخیرهٔ Override (freight↔NULL↔normal)، Summary، Packaging، وزن/ابعاد، Save محصول با حفظ داده‌ی قدیمی. صفحهٔ عمومی: دو محصول (با و بدون داده‌ی قدیمی)، برآوردگر ارسال و CSS آن، نبودن هر متن/بلوک قدیمی، `/store/product.html.bak` ← ۴۰۴. اسکرین‌شات‌ها بازبینی چشمی شدند. بدون خطای JavaScript.

## L) Final Search
**موارد Presentation — سورس فعال (`src/ public/ database/ vps-proxy* wrangler.toml`): صفر**
`renderShippingBlock` ۰ · `resolveShippingInfo` ۰ · `STORE_DEFAULT_SHIPPING_` ۰ · `.product-shipping-info` ۰ · `product.html.bak` ۰ (فایل وجود ندارد؛ `.assetsignore` هم نیست). این نام‌ها فقط در تست‌هایی که نبودنشان را قفل می‌کنند و گزارش‌های تاریخی `.md` هستند.

**Product Admin / Public / SSR / Product API / CSS: هیچ Legacy Shipping field یا مورد Presentation ندارند.** هیچ دستور SQL روی جدول `products` در `src/index.js` این سه ستون را نام نمی‌برد.

**`shipping_cost|method|time` — کل ۱۰۱ مورد (پیش از افزودن همین گزارش):**
| گروه | تعداد | محل |
|---|---|---|
| Database schema / Migration تاریخی | ۷ | `database/product-detail-enhancements.sql` ×۴، `packaging-estimation.sql` ×۲، `shipping-routing.sql` ×۱ |
| Orders/Checkout واقعی | ۱۵ | `src/index.js` ×۹، `orders.js` ×۲، `checkout.html` ×۳، `invoice.html` ×۱ |
| alias ستون CSV Import تعرفه (بی‌ربط به محصول) | ۱ | `src/index.js` |
| کامنت توضیح تصمیم Stage C/D | ۲ | `src/index.js` |
| تست‌ها | ۶۱ | `test/**` (۱۵ فایل) |
| Documentation | ۱۵ | `stage-c-report.md` ×۷، `stage-d-report.md` ×۶، `packaging-estimation-report.md` ×۲ |
| **غیرمجاز** | **۰** | — |

## M) Final Diff نسبت به Stage D
تنها تغییر: **افزودن** `FINAL-ADMIN-SHIPPING-REPORT.md`.
هیچ فایل ویرایش یا حذف نشد. **Stage E functional changes: NONE.**

## N) Known Limitations (عمداً خارج از Scope؛ اصلاح نشدند)
1. **ستون‌ها و داده‌ی قدیمی `products.shipping_cost/method/time` در D1 باقی‌اند** و از هیچ UI/API دیده یا ویرایش نمی‌شوند. تصمیم Archive/حذف نهایی دیتابیس گرفته نشده است.
2. **این RC هنوز Deploy نشده.** تا Deploy، سایت زنده همچنان ممکن است `/store/product.html.bak` و بلوک قدیمی ارسال را داشته باشد؛ بعد از Deploy باید دستی تأیید شود.
3. **وضعیت Migrationها روی D1 زنده از ZIP قابل اثبات نیست.** کد در نبود ستون‌های `route_policy`، `shipping_route_override`، `orders.shipping_*` Fail-Safe است (همه «عادی/unavailable» و ذخیره با خطای صریح)، ولی قبل از Deploy باید (فقط‌خواندنی) تأیید شود `database/shipping-routing.sql` و `packaging-estimation.sql` اجرا شده‌اند.
4. **Route Policy کلاس‌های موجود با `NULL`** (اگر روی D1 زنده باشند) باید توسط مدیر صریحاً تنظیم شوند. هیچ Shipping Class واقعی ساخته نشد و نگاشت «پکیج/رادیاتور/…» به normal یا freight هنوز تصمیم مدیریتی است.
5. **تصمیم‌های ثبت‌شده در Audit اولیه که اجرا نشدند** (تغییر شماره‌گذاری مراحل باعث شد در این چرخه نیایند): بازآرایی منو و انتقال Table Rates/Import/`shipping_methods`/Product Shipping Rates به «Advanced»؛ تعیین تکلیف Mode زنده/Fallback داخلی و تعرفه‌های تستی اصفهان/تهران؛ اصلاح Archive نسخهٔ تعرفه (ردیف‌ها فعال می‌مانند)؛ روش «پیک موتوری اصفهان ۴۰٬۰۰۰» در Seed قدیمی `shipping_methods`؛ نمایش تصمیم Routing در Quote History.
6. **Tapin (دست‌نخورده):** پیش‌فرض `order_type=0` در فرم Provider می‌تواند در `config_json` ذخیره شود؛ سبد عادی با چند محصول متفاوت در حالت «فقط آنلاین» به `TAPIN_MULTI_PACKAGE_UNSUPPORTED` می‌رسد («در دسترس نیست»). نیازمند تصمیم مدیریتی.
7. **تماس زنده با Tapin/VPS هرگز انجام نشد؛** تست‌ها Stub/موقت‌اند.
8. **UI:** عنوان «Shipping Class (برای تعرفه گروهی)» هنوز به Table Rate اشاره دارد؛ دکمهٔ Packaging «…(Override)» با Override مسیر هم‌نام است. هر دو متن‌اند و دست نخوردند.
9. **تست مرورگر فقط Chromium دسکتاپ** است (Safari/Firefox/موبایل بررسی نشد)؛ تست مرورگر Orders ماندگار نیست (فقط Ad-hoc).
10. **تصمیم‌های رفتاری ثبت‌شده:** Override و «ذخیرهٔ محصول» دو دکمهٔ جدا هستند؛ Live Preview وجود ندارد؛ API عمومی دیگر سه کلید قدیمی را نمی‌دهد (مصرف‌کنندهٔ خارج از ریپو، اگر باشد، متأثر می‌شود)؛ کلاینت قدیمی فیلدهای ارسال را بی‌صدا نادیده گرفته می‌شود؛ ذخیرهٔ Override با مقدار یکسان هم ردیف Audit می‌نویسد (رفتار قدیمی Endpoint).
11. در ریشهٔ پروژه ۲۲ فایل گزارش/Handoff (`.md`/`.txt`) از چرخه‌های قبلی (از جمله گزارش‌های Stage C و D) باقی ماندند و شامل نام‌های حذف‌شده‌اند؛ برخی کامنت‌های سرتیتر `store.css` از قبل Mojibake‌اند.

## پایان چرخه
این چرخه **Final/Frozen** است. Deploy، D1، VPS، Tapin، Proxy و Cloudflare Production **انجام نشدند**.

## SHA-256 ZIP نهایی
در پیام تحویل و در نسخهٔ بیرونی همین گزارش اعلام شده است (هش ZIP نمی‌تواند داخل خودش باشد).
