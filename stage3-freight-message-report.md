# گزارش مرحله ۳ — اصلاح ۱: پیام Freight (اصلاح ۲: متوقف‌شده، منتظر تصمیم)

منبع حقیقت: فقط `tasisatapadana-site-stage2-routing.zip`.

## اصلاح ۱ — پیام مشتری برای Route="freight" (انجام و تست شد)

### فایل‌های تغییرکرده
1. `src/shipping-routing.js` — فقط مقدار `CUSTOMER_MESSAGES.freight` (تنها منبع پیام Freight که به `buildFreightOption().customer_message` می‌رسد و در صفحه محصول، سبد و Checkout نمایش داده می‌شود).
   - قبل: «این سفارش با باربری ارسال می‌شود و هزینهٔ حمل (پس‌کرایه) … حداکثر تا ۳ روز …»
   - بعد (دقیقاً): «این محصول به دلیل ابعاد یا وزن، توسط باربری و به‌صورت پس‌کرایه ارسال می‌شود.»
2. `public/store/checkout.html` — فقط یک Guard در شاخهٔ «فهرست روش‌ها خالی»: اگر `data.route === "freight"` باشد، متن مصوب باربری نشان داده می‌شود، نه «برای این مقصد روش ارسالی در دسترس نیست…».
3. `test/shipping-freight-message.test.mjs` — فایل تست جدید.

### یافتهٔ مهم دربارهٔ منشأ پیام قدیمی
در کد این ZIP، هیچ مسیری برای Route="freight" متن «روش ارسالی در دسترس نیست…» را تولید نمی‌کند: مسیر Freight همیشه یک گزینه با `customer_message` برمی‌گرداند و `unavailable=null` است. آن متن فقط Fallback سمت مرورگر در `checkout.html` است، وقتی فهرست روش‌ها خالی و `unavailable.message` وجود نداشته باشد. اگر در سایت زنده همچنان این پیام را برای کالای باربری می‌بینید، محتمل‌ترین علت این است که سبد اصلاً Route=freight تشخیص داده نمی‌شود (مثلاً Migration `database/shipping-routing.sql` هنوز روی D1 زنده اجرا نشده یا Shipping Class/Override محصول تنظیم نشده). این را از ZIP نمی‌توان اثبات کرد.

### نکتهٔ رفتاری
جملهٔ «حداکثر ۳ روز» دیگر در متن Freight نیست (چون متن باید «دقیقاً» همین باشد). فیلد `max_dispatch_days=3` همچنان در گزینه برمی‌گردد و در سفارش ذخیره می‌شود. متن مسیر عادی و پیک اصفهان بدون تغییر ماند.

### عمداً تغییر نکرد
عنوان «باربری (پس‌کرایه)»، `cost=0`، `cost_known=false`، `payment_mode=receiver_pays`، `cost_type=cod`، منطق تشخیص غیرعادی، Tapin، موتور داخلی، تعرفه‌ها، Routeها، Migrationها، Checkout (به‌جز Guard بالا)، Proxy/VPS.

## تست‌ها (اجرای واقعی؛ Worker واقعی + D1 با node:sqlite + Proxy موک‌شده)
- تست جدید: ۶/۶ موفق. روی کد قبلی (ZIP اصلی) ۴ مورد از ۶ رد می‌شد (چک متن دقیق/منبع).
- Regression ارسال: routing ۲۳/۲۳، shared-quote ۲۱/۲۱، calculation-mode ۹/۹، preview-mode-override ۸/۸، quote-history ۴/۴، audit-diagnostics ۱۰/۱۰، tariff-import ۴/۴، tapin-proxy ۳۰/۳۰، packaging-estimation ۲۵/۲۵ — همه سبز. `node --check` سالم.
- تست زنده با Tapin انجام نشد (Sandbox شبکه ندارد).

## اصلاح ۲ — انتخاب شهر (هیچ تغییری اعمال نشد)
یافته‌ها و سؤال تصمیم در پیام نهایی گفتگو آمده است.
