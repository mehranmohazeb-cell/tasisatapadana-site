# گزارش نهایی — تکمیل اتصال Tapin روی Integration Proxy موجود

## ⚠️ نکته صادقانه که باید قبل از هر چیز خوانده شود
این پیام ادعا کرده بود «این دستور همراه ZIP پروژه ارسال می‌شود» و «ZIP
پیوست‌شده آخرین نسخه مرجع است» — اما در این Sandbox **هیچ فایل جدیدی آپلود
نشده بود**؛ تنها فایلی که در `/mnt/user-data/uploads/` وجود دارد همان ZIP
سایت از مرحله قبل است (`tasisatapadana-site-packaging-estimation-fixed.zip`).
همچنین **کد واقعی سرویس Integration Proxy روی VPS** (`routers/tapin.py`,
`integrations/tapin.py`, `main.py`) هرگز در هیچ مرحله‌ای — نه این یکی، نه
قبلی — در اختیارم قرار نگرفته؛ فقط توصیف متنی آن‌ها را در دستور خواندم. این
Sandbox علاوه بر این هیچ اینترنت یا SSH به VPS واقعی (`45.94.214.232`) ندارد.

نتیجه عملی: توانستم سمت **Worker** (که فایل واقعی‌اش را دارم) را به‌طور کامل
و واقعی با معماری جدید هماهنگ کنم و تست کنم. اما **هیچ ویرایشی روی
`routers/tapin.py` یا `integrations/tapin.py` انجام نشد** — چون این فایل‌ها
هرگز به من داده نشدند و حدس زدن محتوای دقیق‌شان (constructor، importها،
ساختار `Settings`) دقیقاً همان کاری است که دستور صریحاً منع کرده («حدس نزن»،
بخش‌های ۱۲/۲۵). این مورد مهم‌ترین آیتم در بخش «۱۲ — موارد عمداً انجام‌نشده»
پایین است.

## ۱ و ۲ — فایل‌های تغییرکرده و خلاصه تغییر
- **`src/shipping-engine.js`** — بخش Tapin Adapter بازنویسی شد:
  - Endpoint Proxy از `/tapin/request` (پیشنهاد اشتباه/فرضی مرحله قبل، بدون
    دیدن کد واقعی VPS) به مسیر واقعی موجود **`/api/v1/tapin/quote`** تغییر
    کرد (طبق بخش ۲/۱۵ همین دستور).
  - **`TAPIN_TOKEN`/`TAPIN_SHOP_ID` و تابع `getTapinCredentials` کاملاً از
    Worker حذف شدند** (طبق بخش ۱۵: «هیچ TAPIN_TOKEN نباید در Worker قرار
    بگیرد») — Worker دیگر هیچ Credential واقعی Tapin ندارد، فقط
    `PROXY_API_KEY`.
  - Worker دیگر مسیرهای خام Tapin (province/city/check-price) را جداگانه یا
    از طریق Passthrough عمومی صدا نمی‌زند — این دقیقاً همان الگوی Generic
    Proxy/SSRF بود که بخش ۱۴ دستور منع کرده. حالا فقط **یک** تماس به
    `/api/v1/tapin/quote` انجام می‌شود؛ حل‌وفصل شهر و تماس با Tapin باید
    داخل خود VPS (`integrations/tapin.py`) انجام شود.
  - تابع `fetchTapinLocations` (که مستقیماً Location Endpointهای Tapin را
    صدا می‌زد) **حذف شد** — دیگر مسیر امنی برای اجرای آن در این معماری وجود
    ندارد.
  - `findTapinCityMatch` و `normalizePersianText` (منطق خالص تطبیق شهر، بدون
    تماس شبکه) **حفظ و Export شدند** — طبق بخش ۹ دستور («منطق موجود Worker
    برای City Mapping حفظ شود») — تا هنگام بازتولید همین الگوریتم در
    `integrations/tapin.py` (پایتون)، مرجع دقیقی موجود باشد. این توابع دیگر
    مستقیماً توسط `quoteViaTapin` صدا زده نمی‌شوند.
  - `quoteViaTapin` بازنویسی شد: کار محاسبه `products[]`، تبدیل قیمت
    (تومان×۱۰)، خواندن `shipping_providers.config_json`، و ابعاد ثابت ۵×۵×۵
    عیناً حفظ شدند؛ فقط خروجی این محاسبات اکنون در بدنه یک درخواست Quote
    واحد به Proxy فرستاده می‌شود، نه در ۲ تا ۳ تماس جداگانه.
