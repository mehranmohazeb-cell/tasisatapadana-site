# گزارش مهندسی — نهایی‌سازی Tapin Post v2 (Worker → VPS → Tapin)

**LIVE TEST NOT PERFORMED.** هیچ تماس واقعی با Tapin/VPS انجام نشد (این محیط شبکه، Token و دسترسی VPS ندارد). Deploy، Push، تغییر VPS/Cloudflare/.env انجام نشد.

## فایل‌های تغییرکرده
| فایل | تغییر |
|---|---|
| `vps-proxy/integrations/tapin.py` (= `integrations/tapin.py` روی VPS) | بازنویسی کامل برای Post v2 |
| `vps-proxy/routers/tapin.py` (= `routers/tapin.py` روی VPS) | خطاهای کنترل‌شده و ساختاریافته |
| `src/shipping-engine.js` | بدنهٔ جدید Worker→VPS، حذف service_type/فیلدهای Tipax، خواندن `error_code` |
| `public/admin/shipping/providers/index.html` + `providers.js` | فقط `pay_type` و `order_type` (فیلدهای قدیمی Tipax حذف) |
| `test/tapin-proxy.test.mjs`, `shipping-shared-quote.test.mjs`, `shipping-audit-diagnostics.test.mjs` | هماهنگ با قرارداد جدید؛ assertionهای داخل mock دیگر بلعیده نمی‌شوند |
| `test/vps/test_tapin_vps.py` | جدید (۲۶ تست Python) |
| `vps-proxy-snippet/tapin_route.py` | **حذف شد** — کد مرده و بلااستفاده با `/api/v4` و `/tipax/public/user/order/check-price/` |

بدون تغییر: `shipping_table_rates`، موتور داخلی، Payment، D1 (بدون Migration)، سایر بخش‌های سایت.

## قرارداد Worker → VPS (`POST /api/v1/tapin/quote`، Bearer حفظ شد)
`destination_city`, `destination_province` (در صورت وجود، همیشه)، `pay_type`, `order_type`، `products[{count, discount, price, title, weight, product_id}]`، `length`, `width`, `height` (سانتی‌متر، فقط برای انتخاب box_id)، `package_weight`.
- تومان→ریال ×۱۰ فقط یک‌بار در Worker؛ VPS هیچ تبدیل پولی ندارد. ریال→تومان ÷۱۰ فقط یک‌بار در Worker روی `entries.total_send_price`.
- `title` = نام واقعی محصول از D1؛ `weight` = وزن کالا (گرم)؛ `package_weight` = فقط سهم بسته‌بندی (گرم) — منطق قبلی پروژه حفظ شد، وزن کالا دوبار شمرده نمی‌شود.

## قرارداد VPS → Tapin
`POST {base}/api/v2/public/order/post/check-price/` با: `shop_id, address, city_code, province_code, first_name, last_name, mobile, postal_code, employee_code, pay_type, order_type, package_weight, box_id, products[]` و در صورت تنظیم: `description, email, phone, kiosk_id`. بدنه با whitelist ساخته می‌شود؛ هیچ فیلد Tipax/v4 (`receiver_*_id, product_type_id, packing_type_id, service_type, length/width/height ...`) ارسال نمی‌شود، حتی اگر Worker قدیمی بفرستد. base اگر `/api/v1` داشته باشد به `/api/v2` نرمال می‌شود.

## پیش‌فرض‌ها
- `pay_type` = **1**، `order_type` = **0** — قابل تنظیم: config_json پرووایدر > `TAPIN_PAY_TYPE/TAPIN_ORDER_TYPE` (Worker یا VPS) > پیش‌فرض. Secret جدیدی ساخته نشد.

## package_weight و واحد
Worker همیشه گرم می‌فرستد. VPS پیش‌فرض `TAPIN_PACKAGE_WEIGHT_UNIT=g` (بدون تبدیل)؛ فقط اگر `kg` باشد، هر مقدار وزن (package_weight و weight محصولات) یک‌بار ÷۱۰۰۰ می‌شود. پاسخ VPS شامل `sent.{box_id, package_weight, weight_unit, products_weight_grams}` و `entries.total_weight` است تا در Live Test مقایسه شود. واحد واقعی Tapin تأیید نشده.

## box_id
لیست باکس‌ها از endpoint `packing-box` گرفته و ۶ ساعت کش می‌شود (ابعاد ثابت در کد نیست، ۵×۵×۵ جعلی هم نیست). کوچک‌ترین باکس ۱ تا ۹ که بسته در آن جا شود (با چرخش ابعاد) انتخاب می‌شود؛ اگر هیچ‌کدام جا نشد `box_id=10`؛ ۱۱ تا ۱۵ هرگز خودکار انتخاب نمی‌شوند.

