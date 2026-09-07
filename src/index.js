/**

* Worker اصلی سایت تأسیسات آپادانا
* 
* مسئولیت‌ها:
* 1) سرو فایل‌های استاتیک از public
* 2) API فروشگاه با استفاده از D1
* 3) احراز هویت پنل مدیریت
     */

function isAdmin(request, env) {
const token = request.headers.get("X-Admin-Token");
return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

async function handleStoreApi(request, env) {
const url = new URL(request.url);

if (url.pathname === "/api/store/health") {
return Response.json({
ok: true,
service: "tasisat-apadana-store",
version: "1.1.0",
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

/*

* افزودن محصول جدید
* فقط برای مدیر
  */
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
  const active = body.active ? 1 : 0;

  if (!name || !slug) {
    return Response.json(
      {
        ok: false,
        error: "INVALID_INPUT",
        message: "نام محصول و slug الزامی است.",
      },
      { status: 400 }
    );
  }

  if (
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(price)
  ) {
    return Response.json(
      {
        ok: false,
        error: "INVALID_PRICE",
        message: "قیمت نامعتبر است.",
      },
      { status: 400 }
    );
  }

  if (
    !Number.isFinite(stock) ||
    stock < 0 ||
    !Number.isInteger(stock)
  ) {
    return Response.json(
      {
        ok: false,
        error: "INVALID_STOCK",
        message: "موجودی نامعتبر است.",
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
      message: "محصول با موفقیت ایجاد شد.",
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

if (url.pathname === "/api/store/products") {
try {
const result = await env.DB
.prepare(
"SELECT id, name, slug, description, price, image, stock " +
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

if (url.pathname.startsWith("/api/store/products/")) {
const slug = url.pathname.split("/").pop();

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
