async function handleStoreApi(request, env) {
  const url = new URL(request.url);

  function isAdmin(request, env) {
    const token = request.headers.get("X-Admin-Token");
    return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
  }

  if (url.pathname === "/api/store/health") {
    return Response.json({
      ok: true,
      service: "tasisat-apadana-store",
      version: "1.2.0",
      database: !!env.DB,
    });
  }

  if (url.pathname === "/api/store/admin-test") {
    if (!isAdmin(request, env)) {
      return Response.json(
        {
          ok: false,
          error: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    return Response.json({
      ok: true,
      admin: true,
      message: "Admin authentication is working.",
    });
  }

  if (
    url.pathname === "/api/store/products" &&
    request.method === "GET"
  ) {
    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock, active " +
          "FROM products " +
          "WHERE active = 1 " +
          "ORDER BY id DESC"
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

  if (
    url.pathname === "/api/store/products" &&
    request.method === "POST"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        {
          ok: false,
          error: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    try {
      const body = await request.json();

      const name = String(body.name || "").trim();
      const slug = String(body.slug || "").trim();
      const description = String(body.description || "").trim();
      const image = String(body.image || "").trim();
      const price = Number(body.price);
      const stock = Number(body.stock);
      const active = body.active === false ? 0 : 1;

      if (!name || !slug) {
        return Response.json(
          {
            ok: false,
            error: "INVALID_DATA",
            message: "نام محصول و شناسه محصول الزامی است.",
          },
          { status: 400 }
        );
      }

      if (
        !Number.isInteger(price) ||
        price < 0 ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        return Response.json(
          {
            ok: false,
            error: "INVALID_DATA",
            message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند.",
          },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "INSERT INTO products " +
          "(name, slug, description, price, image, stock, active) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          name,
          slug,
          description,
          price,
          image,
          stock,
          active
        )
        .run();

      return Response.json(
        {
          ok: true,
          message: "محصول با موفقیت ثبت شد.",
          product_id: result.meta?.last_row_id ?? null,
        },
        { status: 201 }
      );
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

  if (
    url.pathname === "/api/store/products" &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        {
          ok: false,
          error: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    try {
      const body = await request.json();

      const id = Number(body.id);
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const image = String(body.image || "").trim();
      const price = Number(body.price);
      const stock = Number(body.stock);
      const active = body.active === false ? 0 : 1;

      if (!Number.isInteger(id) || id <= 0 || !name) {
        return Response.json(
          {
            ok: false,
            error: "INVALID_DATA",
            message: "شناسه و نام محصول الزامی است.",
          },
          { status: 400 }
        );
      }

      if (
        !Number.isInteger(price) ||
        price < 0 ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        return Response.json(
          {
            ok: false,
            error: "INVALID_DATA",
            message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند.",
          },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE products SET " +
          "name = ?, description = ?, price = ?, image = ?, stock = ?, active = ? " +
          "WHERE id = ?"
        )
        .bind(
          name,
          description,
          price,
          image,
          stock,
          active,
          id
        )
        .run();

      if (!result.meta?.changes) {
        return Response.json(
          {
            ok: false,
            error: "PRODUCT_NOT_FOUND",
            message: "محصول موردنظر پیدا نشد.",
          },
          { status: 404 }
        );
      }

      return Response.json({
        ok: true,
        message: "محصول با موفقیت ویرایش شد.",
        product_id: id,
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

  if (url.pathname.startsWith("/api/store/products/")) {
    const slug = url.pathname.split("/").pop();

    if (request.method !== "GET") {
      return Response.json(
        {
          ok: false,
          error: "METHOD_NOT_ALLOWED",
        },
        { status: 405 }
      );
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock " +
          "FROM products " +
          "WHERE slug = ? AND active = 1 " +
          "LIMIT 1"
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

    if (url.pathname.startsWith("/api/store/")) {
      return handleStoreApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
