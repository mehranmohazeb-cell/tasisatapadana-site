# گزارش اصلاح نهایی Tapin Post v2 (Check-Price)

NO DEPLOY · NO GIT PUSH · NO VPS CHANGE · NO LIVE TEST
هیچ تستی اجرا نشد (unit/integration/live/curl/preview). فقط بررسی ایستای syntax انجام شد (`ast.parse` برای Python و `node --check` برای JS) که اجرای تست نیست.

## ۱. چه چیزی اصلاح شد — در کدام فایل — چرا

### `vps-proxy/integrations/tapin.py`
1. **`packet_type` (اجباری در قرارداد) اضافه شد.** قبلاً اصلاً ارسال نمی‌شد. مقدار از بدنهٔ درخواست یا `TAPIN_PACKET_TYPE` می‌آید؛ اگر هیچ‌کدام نبود → `TAPIN_CONTRACT_INCOMPLETE` با `missing_fields`. مقدار نمونهٔ ۲ هیچ‌جا hardcode نشد.
2. **`box_id=10` برای «بیشتر از ۹» دیگر hardcode نیست.** `choose_box_id` اگر در ۱..۹ جایی نبود `None` برمی‌گرداند و مقدار overflow از `TAPIN_OVERFLOW_BOX_ID` خوانده می‌شود؛ نبودنش → `TAPIN_CONTRACT_INCOMPLETE`. (فقط وقتی لازم است که بسته در ۱..۹ جا نشود.) کلید `pk` (نام رسمی در پاسخ packing-box) اولویت اول خواندن شناسه جعبه شد.
3. **`product_id` دیگر ارسال نمی‌شود.** در قرارداد، `product_id` شناسهٔ کالا در کاتالوگ خود Tapin است؛ چیزی که Worker می‌فرستاد شناسهٔ داخلی فروشگاه بود و می‌توانست Tapin را به کالای نامرتبط وصل کند. طبق قرارداد، بدون آن `title/weight/price` ارسال می‌شود (هر سه ارسال می‌شوند).
4. **نوع فیلدها مطابق جدول قرارداد (int):** `city_code`, `province_code`, `postal_code`, `employee_code`, `package_weight`, `box_id`, `packet_type`, `kiosk_id` و در products: `count/discount/price/weight`. مقدار غیرعددی → `TAPIN_CONTRACT_INCOMPLETE` با `invalid_fields` (نه ارسال مقدار خراب).
5. **واحد وزن:** قرارداد «گرم صحیح» است؛ مسیر `TAPIN_PACKAGE_WEIGHT_UNIT=kg` (که عدد اعشاری می‌ساخت) حذف و به خطای صریح تبدیل شد. پیش‌فرض `g` است و تغییری برای VPS فعلی لازم نیست.
6. **محدودیت طول:** `title` حداکثر ۱۰۰ (کوتاه می‌شود چون فقط برچسب نمایشی است)؛ `address` ۳۰۰، `first_name` ۳۰، `last_name` ۴۰، `description` ۲۵۰ (چون از پیکربندی/داده واقعی می‌آیند، بی‌صدا بریده نمی‌شوند؛ خطای صریح).
7. **`has_insurance` اختیاری:** فقط اگر مقدار واقعی در درخواست یا `TAPIN_HAS_INSURANCE` (۰/۱/true/false) باشد ارسال می‌شود؛ وگرنه ارسال نمی‌شود و حدس زده نمی‌شود.
8. `sent.packet_type` به پاسخ VPS اضافه شد (برای بررسی در تست بعدی).

### `src/shipping-engine.js`
1. **`product_id` داخلی از `products[]` حذف شد** (دلیل بالا، مورد ۳).
2. **عبور اختیاری `packet_type`** از `config_json` پرووایدر یا `env.TAPIN_PACKET_TYPE` (اولویت مثل pay/order). **بدون پیش‌فرض**: اگر تنظیم نباشد ارسال نمی‌شود و VPS از `.env` خودش می‌خواند. مقدار نامعتبر → `TAPIN_CONFIG_INCOMPLETE` (مکانیزم موجود).
3. کامنت‌های قرارداد به‌روز شد.

### تست‌ها (فقط هماهنگ‌سازی، اجرا نشد)
- `test/vps/test_tapin_vps.py`: fixtureها با قرارداد جدید هماهنگ شد؛ تست‌های `kg`، overflow و کلیدهای بدنه به‌روز شدند؛ تست‌های جدید برای packet_type، overflow از config، int بودن فیلدها، طول‌ها، has_insurance، title.
- `test/tapin-proxy.test.mjs`: انتظار `product_id` حذف و تست `packet_type` اضافه شد.

