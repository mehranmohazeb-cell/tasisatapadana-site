# گزارش نهایی — سیستم هوشمند تخمین بسته‌بندی + تلرانس حمل + سیستم راهنمای پنل

این گزارش دقیقاً مطابق ساختار «بخش ۲۹» دستور توسعه نوشته شده است.

## ۱. فایل‌های تغییرکرده

- `src/index.js` — یکپارچه‌سازی لایه تخمین بسته‌بندی داخل `resolveShippingOptionsForCart` (بدون بازنویسی موتور موجود)، افزودن endpointهای مدیریتی جدید، گسترش endpointهای محصول/Shipping Class/Shipping Method موجود، و رفع یک باگ از قبل موجود (پایین توضیح داده شده).
- `public/admin/admin-common.js` — افزودن سیستم راهنمای ⓘ (`initHelpTooltips`)، افزودن آیتم «Packaging Profiles» به زیرمنوی ارسال.
- `public/admin/admin-common.css` — استایل‌های `.help-icon` / `.help-popover` / `.packaging-estimation-box`.
- `public/admin/products/index.html` و `products.js` — افزودن UI کامل Packaging Profile/Override + راهنمای ⓘ روی فیلدهای موجود و جدید.
- `public/admin/shipping/index.html` و `shipping.js` — افزودن فیلد «ضریب وزن حجمی» به هر روش ارسال.
- `public/admin/shipping/classes/index.html` و `classes.js` — افزودن انتخاب «Packaging Profile پیش‌فرض» برای هر Shipping Class.
- `public/admin/orders/orders.js` — افزودن ثبت «هزینه واقعی حمل» + نمایش اختلاف با تخمین در جزئیات سفارش.

## ۲. فایل‌های جدید

- `database/packaging-estimation.sql` — Migration کامل (پایین توضیح داده شده).
- `src/packaging-estimation.js` — ماژول مستقل محاسبات تخمین بسته‌بندی.
- `public/admin/shipping/packaging/index.html` و `packaging.js` — صفحه جدید مدیریت Packaging Profiles.
- `test/packaging-estimation.test.mjs` — تست‌های واقعی اجراشده (۲۴ تست، همگی موفق).
- `packaging-estimation-report.md` — همین گزارش.

## ۳. تغییرات دیتابیس / ۴. Migration لازم

فایل `database/packaging-estimation.sql` (فقط همین یک فایل جدید باید اجرا شود؛ Migrationهای قبلی پروژه دست‌نخورده و دوباره اجرا نمی‌شوند):

- جدول جدید `packaging_profiles` (+ ۵ ردیف نمونه Seed‌شده: GENERIC، SMALL_PART، FACTORY_PACKAGED، BULKY، FRAGILE).
- `shipping_classes.default_packaging_profile_id` (ستون جدید، Nullable).
- `products.packaging_profile_id` / `package_length_cm` / `package_width_cm` / `package_height_cm` / `package_weight_grams` / `packaging_confidence` (۶ ستون جدید، همه Nullable).
- `shipping_methods.volumetric_divisor` (ستون جدید، Nullable).
- `orders.actual_shipping_cost` / `shipping_cost_variance` / `shipping_cost_recorded_at` (۳ ستون جدید، همه Nullable).

همه ستون‌ها Nullable/Default‌دار هستند — محصولات/سفارش‌های قبلی بدون این اطلاعات دقیقاً مثل قبل کار می‌کنند.

## ۵. APIهای جدید

- `GET/POST/PUT/DELETE /api/store/admin/packaging-profiles`
- `GET /api/store/admin/packaging-preview?product_ids=&quantities=&method_id=` (ابزار پیش‌نمایش/دیباگ برای مدیر)
- `PUT /api/store/admin/orders/actual-shipping-cost`
- `GET /api/store/admin/shipping-cost-variance-report`

## ۶. توابع جدید

همه در `src/packaging-estimation.js`، عمداً خالص و مستقل از D1 (به‌جز بخش پایانی فایل):
`estimateProductPackage`, `computeVolumetricWeightGrams`, `computeChargeableWeightGrams`, `buildShipmentPackages`, `chargeableWeightForDivisor`, `resolveEffectiveProfile`, `loadPackagingProfiles`, `buildCartShipmentPackages`.

## ۷. نحوه انتخاب Packaging Profile (اتوماسیون)

اولویت (در `resolveEffectiveProfile`):
1. `product.packaging_profile_id` (Override دستی مدیر روی همان محصول)
2. `shipping_classes.default_packaging_profile_id` (بر اساس Shipping Classی که محصول از قبل دارد — بدون نیاز به انتخاب دستی جدید)
3. Profile عمومی سیستم (`is_default = 1` در `packaging_profiles`)
4. `BUILTIN_FALLBACK_PROFILE` (ثابت داخل کد) — فقط اگر جدول `packaging_profiles` اصلاً وجود نداشته باشد (Migration اجرا نشده)