## شهر/استان
`state/tree` اولویت، fallback: `state/list` + `city/list` (با `state_code`). نرمال‌سازی ي/ك/ى، نیم‌فاصله، فاصله‌ها، پیشوند «استان/شهر». شهر با استان resolve می‌شود. کدها: `CITY_NOT_FOUND`، `CITY_AMBIGUOUS` (+candidates)، و `PROVINCE_NOT_FOUND`. هیچ کد Tapin hard-code نیست.

## خطاها
بدنهٔ Tapin قبل از بررسی status خوانده می‌شود (بدون `raise_for_status`). کدها: `TAPIN_HTTP_<n>`, `TAPIN_AUTH_ERROR`, `TAPIN_TIMEOUT`, `TAPIN_NETWORK_ERROR`, `TAPIN_PRICE_NOT_FOUND`, `TAPIN_PRICE_INVALID` (صفر/منفی هرگز رایگان نمایش داده نمی‌شود), `TAPIN_CONTRACT_INCOMPLETE` (+missing_fields), `TAPIN_BOX_LIST_INVALID`, `TAPIN_LOCATION_UNAVAILABLE`, `TAPIN_<returns.status>`. Router: بدنهٔ `{ok:false,error_code,message}`؛ 400 برای ورودی نامعتبر، 501 غیرفعال، 502 خطای پیش‌بینی‌نشده بدون stack trace. Token و Shop ID از همهٔ خروجی‌ها redact می‌شوند (تست شده).
**باگ قرارداد که پیدا و اصلاح شد:** Worker کلید `error` را می‌خواند ولی VPS `error_code` برمی‌گرداند؛ حالا Worker هر دو را می‌پذیرد و کد خطای HTTP غیر-۲xx را هم حفظ می‌کند.

## Fallback و چندمحصولی
`online` فقط Tapin؛ `online_fallback_internal` فقط در شکست واقعی به موتور داخلی با `source=internal, fell_back=true`. `TAPIN_MULTI_PACKAGE_UNSUPPORTED` حفظ شد. Worker دیگر SLA ساختگی تیپاکس نمی‌سازد (`estimated_delivery=null`)، carrier=`post`.

## تست‌ها
- JS: packaging 25، audit 10، calc-mode 9، quote-history 4، shared-quote 21، tariff-import 4، tapin-proxy 23 = **96 PASS / 0 FAIL**
- Python (VPS): **26 PASS / 0 FAIL** — با stub برای httpx/fastapi/config/auth (نصب نبودند)؛ فایل‌های واقعی tapin.py بدون تغییر import می‌شوند. fixtureهای شهر/باکس ساختگی‌اند، نه دادهٔ واقعی Tapin.
- Mutation check: تغییر عمدی pay_type پیش‌فرض و باکس overflow، تست‌ها را واقعاً قرمز کرد.

## فقط با Live Test قابل تأیید
1. مسیرهای `state/tree`, `state/list`, `city/list`, `packing-box` و متد (POST؛ روی 405 → GET) و شکل پاسخ‌ها (کلیدهای `id/length/width/height`، واحد سانتی‌متر). مسیرها با `TAPIN_PATH_<CHECK_PRICE|PACKING_BOX|STATE_TREE|STATE_LIST|CITY_LIST>` بدون تغییر کد قابل override‌اند.
2. پذیرش `kiosk_id` اختیاری، `product_id` عددی، `weight` هر محصول (گرم/واحد)، و اینکه `total_weight` پاسخ با `products.weight×count + package_weight` می‌خواند.
3. شکل هدر Authorization (مقدار خام Token، مانند کد قبلی) و اینکه `entries.total_send_price` ریال است.

