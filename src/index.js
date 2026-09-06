/**
 * Worker اصلی سایت تأسیسات آپادانا
 *
 * مسئولیت‌ها:
 * 1) سرو فایل‌های استاتیک از public
 * 2) API فروشگاه با استفاده از D1
 */

async function handleStoreApi(request, env) {
  const url = new URL(request.url);

  // API health check
  if (url.pathname === "/api/store/health") {
    return Response.json({
      ok: true,
      service: "tasisat-apadana-store",
      version: "1.1.0",
      database: !!env.DB,
    });
  }

  // API products - دریافت محصولات فعال از D1
  if (url.pathname === "/api/store/products") {
    try {
      const result = await env.DB
        .prepare(
          SELECT id, name, slug, description, price, image, stock
           FROM products
           WHERE active = 1
           ORDER BY id DESC
        )
        .all();

      return Response.json({
        ok: true,
        products: result.results || [],
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "DATABASE_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }
  }

  // API single product
  if (url.pathname.startsWith("/api/store/products/")) {
    const slug = url.pathname.split("/").pop();

    try {
      const result = await env.DB
        .prepare(
          SELECT id, name, slug, description, price, image, stock
           FROM products
           WHERE slug = ? AND active = 1
           LIMIT 1
        )
        .bind(slug)
        .first();

      if (!result) {
        return Response.json(
          {
            ok: false,
            error: "PRODUCT_NOT_FOUND",
          },
          { status: 404 }
        );
      }

      return Response.json({
        ok: true,
        product: result,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "DATABASE_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }
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
     * فایل‌های public توسط Cloudflare Assets سرو می‌شوند.
     */
    return env.ASSETS.fetch(request);
  },
};
