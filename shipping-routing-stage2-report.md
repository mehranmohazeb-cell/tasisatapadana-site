# گزارش مرحله ۲ — Routing قطعی ارسال (Tapin ↔ موتور داخلی)

منبع: tasisatapadana-site-stage1-internal-engine.zip (SHA-256 تأییدشده: ee45a9cd…fa10e4 — با فایل آپلودی مطابقت داشت) + دو سند جلسه.

## ۱ و ۲ و ۳) Routing قبلی و تست زندهٔ پکیج آدنا در مشهد
Routing قبلی (`resolveCustomerShipping` در src/shipping-engine.js) **هیچ طبقه‌بندی نداشت**؛ فقط بر اساس `shipping_calculation_mode` تصمیم می‌گرفت:
- `internal` → فقط موتور داخلی
- `online` → فقط Tapin (برای هر کالایی)
- `online_fallback_internal` → **ابتدا Tapin**؛ در شکست، موتور داخلی

در کل کد (index.js، shipping-engine.js) هیچ شاخه‌ای بر اساس Shipping Class، وزن، ابعاد، `require_separate_shipment` یا `packaging_group` مسیر Provider را عوض نمی‌کرد (این‌ها فقط برای وزن قابل‌محاسبه/بسته‌بندی بودند).

**نتیجه برای تست زنده: «ابتدا Tapin فراخوانی شده و سپس fallback شده».**
این نتیجه از **کد** استخراج شده، نه از لاگ زنده (لاگ/D1 زنده در ZIP نیست): چون شیر لباسشویی از Tapin قیمت گرفت و پکیج خروجی داخلی داد، تنها حالتی که هر دو را می‌سازد `online_fallback_internal` است؛ در آن حالت پکیج هیچ مسیر «از ابتدا Internal» ندارد و فقط پس از شکست Tapin به Internal می‌رسد. علت دقیق شکست Tapin برای پکیج (مثلاً ابعاد/مبلغ/پاسخ Proxy) از کد قابل اثبات نیست. برای تأیید قطعی: ردیف `shipping_quote_history` مربوط به پکیج آدنا/مشهد را نگاه کنید (status/error_code). «روشی در دسترس نیست» = Internal برای مشهد تعرفه نداشت.

## ۴) معیار قطعی Normal / Abnormal
فقط **داده**، به ترتیب اولویت (فایل جدید src/shipping-routing.js):
1. `products.shipping_route_override` (`freight` | `normal` | NULL) — Override مدیریتی
2. `shipping_classes.route_policy` (`freight` | `normal` | NULL=normal) — محور اصلی
3. پیش‌فرض: عادی

وابسته به Tapin نیست و نام محصول در آن نیست. سبد: اگر هر کالا غیرعادی باشد، کل سبد غیرعادی است (بدون Split).

## ۵ و ۶ و ۷) وزن، ابعاد، حجم، بسته‌بندی، قیمت — Thresholdها
- **هیچ آستانهٔ عددی در پروژه وجود نداشت و هیچ عددی اضافه نشد.** (تست خودکار هم اسکن می‌کند که در src/shipping-routing.js مقایسهٔ عددی وزن/ابعاد/قیمت نیست.)
- وزن/ابعاد/بسته‌بندی/قیمت **Routing را تغییر نمی‌دهند**؛ فقط (الف) هزینهٔ مسیر عادی و (ب) **Flag هشدار برای مدیر** (مثلاً وزن بسته کمتر از وزن محصول، بستهٔ کوچک‌تر از محصول، ابعاد ناقص، بدون Shipping Class، پروفایل حجیم ولی مسیر عادی). Flag ≠ Routing.
- قبلاً موجود بود: ضرایب/تلرانس/حداقل‌ها در `packaging_profiles` (نمونه، قابل‌ویرایش)، ضریب حجمی ۵۰۰۰ — همه برای تخمین بسته‌بندی، نه تصمیم مسیر.
- **قیمت/کم‌حاشیه: در پروژه داده یا Setting برای تشخیص آن نیست** → به Freight منتقل نمی‌شود. نیاز به تصمیم مدیریتی (بخش ۱۹).
- **تصمیم لازم از شما:** وزن/ابعاد چه زمانی «غیرعادی» است؟ پیشنهاد معماری (اجرا نشد): همچنان با Shipping Class/Override بیان شود (همین‌طور که اکنون است)، یا یک Setting قابل‌تنظیم و پیش‌فرض خاموش اضافه شود.

## ۸) Shipping Class و Packaging Profile
- Shipping Class: محور تشخیص (ستون جدید `route_policy`، اضافه به ساختار موجود؛ ساختار موازی ساخته نشد). مدیر کلاس‌های پکیج/آبگرمکن/رادیاتور را روی «باربری» می‌گذارد.
- Packaging Profile (`BULKY`, `require_separate_shipment`, `packaging_group`) دست‌نخورده؛ فقط در Flag استفاده می‌شود (ناهماهنگی پروفایل حجیم و مسیر عادی). تخمین بسته‌بندی دست‌نخورده.

