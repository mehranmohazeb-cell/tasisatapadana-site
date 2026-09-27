# گزارش نهایی — اتصال Worker → Integration Proxy → Tapin

## پیش از هر چیز: محدودیت صادقانه این Sandbox
این محیط **هیچ دسترسی اینترنتی ندارد** (شبکه خروجی کاملاً غیرفعال است) و
**هیچ دسترسی SSH/فایل‌سیستمی به VPS واقعی (45.94.214.232)** هم ندارد. یعنی:
- کد واقعی سرویس `apadana-payment-proxy` روی VPS برای من قابل مشاهده نبود —
  نمی‌توانستم بررسی کنم که آیا Endpoint/Handler اختصاصی Tapin از قبل وجود
  دارد یا نه (سؤالات بخش ۶ دستور).
- هیچ تماس واقعی (نه با Proxy واقعی، نه با Tapin) در این مرحله ممکن نبود.
- بنابراین سمت **Worker** را به‌طور کامل و واقعی پیاده و تست کردم (با
  Mock fetch)، اما سمت **VPS/Proxy** فقط یک پیشنهاد کد مستند و علامت‌گذاری‌شده
  به‌عنوان «تأیید‌نشده» است — نه چیزی که ادعا کنم دیده یا دیپلوی کرده‌ام.

## A — فایل‌های تغییرکرده
- **`src/shipping-engine.js`** — فقط تابع داخلی `tapinRequest` بازنویسی شد
  (و یک تابع کوچک جدید `getProxyCredentials` + دو ثابت پیش‌فرض اضافه شد).
  هیچ تابع دیگری (`quoteViaTapin`, `fetchTapinLocations`, `findTapinCityMatch`,
  `normalizePersianText`, Cache، City Mapping، تبدیل قیمت، ابعاد ۵×۵×۵) دست
  نخورد.
- **`test/tapin-proxy.test.mjs`** (جدید) — ۱۴ تست واقعی روی رفتار جدید.
- **`vps-proxy-snippet/tapin_route.py`** (جدید، جدا از پروژه سایت) — پیشنهاد
  Route سمت VPS؛ **دیپلوی/تست نشده**، فقط برای بررسی و اجرای دستی توسط کسی
  با دسترسی واقعی به VPS.
- هیچ فایل دیگری (Cart/Checkout/UI/Payment/D1) تغییر نکرد — با `diff -rq`
  در برابر ZIP اصلی تأیید شد.

## B — معماری نهایی
```
Worker (Cloudflare)
   → POST https://proxy.tasisatapadanaesfahan.ir/tapin/request
       Header: Authorization: Bearer <PROXY_API_KEY>
       Body:   { path, body: {shop_id, ...}, authorization: "Bearer <TAPIN_TOKEN>" }
   → Integration Proxy (VPS، IP ثابت 45.94.214.232)
   → POST https://api.tapin.ir/api/v4<path>
       Header: Authorization: <همان مقداری که Worker فرستاده>
```
Worker دیگر **هرگز** مستقیماً `api.tapin.ir` را صدا نمی‌زند — این با تست
`"Worker Proxy را صدا می‌زند، نه مستقیماً api.tapin.ir را"` تأیید شده (اگر
هر زمان تماسی به `api.tapin.ir` برود، آن تست fail می‌شود).

## C — Proxy
- **آیا Proxy موجود کافی بود؟** قابل‌تأیید نیست — کد واقعی VPS در این
  Sandbox در دسترس نبود.
- **آیا Route جدید لازم شد؟** طبق دستور بخش ۶، فرض نشد که موجود است. یک
  قرارداد حداقلی طراحی شد: `POST /tapin/request` با بدنه
  `{path, body, authorization}` و Passthrough خام پاسخ Tapin.
- **آیا VPS نیاز به تغییر داشت؟** بله، احتمالاً — `vps-proxy-snippet/tapin_route.py`
  پیشنهاد داده شده (FastAPI Router). این فایل باید توسط کسی با SSH واقعی به
  VPS بررسی، با ساختار واقعی `main.py`/Routerهای موجود آن سرویس هماهنگ، و
  بعد از تست دستی (نه فقط خواندن کد) Deploy شود. من چنین کاری را در همین
  Sandbox انجام نداده‌ام چون امکانش نبود.
- اصول امنیتی رعایت‌شده در پیشنهاد: مقصد Tapin Allowlisted و ثابت (۳ مسیر
  مستندشده)، بدون هیچ URL دلخواه از Worker؛ Authorization هرگز Log نمی‌شود؛
  احراز هویت Worker→Proxy با همان الگوی `PROXY_API_KEY` که سایر Route های
  غیر-health این سرویس استفاده می‌کنند.

## D — Tapin
- **Endpointهای استفاده‌شده:** بدون تغییر — همان ۳ مسیر (`province/filter`,
  `city/filter`, `check-price`)، فقط حالا از طریق بدنه درخواست به Proxy
  ارسال می‌شوند، نه URL مستقیم.
- **City Mapping:** بدون تغییر — همچنان از API واقعی Tapin (اکنون از طریق
  Proxy)، بدون فهرست دستی؛ normalize کردن ي/ك/نیم‌فاصله دست‌نخورده.
- **Cache:** بدون تغییر — In-Memory Module-Scope، TTL ۶ ساعت (همان محدودیت
  قبلی: فقط در طول عمر یک Isolate معتبر است).
