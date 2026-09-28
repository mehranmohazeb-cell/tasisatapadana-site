# گزارش نهایی — تکمیل و تثبیت سیستم ارسال Tapin

**منبع:** `tasisatapadana-site-shipping-tapin-reviewed.zip` (تنها Source of Truth). معماری (Worker + Static Assets + D1 + KV) دست‌نخورده ماند.

## خلاصه
ZIP ورودی از قبل مسیر مشترک `resolveCustomerShipping` را داشت و Estimate / Cart / Checkout / Admin Preview همه از آن عبور می‌کردند. بررسی خط‌به‌خط نشان داد مسیر اصلی درست است؛ چهار ایراد واقعی باقی مانده بود که اصلاح شد (بند ۳).

## ۱. فایل‌های تغییرکرده (تأییدشده با `diff -rq` نسبت به ZIP ورودی)
| فایل | تغییر |
|---|---|
| `src/shipping-engine.js` | فیلد `destination_province` پشت فلگ؛ پارس سخت‌گیرانهٔ پاسخ؛ حذف نام‌های اشتباه از کامنت |
| `src/index.js` | Checkout: `expected_shipping_cost` برای Tapin الزامی؛ مقایسه برای هر منبعی که ارسال شود |
| `public/admin/products/index.html` | فقط برچسب/راهنمای فیلد «وزن بسته‌بندی» (بدون وزن کالا) |
| `test/shipping-shared-quote.test.mjs`, `test/tapin-proxy.test.mjs` | به‌روزرسانی/افزودن تست |
| حذف‌شده | `vps-proxy-snippet/tapin_route.py`, `tapin-proxy-report.md`, `tapin-vps-integration-report.md`, `TAPIN-DEPLOY-HANDOFF.md`, `public/store/product.html.bak` |

دلیل حذف: Snippet بر قرارداد حدسی `/tapin/request` بنا شده بود (نه مسیر واقعی VPS)؛ گزارش‌های قدیمی نام‌های اشتباه (`weight_package`، ۵×۵×۵ و…) و ادعاهای منسوخ داشتند؛ `.bak` فایل موقت بود.

## ۲. مشکلات پیدا شده
1. `destination_province` **همیشه** به VPS فرستاده می‌شد، در حالی که جزو قرارداد شناخته‌شدهٔ Worker→VPS نیست. اگر Proxy از Pydantic با `extra=forbid` استفاده کند، هر Quote با 422 می‌شکست.
2. پارس پاسخ علاوه بر `entries.total_send_price` فیلدهای حدسی `cost` (بدون تبدیل، واحد نامعلوم) و `price_send_total` را هم می‌پذیرفت؛ خطر تبدیل اشتباه/دوگانه.
3. در Checkout اگر `expected_shipping_cost` فرستاده نمی‌شد، کنترل `SHIPPING_COST_CHANGED` کلاً دور زده می‌شد.
4. کامنت کد نام‌های ممنوعه (`count_per_discount`, `weight_package`, `type_pickup` …) را دوباره ذکر می‌کرد؛ فایل‌های کهنهٔ حدسی VPS در ZIP بود؛ برچسب فیلد «وزن بسته» در Admin مبهم بود (ناخالص یا فقط بسته‌بندی؟).

## ۳. اصلاح‌ها
1. `destination_province` فقط وقتی به Proxy می‌رود که Worker Variable `TAPIN_PROXY_SEND_PROVINCE=true` باشد (پیش‌فرض: خاموش). استان همچنان در `shipping_quote_history` ثبت می‌شود.
2. فقط `entries.total_send_price` (ریال) پذیرفته می‌شود و یک‌بار `Math.round(x/10)`؛ غیر از آن → `TAPIN_RESPONSE_UNRECOGNIZED` (هیچ‌وقت «رایگان»).
3. برای Tapin، نبود `expected_shipping_cost` یا اختلاف آن → HTTP 409 `SHIPPING_COST_CHANGED` + `new_shipping_cost`؛ سفارش و کاهش موجودی انجام نمی‌شود.
4. کامنت‌ها و فایل‌ها پاک‌سازی و برچسب Admin شفاف شد.

## ۴. قرارداد فعلی Worker → VPS (استخراج‌شده از کد Worker)
```
POST https://proxy.tasisatapadanaesfahan.ir/api/v1/tapin/quote
Headers: Content-Type: application/json
         Authorization: Bearer <PROXY_API_KEY>
Body: {
  destination_city, [destination_province — فقط با فلگ],
  product_type_id, packing_type_id, payment_type, service_type,
  delivery_type, pickup_type,
  products: [{ discount_per_count, amount_per_count, weight_per_count, count }],
  length, width, height, package_weight
}
```
Worker انتظار دارد: موفق `{ok:true, entries:{total_send_price:<ریال>}, quote_id?, matched_city?}`؛ خطای منطقی `{ok:false, error, message, candidates?}`.
**محدودیت:** کد VPS در ZIP نیست؛ شکل واقعی پاسخ VPS اثبات‌نشده است و حدس زده نشد (بند ۱۶).

