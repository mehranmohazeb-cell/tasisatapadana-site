async function handleStoreApi(request, env) {
const url = new URL(request.url);

function isAdmin(request, env) {
const token = request.headers.get("X-Admin-Token");
return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

async function getProductImages(productId) {
const result = await env.DB
.prepare(
"SELECT id, image, sort_order " +
"FROM product_images " +
"WHERE product_id = ? " +
"ORDER BY sort_order ASC, id ASC"
)
.bind(productId)
.all();

return result.results || [];

}

if (url.pathname === "/api/store/health") {
return Response.json({
ok: true,
service: "tasisat-apadana-store",
version: "1.5.0",
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

  const products = result.results || [];

  for (const product of products) {
    product.images = await getProductImages(product.id);

    if (product.images.length === 0 && product.image) {
      product.images = [
        {
          id: null,
          image: product.image,
          sort_order: 0,
        },
      ];
    }
  }

  return Response.json({
    ok: true,
    products,
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

  const productId = result.meta?.last_row_id ?? null;

  const images = Array.isArray(body.images)
    ? body.images
    : [];

  for (let i = 0; i < images.length; i++) {
    const imagePath = String(images[i] || "").trim();

    if (!imagePath) continue;

    await env.DB
      .prepare(
        "INSERT INTO product_images " +
        "(product_id, image, sort_order) " +
        "VALUES (?, ?, ?)"
      )
      .bind(productId, imagePath, i)
      .run();
  }

  return Response.json(
    {
      ok: true,
      message: "محصول با موفقیت ثبت شد.",
      product_id: productId,
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

  if (Array.isArray(body.images)) {
    await env.DB
      .prepare(
        "DELETE FROM product_images WHERE product_id = ?"
      )
      .bind(id)
      .run();

    for (let i = 0; i < body.images.length; i++) {
      const imagePath = String(body.images[i] || "").trim();

      if (!imagePath) continue;

      await env.DB
        .prepare(
          "INSERT INTO product_images " +
          "(product_id, image, sort_order) " +
          "VALUES (?, ?, ?)"
        )
        .bind(id, imagePath, i)
        .run();
    }
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
const slug = decodeURIComponent(url.pathname.split("/").pop());

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

  const images = await getProductImages(result.id);

  if (images.length === 0 && result.image) {
    result.images = [
      {
        id: null,
        image: result.image,
        sort_order: 0,
      },
    ];
  } else {
    result.images = images;
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

/*

* ثبت سفارش

* مسیر: POST /api/orders
  */
  if (
  url.pathname === "/api/orders" &&
  request.method === "POST"
  ) {
  try {
  const body = await request.json();
 
  const customer = body.customer || {};
  const items = Array.isArray(body.items)
  ? body.items
  : [];
 
  const customerName = String(customer.name || "").trim();
  const customerPhone = String(customer.phone || "").trim();
  const customerAddress = String(customer.address || "").trim();
 
  if (
  !customerName ||
  !customerPhone ||
  !customerAddress
  ) {
  return Response.json(
  {
  ok: false,
  error: "INVALID_CUSTOMER_DATA",
  message: "نام، شماره تماس و آدرس الزامی است.",
  },
  { status: 400 }
  );
  }
 
  if (items.length === 0) {
  return Response.json(
  {
  ok: false,
  error: "EMPTY_CART",
  message: "سبد خرید خالی است.",
  },
  { status: 400 }
  );
  }
 
  /*
 
  * اطلاعات واقعی کالاها از D1 خوانده می‌شود.
  * قیمت ارسال‌شده از مرورگر قابل اعتماد نیست.
    */
    const verifiedItems = [];
    let total = 0;
 
  for (const item of items) {
  const productId = Number(item.id);
  const quantity = Number(item.quantity);
 
  if (
  !Number.isInteger(productId) ||
  productId <= 0 ||
  !Number.isInteger(quantity) ||
  quantity <= 0
  ) {
  return Response.json(
  {
  ok: false,
  error: "INVALID_ITEM",
  message: "اطلاعات یکی از کالاهای سفارش نامعتبر است.",
  },
  { status: 400 }
  );
  }
 
  const product = await env.DB
  .prepare(
  "SELECT id, name, price, stock, active " +
  "FROM products " +
  "WHERE id = ? " +
  "LIMIT 1"
  )
  .bind(productId)
  .first();
 
  if (!product || Number(product.active) !== 1) {
  return Response.json(
  {
  ok: false,
  error: "PRODUCT_NOT_AVAILABLE",
  message: "یکی از کالاهای سفارش دیگر قابل سفارش نیست.",
  },
  { status: 400 }
  );
  }
 
  if (Number(product.stock) < quantity) {
  return Response.json(
  {
  ok: false,
  error: "INSUFFICIENT_STOCK",
  message: "موجودی «${product.name}» برای تعداد درخواستی کافی نیست.",
  },
  { status: 400 }
  );
  }
 
  const price = Number(product.price) || 0;
  const itemTotal = price * quantity;
 
  total += itemTotal;
 
  verifiedItems.push({
  productId: Number(product.id),
  productName: product.name,
  price,
  quantity,
  });
  }
 
  /*
 
  * ابتدا سفارش اصلی ثبت می‌شود.
    */
    const orderResult = await env.DB
    .prepare(
    "INSERT INTO orders " +
    "(customer_name, customer_phone, customer_address, total, status) " +
    "VALUES (?, ?, ?, ?, ?)"
    )
    .bind(
    customerName,
    customerPhone,
    customerAddress,
    total,
    "pending"
    )
    .run();
 
  const orderId = orderResult.meta?.last_row_id ?? null;
 
  if (!orderId) {
  throw new Error("ORDER_ID_NOT_CREATED");
  }
 
  /*
 
  * سپس کالاهای سفارش ذخیره می‌شوند
  * و موجودی هر کالا کاهش پیدا می‌کند.
    */
    for (const item of verifiedItems) {
    await env.DB
    .prepare(
    "INSERT INTO order_items " +
    "(order_id, product_id, product_name, price, quantity) " +
    "VALUES (?, ?, ?, ?, ?)"
    )
    .bind(
    orderId,
    item.productId,
    item.productName,
    item.price,
    item.quantity
    )
    .run();
 
  await env.DB
  .prepare(
  "UPDATE products " +
  "SET stock = stock - ? " +
  "WHERE id = ? AND stock >= ?"
  )
  .bind(
  item.quantity,
  item.productId,
  item.quantity
  )
  .run();
  }
 
  return Response.json(
  {
  ok: true,
  message: "سفارش با موفقیت ثبت شد.",
  order_id: orderId,
  total,
  status: "pending",
  },
  { status: 201 }
  );
  } catch (error) {
  return Response.json(
  {
  ok: false,
  error: "ORDER_CREATE_ERROR",
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

if (
  url.pathname.startsWith("/api/store/") ||
  url.pathname === "/api/orders"
) {
  return handleStoreApi(request, env);
}

return env.ASSETS.fetch(request);

},
}; 