## ریسک‌های باقی‌مانده
- **گیرندهٔ Quote:** Estimate قبل از Checkout اطلاعات گیرنده ندارد. VPS باید این متغیرها را داشته باشد وگرنه `TAPIN_CONTRACT_INCOMPLETE`: `TAPIN_QUOTE_ADDRESS, TAPIN_QUOTE_FIRST_NAME, TAPIN_QUOTE_LAST_NAME, TAPIN_QUOTE_MOBILE, TAPIN_QUOTE_POSTAL_CODE, TAPIN_EMPLOYEE_CODE` (اختیاری: `_PHONE, _EMAIL, _DESCRIPTION, TAPIN_KIOSK_ID`). مقدار ساختگی در کد نیست.
- **config.py پیوست نبود:** متغیرهای جدید با `getattr(settings)` و سپس `os.environ` خوانده می‌شوند. اگر `.env` فقط توسط pydantic خوانده شود و در محیط پردازش (systemd EnvironmentFile) نباشد، `os.environ` آن‌ها را نمی‌بیند؛ در این حالت باید به `Settings` اضافه شوند.
- **تعداد >۱ از یک محصول:** ابعاد بسته از یک واحد برآورد می‌شود و ضرب در تعداد نمی‌شود؛ ممکن است box کوچک‌تر از نیاز انتخاب شود (منطق قبلی packaging؛ دست نزدم، فقط گزارش).
- `package_weight` ممکن است ۰ شود اگر وزن برآوردی ≤ وزن کالا باشد؛ Tapin ممکن است رد کند.
- گزارش‌های قدیمی (`tapin-proxy-report.md`, `tapin-vps-integration-report.md`) قرارداد قدیمی را توصیف می‌کنند و قدیمی‌اند.

## گام بعد (خارج از این مرحله)
جایگزینی دو فایل VPS، افزودن متغیرهای بالا، ری‌استارت سرویس، Deploy Worker و یک Live Quote (تهران/ورامین) با مقایسهٔ `total_weight` و `sent.*`.


## بازبینی نهایی نیک — 2026-09-29

این ZIP پس از دریافت، توسط نیک بازبینی شد. یک ضعف عملی در نسخه اولیه اصلاح شد:

### اصلاح انجام‌شده در `vps-proxy/integrations/tapin.py`
- خواندن تنظیمات Tapin فقط به فیلدهای تعریف‌شده در `config.py` وابسته نیست.
- اولویت تنظیمات: `process environment` → فایل `.env` پروژه → `Settings`.
- اگر `config.py` برای متغیرهای جدید `TAPIN_QUOTE_*` فیلد نداشته باشد، Adapter مستقیماً `.env` واقعی پروژه را به‌صورت read-only می‌خواند.
- `TAPIN_ENABLED`, `TAPIN_TOKEN`, `TAPIN_SHOP_ID`, `HTTP_TIMEOUT_SECONDS` نیز از همین مسیر مقاوم خوانده می‌شوند.
- Token و Shop ID همچنان فقط روی VPS باقی می‌مانند و هیچ‌کدام وارد Worker یا ZIP به‌صورت واقعی نشده‌اند.
- هدر Authorization و بدنه درخواست همچنان همان قرارداد Post v2 هستند.
- هیچ endpoint یا فیلد Tipax/v4 اضافه نشده است.

### تست پس از اصلاح
`test/vps/test_tapin_vps.py`:
**27 PASS / 0 FAIL**

این 27 تست همچنان تست قراردادی/منطقی هستند و Live Test واقعی Tapin نیستند.

### نکته‌ای که هنوز عمداً انجام نشده
هیچ مقدار ساختگی برای گیرنده ایجاد نشده است. برای Live Quote واقعی، اگر Tapin برای check-price این فیلدها را اجباری کند، باید در `.env` واقعی VPS مقدار واقعی/مجاز برای این موارد وجود داشته باشد:

`TAPIN_QUOTE_ADDRESS`
`TAPIN_QUOTE_FIRST_NAME`
`TAPIN_QUOTE_LAST_NAME`
`TAPIN_QUOTE_MOBILE`
`TAPIN_QUOTE_POSTAL_CODE`
`TAPIN_EMPLOYEE_CODE`

اختیاری:
`TAPIN_QUOTE_PHONE`
`TAPIN_QUOTE_EMAIL`
`TAPIN_QUOTE_DESCRIPTION`
`TAPIN_KIOSK_ID`

این مقادیر در کد یا ZIP حدس زده نشده‌اند.

### وضعیت واقعی
- کد Worker→VPS→Tapin Post v2 آماده است.
- VPS adapter و router آماده جایگزینی هستند.
- Live Test هنوز انجام نشده است.
- Deploy Worker هنوز نباید انجام شود تا دو فایل VPS جایگزین شوند و سرویس بررسی شود.
- هدف Live Test بعدی: یک Quote واقعی برای شهری مثل ورامین/تهران، سپس بررسی هم‌زمان `entries.total_send_price`, `entries.total_weight`, `sent.box_id`, `sent.package_weight` و لاگ/Quote History.