## ۹) سبد چندمحصولی
قطعی و یکسان در Estimate/Cart/Checkout/Admin Preview (یک تابع):
- اصفهان → پیک رایگان برای کل سبد
- خارج اصفهان، هر کالای غیرعادی → کل سبد باربری/پس‌کرایه؛ Tapin هیچ‌وقت صدا زده نمی‌شود
- همه عادی → رفتار فعلی Tapin (چندکالایی متفاوت همچنان `TAPIN_MULTI_PACKAGE_UNSUPPORTED`، بدون تغییر)

## ۱۰) اصفهان
`isOfficialIsfahan`: نام شهر پس از نرمال‌سازی (ي/ك، نیم‌فاصله) **دقیقاً «اصفهان»** و استان خالی یا «اصفهان». بهارستان، شاهین‌شهر، خمینی‌شهر و بقیه (حتی با استان اصفهان) false. نتیجه: فقط گزینهٔ «پیک موتوری»، هزینه ۰، `payment_mode=free`؛ روش داخلی و Tapin ارائه نمی‌شوند. متن مشتری هیچ مفهوم «فوری/سریع» ندارد.
نکته: فقط تطبیق نام شهر است؛ محدودهٔ شهرداری (مثلاً روستا/منطقهٔ پیرامونی با آدرس «اصفهان») از روی فیلد شهر قابل تشخیص نیست — در صورت نیاز باید از آدرس/کدپستی تصمیم جدا گرفته شود.

## ۱۱) Freight / Receiver Pays
گزینهٔ مجازی `freight`: `cost_type=cod`، `payment_mode=receiver_pays`، `cost_known=false` (هزینهٔ نامشخص، نه «۰=رایگان»). رایگان: `payment_mode=free`. روی سفارش: ستون‌های جدید `shipping_payment_mode` (free|prepaid|receiver_pays)، `shipping_route`، `shipping_max_dispatch_days`. `shipping_is_cod=1` و `payable_amount` بدون هزینه حمل (منطق موجود). UI مشتری «رایگان» و «پس‌کرایه (هزینه هنگام تحویل…)» را متفاوت نشان می‌دهد.

## ۱۲) Override مدیریتی
صفحهٔ جدید `/admin/shipping/routing/` (زیرمنوی «مسیر ارسال»): مسیر هر کلاس، Override هر محصول، مسیر مؤثر + دلیل، فیلتر (باربری/هشدار/Override)، تاریخچهٔ تغییرات (`shipping_route_audit`)، با راهنمای ⓘ. برگشت: انتخاب «عادی» یا «بدون Override». Endpointها فقط Admin.

## ۱۲ و ۱۳ مأموریت) ۳ روز و حداقل مبلغ پیک
- ۳ روز: ثابت `ROUTING_RULES.max_dispatch_days`، در `max_dispatch_days` همهٔ گزینه‌ها و پیام مشتری، Snapshot سفارش. Express پیاده نشد.
- حداقل مبلغ پیک رایگان: **پیاده/Hard-code نشد** و ستون هم ساخته نشد (رفتار «زیر حداقل» تصمیم نشده — نیاز به تصمیم).

## ۱۳) فایل‌های تغییرکرده
جدید: `src/shipping-routing.js`, `database/shipping-routing.sql`, `public/admin/shipping/routing/{index.html,routing.js}`, `test/shipping-routing.test.mjs`
تغییر: `src/shipping-engine.js` (wrapper جدید `resolveCustomerShipping`؛ منطق قبلی بی‌تغییر به `resolveNormalShipping` تغییر نام یافت + `tapin_called`؛ نام گزینهٔ مشتری «ارسال پستی (Tapin)» → «ارسال پستی»)، `src/index.js` (import، Endpointهای Admin، شناسه‌های مجازی در Checkout، Snapshot سفارش، فیلدهای پاسخ)، `public/store/{cart,checkout,product,order-success}.html`، `public/admin/admin-common.js` (یک آیتم زیرمنو)، دو تست قدیمی (بخش ۱۵).
دست‌نخورده: Tapin API/Proxy/Token/Shop ID/فیلدهای Quote، `resolveShippingOptionsForCart`، `packaging-estimation.js`، VPS، Schemaهای فعلی.

## ۱۴) Migration
یک فایل افزایشی: `database/shipping-routing.sql` (۵ ADD COLUMN + ۱ جدول Audit). با ایجاد آن هیچ محصولی خودکار باربری نمی‌شود. روی SQLite واقعی اجرا و CHECKها تأیید شد. قبل از اجرا همه چیز Fail-Safe است (همه «عادی»، اصفهان همچنان پیک رایگان). **تا Migration اجرا نشود، تعیین کلاس باربری ممکن نیست.** اجرا فقط یک‌بار.

