# گزارش: عیب‌یابی Checkout ← Shipping Engine ← Tapin (حالت «فقط آنلاین»)

منبع: `tasisatapadana-site-main.zip` (تنها مبنا). معماری Worker + Static Assets + D1 دست‌نخورده. **Migration لازم نیست.**

## ۱. مسیر واقعی کد (بندهای ۱ تا ۵ درخواست)
- Checkout (`public/store/checkout.html`) → `GET /api/store/shipping-methods?city&province&product_ids&quantities` (`src/index.js`، فقط یک Route با این مسیر وجود دارد) → `resolveCustomerShipping` (`src/shipping-engine.js:846`) که `resolveShippingOptionsForCart` (`index.js:5015`) را فقط به‌عنوان `internalOptionsFn` می‌گیرد. ثبت نهایی سفارش هم همین تابع را صدا می‌زند (`index.js` حدود ۵۸۳۹).
- در حالت `online`: `listShippingProviders` ← ردیف `tapin` ← `quoteViaTapin` ← `getTapinBusinessConfig` که **همان `shipping_providers.config_json`** را می‌خواند. مسیر قدیمی/جداگانه‌ای وجود ندارد.
- متن «امکان برآورد آنلاین هزینه ارسال در حال حاضر وجود ندارد…» فقط ثابت `ONLINE_UNAVAILABLE_DEFAULT_MESSAGE` است و وقتی نمایش داده می‌شود که `unavailable.code` در جدول پیام‌های ویژه نباشد (یعنی یکی از: `PROXY_HTTP_ERROR`، `PROXY_NETWORK_ERROR`، `PROXY_INVALID_RESPONSE`، `PROXY_CREDENTIALS_MISSING`، `TAPIN_RESPONSE_UNRECOGNIZED`، `TAPIN_API_ERROR`، …). پس تست شما حداقل به خروجی «شکست Adapter» رسیده، نه به شرط قبل از Proxy.

## ۲. علت «رکورد جدید ثبت نشد» — یافتهٔ صادقانه
با بازتولید روی Worker واقعی (D1 آزمایشی با Schema گزارش‌شده)، در **هر** سناریویی که همین پیام نمایش داده می‌شود (401، 422، 502، قطع شبکه، پاسخ ناشناخته) یک ردیف `error` ثبت می‌شد. یعنی منطق ZIP به‌تنهایی «پیام بدون رکورد» نمی‌سازد. دو راه واقعی برای «پیام هست ولی رکورد نیست» وجود داشت:
1. **INSERT روی D1 واقعی شکست می‌خورد و خطایش بی‌صدا بلعیده می‌شد** (`recordShippingQuote` کل خطا را catch و دور می‌ریخت). Schema واقعی Production قبلاً دو بار CHECK پنهان نشان داده (`site_settings.shipping_calculation_mode`، `shipping_tariff_versions`)؛ محتمل‌ترین سناریو CHECK پنهان روی `calculation_mode` یا `status` است که مقدار جدید `online` را رد می‌کند (رکورد ساعت 18:00:05 احتمالاً با حالت دیگری ثبت شده بود). **این را از داخل ZIP نمی‌توان اثبات کرد** چون DDL واقعی D1 در اختیار من نیست.
2. مسیرهای بدون Audit: Provider غیرفعال/نامعتبر، و هر استثنای غیرمنتظره در Adapter (۵۰۰ پیش از ثبت). هر دو اصلاح شد.
همچنین fetch به Proxy Timeout نداشت (اگر VPS پاسخ نمی‌داد، هیچ نتیجه‌ای ثبت نمی‌شد).

**برای قطعی‌کردن علت** بعد از Deploy یک بار تست کنید؛ دو نتیجه ممکن است: (الف) رکورد ثبت می‌شود و `error_code/error_message` علت واقعی Proxy/Tapin را نشان می‌دهد؛ (ب) رکورد ثبت نمی‌شود، ولی Log Worker خط `[shipping_quote_history] INSERT failed: …` را همراه DDL کامل جدول چاپ می‌کند (`wrangler tail` یا Logs داشبورد). فایل `database/diagnose-shipping-quote-history.sql` (فقط SELECT) همان DDL را در D1 Console نشان می‌دهد. اگر CHECK پنهان تأیید شد، Migration دقیق را بر اساس همان DDL می‌نویسم (حدس نمی‌زنم).