## ۵. `destination_province`
قابل‌استفاده، ولی **خاموش به‌صورت پیش‌فرض**. پس از تأیید اینکه VPS آن را می‌پذیرد، Variable بالا را روی Worker بگذارید (`VPS-NEXT-STEPS.txt`).

## ۶. Packaging
اولویت: Override معتبر محصول (`package_*` کامل) → برآورد `packaging-estimation.js` → در نبود داده `TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE`. ۵×۵×۵ وجود ندارد. `weight_per_count` = `products.weight_grams` (وزن کالا)؛ `package_weight` = فقط وزن بسته‌بندی (Override: مقدار ثبت‌شده؛ برآورد: وزن برآوردی − وزن کالا). وزن کالای ثبت‌نشده → خطا، نه وزن جایگزین.
**نکته عملیاتی:** مقدار «وزن بسته‌بندی» در Override باید **بدون وزن کالا** ثبت شود (برچسب Admin اکنون همین را می‌گوید).

## ۷. Currency
`amount_per_count = price×10`، `discount_per_count = discount×10` فقط در `quoteViaTapin`؛ پاسخ یک‌بار ÷۱۰ و گرد. مبلغ نامعتبر/۰ → خطا.

## ۸. Modeها
`internal/engine` بدون هیچ Network Call؛ `online` فقط Tapin و بدون Fallback (شکست → لیست خالی + `unavailable`، Checkout 503 `SHIPPING_QUOTE_UNAVAILABLE`)؛ `online_fallback_internal` فقط در شکست به داخلی با `source="internal"` و `fell_back=true`. ورامین در `online` قیمت Tapin می‌گیرد حتی بدون تعرفهٔ داخلی.

## ۹. Checkout
Quote تازه در هر ثبت سفارش؛ اختلاف → `SHIPPING_COST_CHANGED` (409). سفارش Tapin: `shipping_method_id = NULL`، `shipping_method_name = "ارسال با تیپاکس"`.

## ۱۰. Multi-package
یک کالا × N عدد → `count=N`. چند کالای متفاوت → `TAPIN_MULTI_PACKAGE_UNSUPPORTED` بدون Network Call. هیچ تقسیم حدسی وجود ندارد.

## ۱۱–۱۲. تست‌های اجراشده (واقعی، Node 22 + node:sqlite، `fetch` موک‌شده)
| Suite | نتیجه |
|---|---|
| packaging-estimation | 25/25 PASS |
| tapin-proxy | 19/19 PASS (۱ تست جایگزین + ۱ جدید) |
| shipping-quote-history | 4/4 PASS |
| shipping-calculation-mode | 9/9 PASS |
| shipping-tariff-import | 4/4 PASS |
| shared customer shipping | 21/21 PASS (۱ جدید) |
| **جمع** | **82 Pass / 0 Fail** |

سینتکس اسکریپت‌های `cart.html`، `checkout.html`، `product.html` و فایل‌های `src/*.js` بررسی شد؛ رفتار مرورگری UI در Sandbox اجرا نشد.

## ۱۳. Live Tapin Test
**NOT EXECUTED** — Sandbox دسترسی Network/SSH ندارد. همهٔ تست‌ها با Proxy موک‌شده‌اند و Live Test نیستند؛ فرمت پاسخ واقعی (`entries.total_send_price`) از مستندات است، نه پاسخ زنده.

## ۱۴. D1 Migration
**NO D1 SQL REQUIRED.** Schemaهای `shipping_quote_history` و `shipping_tariff_versions` رعایت شده‌اند (`created_at AS quoted_at` فقط در SELECT؛ `version_label` فقط Mapping در API/UI).

## ۱۵. VPS
تغییر **قطعی** لازم نیست، ولی دو بررسی قبل از Live Test الزامی است (`VPS-NEXT-STEPS.txt`): شکل پاسخ route، و (اختیاری) پذیرش `destination_province`.

## ۱۶. مراحل بعد از دریافت ZIP
1. ZIP را در GitHub Commit و Worker را Deploy کنید (Secretهای Tapin هرگز در Worker نیستند).
2. Admin → Shipping → Providers: Provider `tapin` روی Active/Quote با config کامل.
3. `shipping_calculation_mode = online` (طبق گفتهٔ شما قبلاً تنظیم شده).
4. مراحل `VPS-NEXT-STEPS.txt` را اجرا کنید.
5. Live Test: پکیج آدنا ۲۴، تعداد ۱، ۱۱۲,۰۰۰,۰۰۰ تومان، ۳۶,۰۰۰ گرم، مقصد تهران/ورامین → Estimate، سپس Cart، سپس Checkout؛ مبلغ باید عین Quote Tapin باشد. اگر بین دو مرحله تغییر کند، باید `SHIPPING_COST_CHANGED` بیاید.
6. اگر خطا داد، اول پاسخ خام `/api/v1/tapin/quote` و لاگ VPS را ببینید؛ قبل از آن چیزی را حدس نزنید.

## Register/COD/Tracking/Label/Cancel، Payment Gateway، ZarinPal
فعال نشدند و دست نخوردند.