- **check-price Request body:** بدون تغییر در ساختار (`shop_id`,
  `receiver_province_id/city_id`, تنظیمات از `config_json`, `products[]`,
  `length/width/height=5`, `weight_package`) — فقط حالا این بدنه به‌جای
  `fetch` مستقیم، داخل فیلد `body` درخواست به Proxy قرار می‌گیرد.
- **Response conversion:** بدون تغییر — `price_send_total ÷ 10` → تومان؛
  ابهام مستندشده قبلی درباره واحد واقعی Response همچنان **حل‌نشده** باقی
  مانده (چون بدون تماس واقعی قابل تأیید نبود) و باید در اولین Quote واقعی
  بعد از Deploy با پنل Tapin مقایسه شود.

## E — Secrets
فقط نام‌ها (بدون مقدار):
- `TAPIN_TOKEN`
- `TAPIN_SHOP_ID`
- `PROXY_API_KEY`

هیچ مقدار واقعی در کد، تست، یا این گزارش نمایش داده نشده.

## F — D1
هیچ Migration جدیدی ایجاد یا اجرا نشد. ساختار D1 کاملاً دست‌نخورده ماند.

## G — Tests
- **۱۴ تست جدید** در `test/tapin-proxy.test.mjs` — همگی سبز
  (`node test/tapin-proxy.test.mjs`)، با Mock کامل `fetch`. پوشش: عدم تماس
  مستقیم با `api.tapin.ir`، صحت بدنه/Headerهای درخواست به Proxy، مدیریت
  `PROXY_CREDENTIALS_MISSING`/`TAPIN_CREDENTIALS_MISSING`، خطاهای Proxy
  (`PROXY_ERROR`, `PROXY_NETWORK_ERROR`, `PROXY_INVALID_RESPONSE`)، حفظ
  رفتار قبلی `TAPIN_API_ERROR`، تبدیل قیمت، City Mapping، عدم نشت Secret در
  خروجی، قابل‌تنظیم بودن آدرس Proxy از Environment (نه ورودی کاربر)، و سالم
  ماندن Fallback موتور داخلی.
- **رگرسیون:** ۲۵ تست موجود در `test/packaging-estimation.test.mjs` دوباره
  اجرا شد (نه بازنویسی) — همچنان ۲۵/۲۵ سبز، بدون تأثیر از این تغییر.
- **ناهماهنگی مستند در دستور، به‌صورت صادقانه اعلام می‌شود:** متن دستور به
  «۲۰ تست جدید Tapin Adapter و مجموعاً ۶۱ تست سبز» با Mock fetch اشاره کرده
  بود. در ZIP واقعی آپلودشده (`tasisatapadana-site-packaging-estimation-fixed.zip`)
  پوشه `test/` **فقط شامل `packaging-estimation.test.mjs`** بود؛ هیچ فایل
  تست Tapin از قبل وجود نداشت. طبق قانون بخش ۰ («هرگز ادعا نکن فایلی را
  دیده‌ای که واقعاً در اختیار نداری»)، آن ۲۰/۶۱ تست ادعاشده در نسخه واقعی
  این ZIP قابل تأیید نبود — فقط تست‌های جدیدی که همین الان واقعاً نوشته و
  اجرا شدند، به‌عنوان واقعی گزارش می‌شوند.

## H — Real Tapin Test
**انجام نشد.** دلیل دقیق: این Sandbox هیچ دسترسی شبکه/اینترنتی ندارد (نه به
`proxy.tasisatapadanaesfahan.ir`، نه به `api.tapin.ir`)، پس هیچ تماس واقعی
— نه با Proxy واقعی و نه با Tapin — از این محیط ممکن نیست. تمام تست‌های
بالا با `fetch` Mock‌شده اجرا شدند؛ هیچ‌کدام «موفقیت واقعی» جا زده نشده.

## I — موارد باقی‌مانده
1. بررسی/پیاده‌سازی واقعی Route روی VPS (`vps-proxy-snippet/tapin_route.py`
   فقط پیشنهاد است) توسط کسی با دسترسی SSH واقعی، و Deploy آن.
2. یک Quote واقعی بعد از Deploy برای تأیید: پیشوند Header Authorization
   واقعی Tapin (فرض فعلی: `Bearer`)، واحد دقیق `price_send_total` در
   Response، و ساختار واقعی Response مسیر `province/filter`.
3. اتصال زنده Cart/Checkout به این Engine — طبق دستور صریح، در این مرحله
   عمداً انجام نشد.
4. تنظیم `shipping_calculation_mode` روی `online` یا `online_fallback_internal`
   از پنل Admin (فعلاً `internal` باقی مانده، یعنی هیچ تغییر رفتاری برای
   مشتری واقعی رخ نداده).
5. تأیید این‌که `PROXY_API_KEY` واقعاً هم در Cloudflare Secrets و هم در
   Environment سرویس VPS یکسان تنظیم شده باشد (پیش‌نیاز Route پیشنهادی).

## J — خارج از محدوده
تأیید شده (با `diff -rq` در برابر ZIP اصلی): **هیچ تغییری** در Cart، Checkout،
Payment (ZarinPal/SEP)، Tracking، Label، Ready-to-Send، Cancel، UI/CSS،
Header/Footer، حساب کاربری، SMS، یا هیچ D1 Migration انجام نشده. فقط
`src/shipping-engine.js` (تابع `tapinRequest`) و فایل‌های تست/گزارش جدید
تغییر کردند.