## ۸. فرمول و منطق تخمین بسته‌بندی

برای هر محصول (`estimateProductPackage`):
1. اگر هر ۴ فیلد Override (`package_length_cm/width_cm/height_cm/weight_grams`) پر باشند → همان مقادیر مستقیم استفاده می‌شود (`source: REAL` یا مقدار `packaging_confidence`).
2. وگرنه اگر وزن و هر سه بُعد واقعی محصول موجود باشد:
   - `packageDim = max(realDim + profile.tolerance, profile.minDim)`
   - `packageWeight = max(round(realWeight + tolerance_grams + realWeight × tolerance_percent/100), profile.min_shipping_weight_grams)`
   - `source: ESTIMATED`
3. وگرنه (داده ناقص) → از حداقل ابعاد/وزن Profile استفاده می‌شود، هرگز صفر (`source: CONSERVATIVE`, `incomplete: true`).

## ۹. منطق وزن حجمی

`computeVolumetricWeightGrams(L, W, H, divisor) = round((L×W×H / divisor) × 1000)` گرم.
`divisor` از `shipping_methods.volumetric_divisor` همان روش ارسال خوانده می‌شود (پیش‌فرض کد: `DEFAULT_VOLUMETRIC_DIVISOR = 5000` فقط وقتی مدیر عددی تنظیم نکرده).
`Chargeable Weight = max(actual/estimated weight, volumetric weight)` — این محاسبه *به‌ازای هر بسته* انجام می‌شود، نه یک‌بار برای کل سبد، تا بسته‌های Separate وزن حجمی بسته‌های دیگر را «قرض» نگیرند.

## ۱۰. منطق سفارش چندقلمی

`buildShipmentPackages`: اقلامی که Profile‌شان `allow_combine_with_other_items=1` و `require_separate_shipment=0` دارد در یک بسته «combined» جمع می‌شوند (وزن‌ها و حجم‌ها جمع زده می‌شوند). بقیه هرکدام بسته «separate» مستقل خودشان را می‌گیرند. معماری برای جایگزینی این جمع ساده با یک الگوریتم Packing دقیق‌تر در آینده، بدون تغییر در ورودی/خروجی تابع، آماده است.

## ۱۱. منطق Override

توضیح داده‌شده در بخش ۸ بالا — اولویت مطلق با مقادیر واقعی محصول است، نه تخمین.

## ۱۲. منطق ثبت اختلاف هزینه

`PUT /api/store/admin/orders/actual-shipping-cost` مقدار `variance = actual - orders.shipping_cost` را محاسبه و ذخیره می‌کند. این مقدار هرگز `payable_amount` مشتری را تغییر نمی‌دهد (طبق تذکر صریح دستور: اختلاف از سود فروشگاه جذب می‌شود). گزارش `shipping-cost-variance-report` فقط سفارش‌هایی که هزینه واقعی برایشان ثبت شده را جمع می‌زند (طبق تذکر بخش ۱۷: «ابتدا داده واقعی جمع شود»).

## ۱۳. سیستم Help/ⓘ

`initHelpTooltips()` در `admin-common.js` — یک Component واحد و قابل‌استفاده مجدد؛ روی هر عنصر `<span class="help-icon" data-help="...">ⓘ</span>` کار می‌کند، مبتنی بر Click/Tap (نه Hover)، روی موبایل و دسکتاپ یکسان کار می‌کند. `initAdminPage()` آن را خودکار صدا می‌زند؛ محتوای پویا (مثل مودال جزئیات سفارش) با `initHelpTooltips(container)` دوباره صدایش می‌زند. در فرم محصول و صفحه Packaging Profiles به‌طور گسترده استفاده شده؛ روی چند فیلد قبلی هم (نام، Slug، قیمت، موجودی، معرفی، مشخصات فنی) اضافه شده تا طبق بخش ۱۹ دستور، فقط مخصوص فیلدهای جدید نباشد.

## ۱۴. تست‌های انجام‌شده / ۱۵. نتیجه تست‌ها

`test/packaging-estimation.test.mjs` — اجرای واقعی (نه شبیه‌سازی):
- بخش ۱: اجرای واقعی `packaging-estimation.sql` روی schema synthetic معادل جداول واقعی پروژه (`node:sqlite`)، بررسی Seed شدن ۵ Profile، بررسی وجود همه ستون‌های جدید.
- بخش ۲: ۱۸ سناریوی بخش ۲۸ دستور + ۲ تست کمکی، مستقیماً روی توابع خالص.

**نتیجه: ۲۴ تست، ۲۴ موفق، ۰ ناموفق.**

اجرا:
```
node --experimental-sqlite test/packaging-estimation.test.mjs
```

