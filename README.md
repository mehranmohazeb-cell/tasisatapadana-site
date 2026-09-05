# تأسیسات آپادانا — راهنمای اجرا

مسیرهای فایل‌ها در `index.html` به‌صورت مطلق نوشته شده‌اند (`/style.css`, `/script.js`, ...).
این مسیرها فقط داخل یک **وب‌سرور واقعی** درست کار می‌کنند، نه با باز کردن مستقیم فایل (`file://`) روی گوشی یا کامپیوتر.
برای تست، یکی از دو روش زیر را استفاده کن.

---

## روش ۱ — پیش‌نمایش سریع (بدون نیاز به Cloudflare)

نیاز: Python (روی اکثر کامپیوترها از قبل نصب است) یا Node.js

```bash
cd tasisat-apadana/public
python3 -m http.server 8000
```

سپس در مرورگر باز کن: `http://localhost:8000`

اگر Python نداری و Node.js داری:

```bash
cd tasisat-apadana/public
npx serve .
```

> نکته: باید داخل پوشه `public` این دستور را اجرا کنی، نه داخل پوشه اصلی پروژه.

---

## روش ۲ — پیش‌نمایش با خود Cloudflare Workers (دقیقاً مثل حالت واقعی)

نیاز: Node.js نسخه ۱۸ به بالا

```bash
cd tasisat-apadana
npx wrangler dev
```

آدرسی که در ترمینال نمایش داده می‌شود (معمولاً `http://localhost:8787`) را باز کن.
این حالت دقیقاً همان محیطی است که بعد از Deploy روی Cloudflare خواهی داشت.

---

## دیپلوی نهایی روی Cloudflare

```bash
cd tasisat-apadana
npx wrangler login
npx wrangler deploy
```

بعد از دیپلوی موفق، از داشبورد Cloudflare دامنه `tasisatapadanaesfahan.ir` را به این Worker متصل کن
(Workers & Pages → پروژه → Custom Domains → افزودن دامنه).

---

## قبل از دیپلوی نهایی فراموش نکن

در فایل `public/script.js` مقدار زیر را با شماره واقعی جایگزین کن:

```js
const CONTACT_CONFIG = {
  phone: "شماره تلفن واقعی",
  whatsapp: "شماره واتساپ به فرمت بین‌المللی بدون + و بدون صفر ابتدایی",
};
```