## ۳. اصلاح‌ها (فقط `src/shipping-engine.js`)
1. Audit برای **هر** استعلام آنلاین، موفق یا ناموفق، از جمله Provider غیرفعال؛ محاسبه وزن/ارزش سبد از شاخه خارج شد.
2. `recordShippingQuote` دیگر بی‌صدا نیست: خطا را در Log (بدون Secret) می‌نویسد، DDL جدول را کنار آن چاپ می‌کند و `{ok:false,error}` برمی‌گرداند. نتیجه (`audit`) فقط در Admin Preview (`shipping-engine-preview`) برمی‌گردد؛ پاسخ عمومی مشتری آن را ندارد. `mode` واقعی در ستون `calculation_mode` و `http_status` در `request_json` ثبت می‌شود.
3. استثنای Adapter → `TAPIN_ADAPTER_EXCEPTION` با Audit، نه HTTP 500.
4. علت واقعی خطای Proxy ثبت می‌شود: `HTTP <status>: <detail/message>` (FastAPI از `detail` استفاده می‌کند و قبلاً خوانده نمی‌شد)؛ پاسخ غیر-JSON (HTML خطای Cloudflare/nginx) → `PROXY_INVALID_RESPONSE` با status و ابتدای متن.
5. Timeout ۱۵ ثانیه‌ای با `AbortController` → `PROXY_TIMEOUT`.
6. `PROXY_API_KEY` قبل از استفاده `trim` می‌شود (Secret دارای newline انتهایی با `.env` نمی‌خواند)، و هر Secret/`Bearer …` از Audit، Log و پاسخ‌ها پاک می‌شود.
- حالت `online` هیچ Fallback بی‌دلیلی به موتور داخلی ندارد؛ Multi-package با `TAPIN_MULTI_PACKAGE_UNSUPPORTED` و بدون تماس Proxy حفظ شد؛ Table Rate از نتیجه آنلاین ساخته نمی‌شود.

## ۴. تأیید بندهای ۶ تا ۹
- Header دقیقاً `Authorization: Bearer <PROXY_API_KEY>` از `env.PROXY_API_KEY` (Secret) است؛ هیچ Credential دیگری Hardcode نیست.
- Payload شامل همه فیلدهای خواسته‌شده است: `product_type_id, packing_type_id, payment_type, service_type, delivery_type, pickup_type, length, width, height, package_weight, products[].{discount_per_count, amount_per_count, weight_per_count, count}` (تومان→ریال یک‌بار). ابعاد از سیستم Packaging فعلی می‌آید (Override محصول یا برآورد؛ ابعاد پایه 69×46×24 بدون Override هم Quote ساخت) و `service_type`: اصفهان→ورامین = 2.
- `destination_province` هنوز پشت `TAPIN_PROXY_SEND_PROVINCE=true` است (تغییری ندادم).

## ۵. تست‌ها (واقعی، Node 22 + node:sqlite، `fetch` موک‌شده)
| Suite | نتیجه |
|---|---|
| packaging-estimation | 25/25 |
| tapin-proxy | 19/19 |
| shipping-quote-history | 4/4 |
| shipping-calculation-mode | 9/9 |
| shipping-tariff-import | 4/4 |
| shipping-shared-quote | 21/21 |
| **shipping-audit-diagnostics (جدید)** | **10/10** |
مجموع 92/92. **Live Test با Tapin/VPS اجرا نشد** (Sandbox شبکه ندارد)؛ همه چیز با Proxy موک‌شده است.

## ۶. فایل‌های تغییرکرده (تأییدشده با مقایسه باینری با ZIP ورودی)
- `src/shipping-engine.js` (اصلاح)
- `test/shipping-audit-diagnostics.test.mjs` (جدید)
- `database/diagnose-shipping-quote-history.sql` (جدید، فقط SELECT)
- این گزارش

## ۷. مراحل بعد
1. Deploy، سپس همان تست (تهران/ورامین، محصول ۸) در Checkout.
2. `SELECT * FROM shipping_quote_history ORDER BY id DESC LIMIT 5;` — باید رکورد جدید با علت واقعی ببینید. اگر رکوردی نیامد، Log Worker را بخوانید (بند ۲-ب) و DDL/خط خطا را بفرستید.
3. اگر `error_message` مثل `HTTP 4xx/5xx …` بود، همان متن را با لاگ سرویس `apadana-payment-proxy` مقایسه کنید؛ VPS کد در ZIP نیست و حدس زده نشد.