محدودیت صادقانه: تست end-to-end واقعی مسیرهای `checkout` و `shipping-methods` (که به Cloudflare Workers/D1 واقعی نیاز دارند) در این Sandbox (بدون دسترسی اینترنت/Wrangler) ممکن نبود؛ به‌جای آن، هر فراخوانی جدید به لایه تخمین بسته‌بندی داخل `resolveShippingOptionsForCart` با `try/catch` محافظت شده تا در نبود Migration یا داده ناقص، دقیقاً به رفتار قبلی (جمع وزن خام) سقوط کند — این را می‌توان در دیف کد مستقیماً بررسی کرد.

## ۱۶. مواردی که هنوز نیاز به تصمیم یا اطلاعات واقعی دارند

- اعداد تلرانس/حداقل ابعاد ۵ Profile Seed‌شده صرفاً نقطه شروع منطقی هستند (طبق تذکر صریح بخش ۷ دستور) — بعد از چند سفارش واقعی و ثبت هزینه واقعی حمل، از `shipping-cost-variance-report` برای تنظیم دقیق‌ترشان استفاده کنید.
- ضریب وزن حجمی واقعی هر سرویس حمل (پست/تیپاکس/باربری و...) باید توسط مدیر در صفحه «روش‌های ارسال» وارد شود؛ فعلاً همه روی پیش‌فرض کد (۵۰۰۰) هستند.
- Packaging Group و سطح محافظت فعلاً فقط برچسب داخلی‌اند؛ گزارش‌گیری اختصاصی بر اساس آن‌ها ساخته نشده (طبق اصل کمترین پیچیدگی، بخش ۲۴).
- نمایش نشانگر اختلاف هزینه در لیست سفارش‌ها (نه فقط جزئیات) ساخته نشده — در صورت نیاز، افزودنی ساده روی همان داده موجود در `admin/summary` یا لیست سفارش‌هاست.
- ارسال فیزیکی چندبسته‌ای (چند مرسوله واقعی برای یک سفارش) خارج از محدوده این مرحله است؛ معماری Packages آماده توسعه آینده است اما مدل سفارش فعلی هنوز فقط یک `shipping_cost`/یک مرسوله را پشتیبانی می‌کند (دقیقاً طبق بخش ۲۶ دستور: بدون بازطراحی ناخواسته سفارش).

## ۱۷. دستور دقیق Deploy

```bash
# ۱) اجرای Migration جدید روی D1 واقعی (remote) — قبل از Deploy کد
npx wrangler d1 execute tasisatapadana-db --remote --file=./database/packaging-estimation.sql

# ۲) Deploy کد
npx wrangler deploy
```

## ۱۸. دستور دقیق اجرای Migration

همان دستور بند ۱۷ (مرحله ۱). Migrationهای قبلی (۱۵ فایل موجود در `database/`) نباید دوباره اجرا شوند — طبق تأیید قبلی شما که آن‌ها از قبل روی D1 زنده اجرا شده‌اند.

## ۱۹. هر کاری که مدیر سایت پس از Deploy باید انجام دهد

1. اجرای Migration بالا.
2. سری به `/admin/shipping/packaging/` بزنید و Profileهای پیش‌فرض را مرور کنید؛ در صورت نیاز ویرایش کنید.
3. برای هر Shipping Class موجود (`/admin/shipping/classes/`)، یک Packaging Profile پیش‌فرض مناسب انتخاب کنید (اختیاری، ولی توصیه می‌شود).
4. برای هر روش ارسال (`/admin/shipping/`)، اگر ضریب وزن حجمی واقعی همان سرویس را می‌دانید، در فیلد جدید وارد کنید.
5. برای محصولاتی که ابعاد/وزن بسته‌بندی واقعی‌شان را از قبل می‌دانید، در فرم محصول → «تخمین بسته‌بندی و ارسال» → دکمه Override را بزنید و مقادیر واقعی را ثبت کنید (کاملاً اختیاری).
6. بعد از رسیدن فاکتور واقعی حمل هر سفارش، از جزئیات همان سفارش در `/admin/orders/` مبلغ واقعی را ثبت کنید تا گزارش اختلاف هزینه معنادار شود.

## یک یافته جانبی (رفع شد، خارج از دامنه اصلی درخواست ولی لازم برای کارکرد صحیح)

Endpoint فهرست محصولات پنل مدیریت (`GET /api/store/admin/products`) هرگز ستون‌های `shipping_class_id`/`weight_grams`/`length_cm`/`width_cm`/`height_cm` را برنمی‌گرداند، در حالی که فرم ویرایش محصول از قبل این فیلدها را نمایش می‌داد — یعنی این فیلدها همیشه هنگام ویرایش خالی دیده می‌شدند (قبل از هر تغییری در این مرحله). چون بدون این داده‌ها، صفحه مدیریت اصلاً نمی‌توانست به مدیر نشان دهد چه Shipping Class/وزن/ابعادی روی هر محصول تنظیم شده، این SELECT را (همراه با ستون‌های جدید Packaging) گسترش دادم. تغییر کاملاً افزایشی است (فقط افزودن ستون به یک SELECT موجود) و ریسکی برای رفتار فعلی ندارد.
