# گزارش اصلاح Worker — Tapin Post v2 (order_type / product_id / قرارداد Worker→VPS / حذف Tipax-v4)

## هشدار اولیه: هش ZIP
SHA-256 مرجع: `08CBBE15…B062DE` — SHA-256 ZIP پیوست‌شده: `16562bc1b978c3262fffa1f0af798fdc3ba2ba1f4b27231691765bd9c3bdf488`. **یکسان نیستند.** نام فایل یکی است؛ کار روی همین ZIP انجام شد. اگر مرجع واقعی شما ZIP دیگری است، تغییرات این گزارش (فقط یک فایل src + سه تست) را روی آن اعمال کنید.

## فایل‌های تغییرکرده
- `src/shipping-engine.js` (تنها فایل کد)
- `test/tapin-proxy.test.mjs` (۶ تست جدید + به‌روزرسانی تست‌های قدیمی)
- `test/shipping-shared-quote.test.mjs`, `test/shipping-audit-diagnostics.test.mjs` (هماهنگی fixture/assert)
بقیه (shipping_table_rates، موتور داخلی، Checkout، Payment، D1، حساب کاربری، public/*، vps-proxy/*) دست‌نخورده.

## تغییرات در src/shipping-engine.js
1. `getTapinBusinessConfig`: `order_type` = config_json پرووایدر > `env.TAPIN_ORDER_TYPE` > **null** (قبلاً ثابت ۰). ثابت صادرشده `TAPIN_DEFAULT_ORDER_TYPE` حذف شد. مقدار نامعتبر (غیرعدد) همچنان `TAPIN_CONFIG_INCOMPLETE` است.
2. `quoteViaTapin`: `order_type` فقط وقتی `!= null` باشد در Payload می‌آید؛ وگرنه کلید حذف می‌شود تا VPS از `TAPIN_ORDER_TYPE` خودش بخواند. عدد ۱ هیچ‌جا در Worker تعریف نشد.
3. `products[]`: کلید `product_id` همیشه وجود دارد. در پروژه هیچ mapping واقعی Tapin (ستون/جدول) نیست، پس مقدار `null` است؛ D1 id/SKU/slug جایگزین نمی‌شود. `count/discount/price/title/weight` همچنان واقعی ارسال می‌شوند.
4. کامنت‌های سربرگ/پیکربندی با قرارداد جدید هماهنگ شدند.

## Payload نهایی Worker → VPS (`POST /api/v1/tapin/quote`)
```json
{
  "destination_city": "...",
  "destination_province": "...",          // اگر موجود باشد
  "pay_type": 1,                           // پیکربندی فعلی پروژه
  "order_type": <فقط اگر در D1/Env صریحاً تنظیم شده>,
  "packet_type": <فقط اگر تنظیم صریح>,    // رفتار قبلی، بدون تغییر
  "products": [{ "count": n, "discount": ریال, "price": ریال, "title": "...", "weight": گرم, "product_id": null }],
  "length": cm, "width": cm, "height": cm,
  "package_weight": گرم
}
```
تبدیل تومان→ریال یک‌بار (Worker)، ریال→تومان `entries.total_send_price` یک‌بار (Worker). `weight_package` وجود ندارد.

## فیلدهای Tipax/v4
در کد اجرایی Worker هیچ‌یک از `product_type_id, packing_type_id, payment_type, service_type*, delivery_type, pickup_type, receiver_province_id, receiver_city_id, weight_package` و هیچ endpoint قدیمی/`api.tapin.ir` نبود (مراحل قبل حذف شده بود؛ فقط در کامنت‌ها و تست‌های منفی ذکر می‌شوند). با تست اسکن ایستا (بدون کامنت) روی `src/*.js` قفل شد.

## تست‌ها
همه سوئیت‌ها اجرا شدند: packaging-estimation 25/25، shipping-audit-diagnostics 10/10، shipping-calculation-mode 9/9، shipping-quote-history 4/4، shipping-tariff-import 4/4، shipping-shared-quote 21/21، tapin-proxy 30/30.
- پیش از تغییر، یک تست در shipping-shared-quote **از قبل** شکست می‌خورد: assert می‌کرد `product_id === 1` (ID داخلی D1) که با قرارداد جدید مغایر است؛ به `null` اصلاح شد.
- `test/vps/test_tapin_vps.py` اجرا نشد (pytest در sandbox نیست) و VPS خارج از محدوده بود.
- هیچ تست زنده روی Tapin/VPS انجام نشد (sandbox بدون شبکه).

## موارد باقی‌مانده / Blockerها
1. **پنل ادمین (public/admin/shipping/providers/providers.js و index.html):** فرم تنظیمات Tapin مقدار پیش‌فرض `order_type=0` دارد و با «ذخیره» همان `0` را در `config_json` ذخیره می‌کند؛ Worker هم آن را «مقدار صریح» می‌بیند و دوباره ۰ می‌فرستد. چون Static Assets ممنوع بود، دست نزدم. پیشنهاد: فیلد خالی ⇒ کلید `order_type` اصلاً ذخیره نشود. همچنین بررسی کنید `config_json` فعلی Tapin در D1 مقدار `order_type` ندارد (در صورت وجود ۰، باید حذف شود):
   `SELECT config_json FROM shipping_providers WHERE code='tapin';`
2. **VPS (`integrations/tapin.py`) — تغییر ندادم:**
   - `product_id` را عمداً ارسال نمی‌کند (`_build_products`)؛ باید کلید `product_id` را از Worker عبور دهد (null ⇒ `null` به Tapin).
   - `DEFAULT_ORDER_TYPE = 0` در صورت نبود `TAPIN_ORDER_TYPE` در .env؛ با `TAPIN_ORDER_TYPE=1` فعلی مشکلی نیست، ولی بهتر است بدون env خطای صریح بدهد.
3. هش ZIP (بالا).