- **`test/tapin-proxy.test.mjs`** — کاملاً بازنویسی شد (نسخه قبلی که مسیر
  اشتباه `/tapin/request` را فرض می‌کرد، جایگزین شد؛ نه صرفاً حذف — طبق
  دستور، تست‌های درست/بی‌ربط به این تغییر دوباره‌نویسی نشدند، فقط بخش‌هایی که
  به مسیر/قرارداد اشتباه وابسته بودند اصلاح شدند). ۱۵ تست، همگی سبز.
- فایل‌های اضافه‌شده در تلاش قبلی که با این دستور صریحاً در تضاد بودند
  (`vps-proxy-snippet/tapin_route.py` و گزارش قبلی) **حذف شدند** چون آن
  Snippet دقیقاً همان چیزی بود که بخش ۲۵ همین دستور گفته «بر هر فرض یا
  Snippet قبلی اولویت دارد ساختار واقعی VPS» — دیگر معتبر نبود.
- هیچ فایل دیگری (Cart/Checkout/Payment/UI/D1/Admin) تغییر نکرد.

## ۳ — Endpoint نهایی Worker → Proxy
```
POST https://proxy.tasisatapadanaesfahan.ir/api/v1/tapin/quote
Header: Authorization: Bearer <PROXY_API_KEY>
Body:   {
  destination_city, product_type_id, packing_type_id, payment_type,
  service_type, delivery_type, type_pickup, products[],
  length: 5, width: 5, height: 5, weight_package
}
```
⚠️ این دقیقاً همان قراردادی است که خود دستور در بخش‌های ۸ تا ۱۱ توصیف کرده،
اما چون محتوای واقعی `integrations/tapin.py`/`routers/tapin.py` را ندیده‌ام،
شکل دقیق پاسخ (فیلدهای `cost`/`matched_city`/`quote_id` که Worker انتظار
دارد) یک فرض مستند است، نه چیزی که از کد واقعی خوانده باشم — باید با کد
واقعی VPS تطبیق داده شود (بخش «۱۲ — باقی‌مانده» را ببینید).

## ۴ — Endpointهای Proxy → Tapin
بدون تغییر نسبت به مستندات قبلی (این سه مورد باید **از داخل VPS**، نه از
Worker، فراخوانی شوند — که چون کد VPS در اختیارم نبود، من فقط طرف Worker را
اصلاح کردم، نه پیاده‌سازی واقعی این تماس‌ها را):
```
POST https://api.tapin.ir/api/v4/location/public/all/province/filter/
POST https://api.tapin.ir/api/v4/location/public/all/city/filter/
POST https://api.tapin.ir/api/v4/tipax/public/user/order/check-price/
```

## ۵ — وضعیت TAPIN_ENABLED
قابل‌گزارش نیست — این متغیر روی خود VPS تعریف می‌شود (بخش ۶ دستور)، و کد/
Environment واقعی VPS در این Sandbox در دسترس نبود.

## ۶ — وضعیت Credentialها (بدون نمایش مقدار)
- `PROXY_API_KEY`: انتظار می‌رود در Cloudflare Secrets موجود باشد (طبق
  مراحل قبلی پروژه) — از کد Worker فقط نام آن خوانده می‌شود، مقداری در این
  Sandbox دیده یا تنظیم نشد.
- `TAPIN_TOKEN` / `TAPIN_SHOP_ID` / `TAPIN_ENABLED`: دیگر در Worker استفاده
  نمی‌شوند (طبق بخش ۱۵)؛ وضعیت واقعی آن‌ها روی VPS (`.env`) برایم قابل
  مشاهده نیست.

## ۷ — وضعیت Real API Test
**REAL API TEST NOT VERIFIED.**
دلیل دقیق: این Sandbox هیچ دسترسی اینترنتی ندارد (شبکه خروجی کاملاً
غیرفعال است)، پس نه تماس واقعی با `proxy.tasisatapadanaesfahan.ir` و نه با
`api.tapin.ir` از این محیط ممکن بود. تمام ۱۵ تست جدید با `fetch` Mock‌شده
اجرا شدند؛ هیچ Quote واقعی گرفته نشد و به‌عنوان چنین چیزی گزارش نمی‌شود.

## ۸ — نتیجه Quote
واقعی: ندارد (طبق بند ۷ بالا). Mock: در تست‌ها، برای ورودی نمونه (شهر
«اصفهان»، یک قلم کالای ۱۰۰٬۰۰۰ تومانی/۵۰۰ گرمی)، با پاسخ فرضی Proxy
`{ok:true, cost:15000, ...}`، خروجی نهایی `quoteViaTapin` برابر
`cost: 15000 (IRT)` بود — صرفاً برای تأیید مسیر Data، نه یک عدد واقعی.