## ۲. بررسی‌ای که نتیجه‌اش «بدون تغییر» بود
- **وزن‌ها:** `products[].weight` = وزن خالص کالا (گرم) و `package_weight` = فقط بسته‌بندی؛ متن پنل ادمین هم همین را می‌گوید (وزن کالا جدا ارسال می‌شود). دوباره‌شماری وجود ندارد.
- **پول:** تومان→ریال فقط یک‌بار در Worker (`RIAL_PER_TOMAN`)؛ ریال→تومان فقط یک‌بار روی `entries.total_send_price`؛ VPS هیچ تبدیل پولی ندارد.
- **`order_type=0` و `pay_type=1`**: پیش‌فرض‌های configurable موجود ماندند (۰ مطابق نمونهٔ رسمی Check-Price؛ ۱ طبق تصمیم قبلی شما). مقادیر Registration قاطی نشدند.
- **city/province:** همچنان از `state/tree` (و fallback `state/list`+`city/list`) resolve می‌شود؛ هیچ کد hardcode نیست.
- استخراج قیمت، mapping خطاها، redaction توکن/Shop ID، `TAPIN_MULTI_PACKAGE_UNSUPPORTED`، shipping_table_rates، موتور داخلی، COD، D1، پرداخت، UI، Tracking/Register: دست نخورد.

## ۳. چه چیزهایی عمداً تغییر نکرد
Tipax، courier اصفهان، ZarinPal، احراز هویت/حساب، کاتالوگ، schema D1، Register/Tracking، معماری Worker→VPS→Tapin.

## ۴. چه چیزهایی هنوز به پیکربندی واقعی نیاز دارند (VPS `.env`؛ من تغییرشان ندادم)
| متغیر | وضعیت |
|---|---|
| `TAPIN_PACKET_TYPE` | **الزامی** — بدون آن Quote با `TAPIN_CONTRACT_INCOMPLETE` متوقف می‌شود (نمونهٔ رسمی ۲=بسته است، ولی تأیید مقدار production با شماست) |
| `TAPIN_EMPLOYEE_CODE` | **الزامی**، باید عدد صحیح باشد (قبلاً هم لازم بود) |
| `TAPIN_QUOTE_ADDRESS / FIRST_NAME / LAST_NAME / MOBILE / POSTAL_CODE` | **الزامی** (postal_code عددی؛ طول‌ها در حد قرارداد) |
| `TAPIN_OVERFLOW_BOX_ID` | فقط وقتی بسته در ۱..۹ جا نشود؛ مقدار را باید از پاسخ واقعی packing-box/مستند تأیید کنید (۱۰ فرض نشد) |
| `TAPIN_HAS_INSURANCE` | اختیاری؛ فقط اگر بخواهید ارسال شود |
| `TAPIN_PAY_TYPE/ORDER_TYPE`, `TAPIN_KIOSK_ID` | اختیاری (پیش‌فرض ۱ و ۰؛ kiosk فقط برای locker واقعی) |
| `TAPIN_PACKAGE_WEIGHT_UNIT` | اگر تنظیم شده باید `g` باشد (یا حذف شود) |

فیلدهای اختیاری `description/email/phone` فقط با مقدار واقعی؛ `duration/parcel_turning/pre_paid_price/packaging_price` عمداً ارسال نمی‌شوند (مقدار واقعی‌ای برای آن‌ها وجود ندارد).

## ۵. نکات و ریسک‌هایی که باید در تست کنترل‌شده دیده شوند
- **int در برابر string:** جدول قرارداد «int» می‌گوید اما نمونهٔ رسمی برای `city_code/province_code/employee_code/pay_type/order_type/postal_code` رشته‌ای نوشته شده. من طبق جدول int می‌فرستم (فیلدهای عددی DRF معمولاً هر دو را می‌پذیرند)؛ اگر Tapin خطای 300/371 داد، همین مورد اولین مظنون است.
- `has_insurance` در جدول int و در نمونه bool است؛ در صورت استفاده، ۰/۱ ارسال می‌شود.
- تعداد >۱ از یک کالا: ابعاد بسته هنوز از یک واحد برآورد می‌شود (محدودیت شناخته‌شدهٔ قبلی، خارج از این مرحله).
- `package_weight=0` هنوز مجاز است (ممکن است Tapin خطای 805 بدهد).

## ۶. آیا مقدار حدسی/hardcoded اضافه شد؟
**خیر.** هیچ مقدار جدیدی hardcode نشد؛ `packet_type`، overflow box، `employee_code`، گیرنده و `has_insurance` فقط از ورودی/پیکربندی می‌آیند و نبودشان خطای صریح است. تنها مقادیر ثابت در کد: محدودیت طول‌ها و بازهٔ ۱..۹ جعبه‌های قابل‌انتخاب که هر دو مستقیم از قرارداد شما هستند، و پیش‌فرض‌های قبلی `pay_type=1`/`order_type=0`.

این نسخه برای مرحلهٔ بعد (تست کنترل‌شده) آماده است.
