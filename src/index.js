/**
 * Worker اصلی سایت تأسیسات آپادانا
 *
 * فعلاً کار این Worker فقط سرو فایل‌های استاتیک داخل پوشه public است
 * (index.html, style.css, script.js, assets/...).
 *
 * در آینده اگر نیاز به API شد (مثلاً فرم درخواست تعمیرکار یا ثبت درخواست مشتری)،
 * می‌توانید قبل از خط "return env.ASSETS.fetch(request)" مسیرهای API خودتان
 * را با بررسی url.pathname اضافه کنید، مثال:
 *
 *   const url = new URL(request.url);
 *   if (url.pathname.startsWith('/api/')) {
 *     return handleApi(request, env);
 *   }
 */
export default {
  async fetch(request, env, ctx) {
    return env.ASSETS.fetch(request);
  },
};