## ۹ — واحد قیمت دریافتی از Tapin
همچنان **تأیید‌نشده** (طبق بند ۱۱ دستور خود کاربر) — چون هیچ Real API Test
ممکن نبود. کد Worker از دو حالت پشتیبانی می‌کند: اگر Proxy فیلد `cost`
(از‌پیش تبدیل‌شده به تومان) برگرداند همان استفاده می‌شود؛ اگر به‌جایش
`price_send_total` خام (فرض بر ریال) برگرداند، همان منطق قبلی `÷10` اعمال
می‌شود. هر دو مسیر تست شده‌اند، اما کدام یک واقعاً با VPS مطابقت دارد، فقط
با یک Real Quote واقعی قابل تعیین است.

## ۱۰ — وضعیت Province/City
منطق الگوریتمی تطبیق شهر (`findTapinCityMatch`/`normalizePersianText`) در
Worker حفظ شده (خروجی/رفتار عیناً تست‌شده: `CITY_NOT_FOUND`,
`AMBIGUOUS_CITY_NAME`)، اما دیگر **در Worker اجرا نمی‌شود** — چون Worker
دیگر مجاز به فراخوانی مستقیم Location Endpointهای Tapin نیست. طبق معماری
جدید، این تطبیق باید سمت VPS (داخل `integrations/tapin.py`) انجام شود و
نتیجه (خطای `CITY_NOT_FOUND`/`AMBIGUOUS_CITY_NAME` یا `matched_city`) در
پاسخ `/api/v1/tapin/quote` به Worker برگردد — که Worker آن را بدون تغییر
Passthrough می‌کند (تست شده).

## ۱۱ — خطاهای احتمالی (مدیریت‌شده و تست‌شده در Worker)
`PROXY_CREDENTIALS_MISSING`, `PROXY_NETWORK_ERROR`, `PROXY_HTTP_ERROR`,
`PROXY_INVALID_RESPONSE`, `TAPIN_CONFIG_INCOMPLETE`، به‌علاوه هر کد خطای
منطقی که خود Proxy برگرداند (مثل `CITY_NOT_FOUND`/`AMBIGUOUS_CITY_NAME`) که
بدون تفسیر اضافه Passthrough می‌شود.

## ۱۲ — مواردی که عمداً انجام نشده‌اند
1. **مهم‌ترین مورد:** هیچ تغییری روی `routers/tapin.py` یا
   `integrations/tapin.py` (سمت VPS) اعمال نشد — نه چون فراموش شده، بلکه
   چون این فایل‌ها هرگز در اختیارم نبودند و ویرایش کورکورانه کدی که ندیده‌ام
   (constructor، importها، وابستگی‌های `Settings`) دقیقاً همان «حدس زدن»ی
   است که دستور منع کرده.
2. تبدیل Skeleton فعلی `integrations/tapin.py` به Adapter واقعی (بخش ۱۳
   دستور) — همان دلیل بالا.
3. اصلاح احتمالی Typo در constructor (`def init` → `def __init__`) — همان
   دلیل بالا؛ حتی این تغییر کوچک هم نیازمند دیدن فایل واقعی است.
4. Real API Test — طبق بند ۷.
5. فعال‌سازی `shipping_calculation_mode` روی `online`/`online_fallback_internal`
   — طبق بخش ۱۶ دستور، عمداً تا تأیید Real Quote دست‌نخورده ماند.
6. اتصال Cart/Checkout — خارج از محدوده این مرحله.

## ۱۳ — دستور دقیق مرحله بعد
برای این‌که مرحله بعد واقعاً قابل‌انجام باشد (نه یک حدس دیگر)، لازم است یکی
از این دو مورد فراهم شود:
- محتوای واقعی `routers/tapin.py`، `integrations/tapin.py`، `main.py`، و
  کلاس `Settings` (یا کل ریپوی Proxy به‌صورت ZIP) — تا اصلاح مستقیم و دقیق
  (نه پیشنهادی/فرضی) روی همان کد انجام شود؛ یا
- اگر دسترسی به آن ریپو ممکن نیست، حداقل خروجی واقعی یک تماس دستی به
  `POST /api/v1/tapin/quote` (حتی یک نمونه موفق یا خطا) تا شکل دقیق
  Request/Response بدون حدس مشخص شود.

بدون یکی از این دو، هر ادعای «Adapter واقعی VPS تکمیل شد» غیرقابل‌اتکا
خواهد بود.
