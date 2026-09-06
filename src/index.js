/**
 * Worker اصلی سایت تأسیسات آپادانا
 *
 * مسئولیت‌ها:
 * 1) سرو فایل‌های استاتیک از public
 * 2) آماده‌سازی مسیرهای API فروشگاه
 *
 * نکته:
 * اتصال واقعی به D1 و درگاه پرداخت در مراحل بعدی اضافه می‌شود.
 */

async function handleStoreApi(request, env) {
  const url = new URL(request.url);

  // API health check
  if (url.pathname === "/api/store/health") {
    return Response.json({
      ok: true,
      service: "tasisat-apadana-store",
      version: "1.0.0",
    });
  }

  // API products
  if (url.pathname === "/api/store/products") {
    return Response.json({
      ok: true,
      products: [],
      message: "Product database is not connected yet.",
    });
  }

  // API single product
  if (url.pathname.startsWith("/api/store/products/")) {
    return Response.json(
      {
        ok: false,
        error: "PRODUCT_NOT_FOUND",
        message: "Product database is not connected yet.",
      },
      { status: 404 }
    );
  }

  // API cart / checkout
  if (
    url.pathname === "/api/store/cart" ||
    url.pathname === "/api/store/checkout"
  ) {
    return Response.json({
      ok: true,
      status: "ready",
      message: "Checkout infrastructure is prepared.",
    });
  }

  return Response.json(
    {
      ok: false,
      error: "API_NOT_FOUND",
    },
    { status: 404 }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /*
     * تمام درخواست‌های API فروشگاه
     * قبل از سرو فایل‌های سایت بررسی می‌شوند.
     */
    if (url.pathname.startsWith("/api/store/")) {
      return handleStoreApi(request, env);
    }

    /*
     * سایر درخواست‌ها:
     * همان رفتار Worker قبلی حفظ می‌شود و فایل‌های public
     * توسط Cloudflare Assets سرو می‌شوند.
     */
    return env.ASSETS.fetch(request);
  },
};