## ۱۵ و ۱۶) تست‌ها (اجرای واقعی Worker + D1 sqlite + Proxy موک؛ «Tapin فراخوانی شد؟» از شمارندهٔ fetch)
test/shipping-routing.test.mjs: **23/23 PASS** — A, B, C (۳ حالت mode), D, E (۳ نوع خطا/موفقیت Tapin ⇒ خروجی یکسان؛ ۰ تماس), F, G, H, I, J, K, L، Override/کلاس/Audit/برگشت، Flag، نبود Threshold، Fail-Safe بدون Migration، Checkout (باربری، اصفهان، رد روش نامجاز بدون کسر موجودی، Tapin عادی).
**اثبات بند ۱۶:** تست E و C — سبد غیرعادی با Tapin در حال خطا/Exception/موفق همیشه همان نتیجهٔ باربری را می‌دهد و `fetch` صفر بار صدا زده می‌شود؛ تست ۰ رفتار قدیمی (Tapin اول، سپس fallback) را بازتولید می‌کند.
سایر Suiteها (بدون Regression): packaging 25/25، audit 10/10، calc-mode 9/9، preview-override 8/8، quote-history 4/4، shared-quote 21/21، tariff-import 4/4، tapin-proxy 30/30.
**تغییر عمدی دو تست قدیمی:** shared-quote و preview-override از «اصفهان» به‌عنوان نمونهٔ شهر با تعرفهٔ داخلی استفاده می‌کردند که با قانون جدید (اصفهان همیشه پیک رایگان) سازگار نیست؛ شهر نمونه به «مشهد» تغییر کرد و نام «ارسال پستی (Tapin)» به «ارسال پستی». هیچ Assertion ضعیف نشد.
انجام‌نشده: تست زنده با Tapin/D1/UI واقعی (Sandbox شبکه ندارد؛ UI فقط از نظر Syntax بررسی شد، نه رندر مرورگر).

## ۱۷) Regressionهای احتمالی
- مشتری اصفهان دیگر روش داخلی «پیک اصفهان (۴۰٬۰۰۰)» را نمی‌بیند؛ فقط پیک رایگان (طبق سند). روش‌های دستی scope=city برای اصفهان بی‌اثر می‌شوند.
- بدون Migration/تنظیم کلاس، پکیج همچنان مثل قبل Tapin می‌شود.
- سفارش‌های باربری هزینهٔ حمل را در سیستم ندارند (۰ و `cost_known=false`)؛ فاکتور/پنل «۰ تومان» نشان می‌دهند در کنار برچسب پس‌کرایه — فاکتور/پنل سفارش بازطراحی نشد.
- Admin Preview برای Provider مسیر Routing مقدار `routing` برمی‌گرداند.
- ثبت Snapshot سفارش یک UPDATE جداست؛ در شکست فقط Log می‌شود.
- متن «قوانین و مقررات» (مرحلهٔ ۷ برنامه) و UI سفارش‌های قدیمی/جزئیات سفارش دست نخورد (خارج از مأموریت).

## ۱۸) Rollback
۱) Worker را به ZIP مرحلهٔ ۱ برگردانید (`ee45a9cd…`). ۲) Migration بی‌ضرر است و لازم نیست برگردد (ستون‌های Nullable؛ کد قدیمی نادیده می‌گیرد). ۳) برای خنثی‌سازی منطقی بدون Deploy: همهٔ `route_policy` را `normal` و Overrideها را NULL کنید (از همان صفحهٔ Admin). قانون اصفهان فقط با Deploy قدیمی برمی‌گردد.

## ۱۹) آیا مرحلهٔ ۲ کامل است؟
**از نظر Routing و Rule: بله، در محدودهٔ کد/ZIP. نیاز به تصمیم/اطلاعات شما:**
1. اجرای `database/shipping-routing.sql` و سپس تعیین کلاس‌های باربری (پکیج، آبگرمکن، رادیاتور…) در `/admin/shipping/routing/`.
2. معیار وزن/ابعاد/قیمت (کالای گران/کم‌حاشیه) برای «غیرعادی» — تصمیم نشده، پیاده نشد.
3. حداقل مبلغ پیک رایگان و رفتار زیر آن (غیرفعال).
4. تعریف «محدودهٔ شهرداری» اگر فراتر از نام شهر باشد.
5. تأیید علت شکست Tapin برای پکیج از `shipping_quote_history` زنده.
6. نمایش «پس‌کرایه» در فاکتور/جزئیات سفارش/پنل (مرحلهٔ ۴/۵ برنامه).

## ۲۰) ZIP نهایی
tasisatapadana-site-stage2-routing.zip — SHA-256 در پیام تحویل اعلام شده است. هیچ Deploy انجام نشد.
