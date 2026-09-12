// =========================================================================
// تأسیسات آپادانا — Worker API
// شامل: محصولات، سفارش واقعی (Checkout)، پیگیری مهمان، حساب مشتری، پنل مدیریت
// =========================================================================

const STATUS_LABELS = {
  pending: "در حال بررسی",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال شده",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
};

const ALLOWED_STATUSES = Object.keys(STATUS_LABELS);

const PAYMENT_STATUS_LABELS = {
  unpaid: "پرداخت‌نشده",
  paid: "پرداخت‌شده",
  failed: "پرداخت ناموفق",
  refunded: "بازگشت وجه",
};

const ALLOWED_PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS);

const TICKET_STATUS_LABELS = {
  received: "ثبت شده",
  in_review: "در حال بررسی",
  answered: "پاسخ داده شد",
  closed: "بسته شد",
};

const ALLOWED_TICKET_STATUSES = Object.keys(TICKET_STATUS_LABELS);

// کد پیگیری: حروف/ارقامی که با هم اشتباه گرفته می‌شوند (0/O، 1/I/L) حذف شده‌اند.
const TRACKING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TRACKING_CODE_LENGTH = 10;

const SESSION_COOKIE_NAME = "apadana_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // ۳۰ روز

async function handleStoreApi(request, env) {
  const url = new URL(request.url);

  // =========================
  // Helpers — Auth
  // =========================

  function isAdmin(request, env) {
    const token = request.headers.get("X-Admin-Token");
    return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
  }

  // =========================
  // Helpers — Data
  // =========================

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

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeDigits(value) {
    return String(value ?? "").replace(/[۰-۹٠-٩]/g, (ch) => {
      const persian = "۰۱۲۳۴۵۶۷۸۹";
      const arabic = "٠١٢٣٤٥٦٧٨٩";
      let index = persian.indexOf(ch);
      if (index === -1) index = arabic.indexOf(ch);
      return index === -1 ? ch : String(index);
    });
  }

  function isValidMobile(value) {
    const normalized = normalizeDigits(value).trim();
    return /^09\d{9}$/.test(normalized);
  }

  function isValidPostalCode(value) {
    const normalized = normalizeDigits(value).trim();
    return /^\d{10}$/.test(normalized);
  }

  // آدرس قابل‌خواندن برای پنل مدیریت؛ برای سفارش‌های قدیمی از فیلد متنی قدیمی
  // (customer_address) و برای سفارش‌های جدید از فیلدهای ساختاریافته استفاده می‌شود.
  function composeAddressText(order) {
    if (order.province || order.city || order.street) {
      const parts = [
        order.province,
        order.city,
        order.street,
        order.sub_street,
        order.alley && `کوچه ${order.alley}`,
        order.plaque && `پلاک ${order.plaque}`,
        order.unit && `واحد ${order.unit}`,
        order.postal_code && `کد پستی ${order.postal_code}`,
        order.address_note,
      ].filter(Boolean);

      return parts.join("، ");
    }

    return order.customer_address || "";
  }

  // =========================
  // Helpers — Tracking Code
  // =========================

  function randomTrackingSuffix() {
    const bytes = new Uint8Array(TRACKING_CODE_LENGTH);
    crypto.getRandomValues(bytes);

    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      out += TRACKING_CODE_ALPHABET[bytes[i] % TRACKING_CODE_ALPHABET.length];
    }
    return out;
  }

  async function generateTrackingCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `AP-${randomTrackingSuffix()}`;

      const existing = await env.DB
        .prepare("SELECT id FROM orders WHERE tracking_code = ? LIMIT 1")
        .bind(code)
        .first();

      if (!existing) return code;
    }

    throw new Error("TRACKING_CODE_GENERATION_FAILED");
  }

  async function generateTicketTrackingCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `TK-${randomTrackingSuffix()}`;

      const existing = await env.DB
        .prepare("SELECT id FROM tickets WHERE tracking_code = ? LIMIT 1")
        .bind(code)
        .first();

      if (!existing) return code;
    }

    throw new Error("TICKET_CODE_GENERATION_FAILED");
  }

  // =========================
  // Helpers — Password Hashing (Web Crypto PBKDF2, بدون وابستگی خارجی)
  // =========================

  function toHex(buffer) {
    return [...new Uint8Array(buffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  async function hashPassword(password) {
    const iterations = 100000;
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );

    return `${toHex(salt)}:${iterations}:${toHex(derivedBits)}`;
  }

  async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== "string" || stored.indexOf(":") === -1) {
      return false;
    }

    const [saltHex, iterationsText, hashHex] = stored.split(":");
    const iterations = Number(iterationsText);
    if (!saltHex || !iterations || !hashHex) return false;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );

    const computedHex = toHex(derivedBits);

    if (computedHex.length !== hashHex.length) return false;

    // مقایسه با زمان ثابت (در برابر حملات زمان‌سنجی)
    let diff = 0;
    for (let i = 0; i < computedHex.length; i++) {
      diff |= computedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
    }
    return diff === 0;
  }

  // =========================
  // Helpers — Customer Sessions (Cookie)
  // =========================

  function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const cookies = {};

    header.split(";").forEach((part) => {
      const index = part.indexOf("=");
      if (index === -1) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
    });

    return cookies;
  }

  function isHttps(request) {
    return new URL(request.url).protocol === "https:";
  }

  function buildSessionCookie(request, token, maxAgeSeconds) {
    const attrs = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (isHttps(request)) attrs.push("Secure");
    return attrs.join("; ");
  }

  function buildClearSessionCookie(request) {
    const attrs = [
      `${SESSION_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (isHttps(request)) attrs.push("Secure");
    return attrs.join("; ");
  }

  async function createCustomerSession(customerId) {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await env.DB
      .prepare(
        "INSERT INTO customer_sessions (customer_id, token, expires_at) " +
        "VALUES (?, ?, ?)"
      )
      .bind(customerId, token, expiresAt)
      .run();

    return token;
  }

  async function getSessionCustomer(request) {
    const cookies = parseCookies(request);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;

    const row = await env.DB
      .prepare(
        "SELECT c.id AS id, c.full_name AS full_name, c.phone AS phone, " +
        "s.expires_at AS expires_at " +
        "FROM customer_sessions s " +
        "JOIN customers c ON c.id = s.customer_id " +
        "WHERE s.token = ? LIMIT 1"
      )
      .bind(token)
      .first();

    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    return { id: row.id, full_name: row.full_name, phone: row.phone, _token: token };
  }

  // =========================
  // Helpers — SMS (آماده برای اتصال بعدی؛ فعلاً فقط در صف ذخیره می‌شود)
  // =========================

  async function queueSms(orderId, phone, eventType, message) {
    try {
      await env.DB
        .prepare(
          "INSERT INTO sms_notifications (order_id, phone, event_type, message, status) " +
          "VALUES (?, ?, ?, ?, 'pending')"
        )
        .bind(orderId, phone, eventType, message)
        .run();
    } catch (error) {
      // ارسال/ذخیره پیامک هرگز نباید ثبت سفارش را مختل کند.
      console.error("queueSms failed", error);
    }
  }

  async function queueTicketSms(ticketId, phone, eventType, message) {
    try {
      await env.DB
        .prepare(
          "INSERT INTO sms_notifications (ticket_id, phone, event_type, message, status) " +
          "VALUES (?, ?, ?, ?, 'pending')"
        )
        .bind(ticketId, phone, eventType, message)
        .run();
    } catch (error) {
      console.error("queueTicketSms failed", error);
    }
  }

  async function queueEmail(orderId, ticketId, toEmail, subject, body) {
    if (!toEmail) return;

    try {
      await env.DB
        .prepare(
          "INSERT INTO email_notifications (order_id, ticket_id, to_email, subject, body, status) " +
          "VALUES (?, ?, ?, ?, ?, 'pending')"
        )
        .bind(orderId, ticketId, toEmail, subject, body)
        .run();
    } catch (error) {
      // ارسال/ذخیره ایمیل هرگز نباید ثبت تیکت یا سفارش را مختل کند.
      console.error("queueEmail failed", error);
    }
  }

  // =========================
  // Store Health
  // =========================

  if (url.pathname === "/api/store/health") {
    return Response.json({
      ok: true,
      service: "tasisat-apadana-store",
      version: "2.0.0",
      database: !!env.DB,
    });
  }

  // =========================
  // Admin Test
  // =========================

  if (url.pathname === "/api/store/admin-test") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    return Response.json({ ok: true, admin: true, message: "Admin authentication is working." });
  }

  // =========================
  // Products - Public List
  // =========================

  if (url.pathname === "/api/store/products" && request.method === "GET") {
    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock, active " +
          "FROM products WHERE active = 1 ORDER BY id DESC"
        )
        .all();

      const products = result.results || [];

      for (const product of products) {
        product.images = await getProductImages(product.id);

        if (product.images.length === 0 && product.image) {
          product.images = [{ id: null, image: product.image, sort_order: 0 }];
        }
      }

      return Response.json({ ok: true, products });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - List
  // پارامترهای اختیاری: ?status=pending  ?q=AP-XXXX یا شماره موبایل یا نام
  // =========================

  if (url.pathname === "/api/store/orders" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const statusFilter = (url.searchParams.get("status") || "").trim();
      const query = (url.searchParams.get("q") || "").trim();

      const conditions = [];
      const params = [];

      if (statusFilter) {
        conditions.push("status = ?");
        params.push(statusFilter);
      }

      if (query) {
        conditions.push(
          "(tracking_code LIKE ? OR customer_phone LIKE ? OR customer_name LIKE ?)"
        );
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const ordersResult = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
          "customer_address, province, city, street, sub_street, alley, plaque, " +
          "unit, postal_code, address_note, total, status, payment_status, " +
          "postal_carrier, postal_tracking_code, created_at, updated_at " +
          "FROM orders " +
          whereClause +
          " ORDER BY id DESC LIMIT 200"
        )
        .bind(...params)
        .all();

      const orders = ordersResult.results || [];

      for (const order of orders) {
        const itemsResult = await env.DB
          .prepare(
            "SELECT id, order_id, product_id, product_name, price, quantity, " +
            "subtotal, created_at FROM order_items WHERE order_id = ? ORDER BY id ASC"
          )
          .bind(order.id)
          .all();

        order.items = itemsResult.results || [];
        order.customer_address = composeAddressText(order);
        order.is_guest = !order.customer_id;
      }

      return Response.json({ ok: true, orders });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - Details
  // =========================

  if (
    url.pathname.startsWith("/api/store/orders/") &&
    !url.pathname.startsWith("/api/store/orders/history/") &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const orderIdText = url.pathname.split("/").pop();
      const orderId = Number(orderIdText);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json(
          { ok: false, error: "INVALID_ORDER_ID", message: "شناسه سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      const order = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
          "customer_address, province, city, street, sub_street, alley, plaque, " +
          "unit, postal_code, address_note, total, status, payment_status, " +
          "payment_reference, postal_carrier, postal_tracking_code, created_at, updated_at " +
          "FROM orders WHERE id = ? LIMIT 1"
        )
        .bind(orderId)
        .first();

      if (!order) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش پیدا نشد." },
          { status: 404 }
        );
      }

      const itemsResult = await env.DB
        .prepare(
          "SELECT id, order_id, product_id, product_name, price, quantity, " +
          "subtotal, created_at FROM order_items WHERE order_id = ? ORDER BY id ASC"
        )
        .bind(orderId)
        .all();

      const historyResult = await env.DB
        .prepare(
          "SELECT id, status, note, created_at FROM order_status_history " +
          "WHERE order_id = ? ORDER BY id ASC"
        )
        .bind(orderId)
        .all();

      order.items = itemsResult.results || [];
      order.status_history = historyResult.results || [];
      order.customer_address = composeAddressText(order);
      order.is_guest = !order.customer_id;

      return Response.json({ ok: true, order });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - Change Status / Postal Info
  // =========================

  if (
    url.pathname.startsWith("/api/store/orders/") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const orderIdText = url.pathname.split("/").pop();
      const orderId = Number(orderIdText);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json(
          { ok: false, error: "INVALID_ORDER_ID", message: "شناسه سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      const body = await request.json();
      const status = String(body.status || "").trim();
      const postalCarrier = body.postal_carrier != null ? String(body.postal_carrier).trim() : null;
      const postalTrackingCode = body.postal_tracking_code != null
        ? String(body.postal_tracking_code).trim()
        : null;
      const paymentStatus = body.payment_status != null ? String(body.payment_status).trim() : null;
      const note = body.note != null ? String(body.note).trim() : null;

      if (!ALLOWED_STATUSES.includes(status)) {
        return Response.json(
          { ok: false, error: "INVALID_STATUS", message: "وضعیت سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      if (paymentStatus && !ALLOWED_PAYMENT_STATUSES.includes(paymentStatus)) {
        return Response.json(
          { ok: false, error: "INVALID_PAYMENT_STATUS", message: "وضعیت پرداخت نامعتبر است." },
          { status: 400 }
        );
      }

      const existingOrder = await env.DB
        .prepare("SELECT id, status, customer_phone, tracking_code FROM orders WHERE id = ? LIMIT 1")
        .bind(orderId)
        .first();

      if (!existingOrder) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE orders SET status = ?, " +
          "postal_carrier = COALESCE(?, postal_carrier), " +
          "postal_tracking_code = COALESCE(?, postal_tracking_code), " +
          "payment_status = COALESCE(?, payment_status), " +
          "updated_at = ? " +
          "WHERE id = ?"
        )
        .bind(
          status,
          postalCarrier || null,
          postalTrackingCode || null,
          paymentStatus || null,
          nowIso(),
          orderId
        )
        .run();

      if (!result.meta?.changes) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      await env.DB
        .prepare(
          "INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)"
        )
        .bind(orderId, status, note || null)
        .run();

      if (status !== existingOrder.status) {
        const label = STATUS_LABELS[status] || status;
        let message = `سفارش ${existingOrder.tracking_code || orderId}: وضعیت به «${label}» تغییر کرد.`;

        if (status === "shipped" && postalTrackingCode) {
          message += ` کد مرسوله پستی: ${postalTrackingCode}`;
        }

        await queueSms(orderId, existingOrder.customer_phone, "status_changed", message);
      }

      return Response.json({
        ok: true,
        message: "وضعیت سفارش با موفقیت تغییر کرد.",
        order_id: orderId,
        status,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Products - Create
  // =========================

  if (url.pathname === "/api/store/products" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
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
          { ok: false, error: "INVALID_DATA", message: "نام محصول و شناسه محصول الزامی است." },
          { status: 400 }
        );
      }

      if (!Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "INSERT INTO products (name, slug, description, price, image, stock, active) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(name, slug, description, price, image, stock, active)
        .run();

      const productId = result.meta?.last_row_id ?? null;

      const images = Array.isArray(body.images) ? body.images : [];

      for (let i = 0; i < images.length; i++) {
        const imagePath = String(images[i] || "").trim();
        if (!imagePath) continue;

        await env.DB
          .prepare(
            "INSERT INTO product_images (product_id, image, sort_order) VALUES (?, ?, ?)"
          )
          .bind(productId, imagePath, i)
          .run();
      }

      return Response.json(
        { ok: true, message: "محصول با موفقیت ثبت شد.", product_id: productId },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Products - Update
  // =========================

  if (url.pathname === "/api/store/products" && request.method === "PUT") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
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
          { ok: false, error: "INVALID_DATA", message: "شناسه و نام محصول الزامی است." },
          { status: 400 }
        );
      }

      if (!Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE products SET name = ?, description = ?, price = ?, image = ?, stock = ?, active = ? WHERE id = ?"
        )
        .bind(name, description, price, image, stock, active, id)
        .run();

      if (!result.meta?.changes) {
        return Response.json(
          { ok: false, error: "PRODUCT_NOT_FOUND", message: "محصول موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      if (Array.isArray(body.images)) {
        await env.DB
          .prepare("DELETE FROM product_images WHERE product_id = ?")
          .bind(id)
          .run();

        for (let i = 0; i < body.images.length; i++) {
          const imagePath = String(body.images[i] || "").trim();
          if (!imagePath) continue;

          await env.DB
            .prepare(
              "INSERT INTO product_images (product_id, image, sort_order) VALUES (?, ?, ?)"
            )
            .bind(id, imagePath, i)
            .run();
        }
      }

      return Response.json({ ok: true, message: "محصول با موفقیت ویرایش شد.", product_id: id });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Product - Single
  // =========================

  if (url.pathname.startsWith("/api/store/products/")) {
    const slug = decodeURIComponent(url.pathname.split("/").pop());

    if (request.method !== "GET") {
      return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock FROM products " +
          "WHERE slug = ? AND active = 1 LIMIT 1"
        )
        .bind(slug)
        .first();

      if (!result) {
        return Response.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
      }

      const images = await getProductImages(result.id);

      result.images = images.length === 0 && result.image
        ? [{ id: null, image: result.image, sort_order: 0 }]
        : images;

      return Response.json({ ok: true, product: result });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Checkout — ثبت سفارش واقعی
  // POST /api/store/checkout
  // =========================

  if (url.pathname === "/api/store/checkout" && request.method === "POST") {
    try {
      const body = await request.json();
      const customer = body.customer || {};
      const items = Array.isArray(body.items) ? body.items : [];

      const customerName = String(customer.name || "").trim();
      const mobile = normalizeDigits(customer.mobile || customer.phone || "").trim();

      const address = {
        province: String(customer.province || "").trim(),
        city: String(customer.city || "").trim(),
        street: String(customer.street || "").trim(),
        sub_street: String(customer.sub_street || "").trim(),
        alley: String(customer.alley || "").trim(),
        plaque: String(customer.plaque || "").trim(),
        unit: String(customer.unit || "").trim(),
        postal_code: normalizeDigits(customer.postal_code || "").trim(),
        address_note: String(customer.address_note || "").trim(),
        latitude: customer.latitude != null && customer.latitude !== "" ? Number(customer.latitude) : null,
        longitude: customer.longitude != null && customer.longitude !== "" ? Number(customer.longitude) : null,
      };

      // --- اعتبارسنجی اطلاعات مشتری ---

      if (customerName.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست (مثال: 0912xxxxxxx)." },
          { status: 400 }
        );
      }

      // --- اعتبارسنجی آدرس (اجباری و کامل) ---

      const requiredAddressFields = ["province", "city", "street", "plaque"];
      for (const field of requiredAddressFields) {
        if (!address[field]) {
          return Response.json(
            {
              ok: false,
              error: "INCOMPLETE_ADDRESS",
              message: "آدرس ارسال باید کامل وارد شود.",
              field,
            },
            { status: 400 }
          );
        }
      }

      if (!isValidPostalCode(address.postal_code)) {
        return Response.json(
          { ok: false, error: "INVALID_POSTAL_CODE", message: "کد پستی باید دقیقاً ۱۰ رقم باشد." },
          { status: 400 }
        );
      }

      if (items.length === 0) {
        return Response.json(
          { ok: false, error: "EMPTY_CART", message: "سبد خرید خالی است." },
          { status: 400 }
        );
      }

      // --- ادغام اقلام تکراری و اعتبارسنجی اولیه هر قلم ---

      const mergedItems = new Map();
      for (const item of items) {
        const productId = Number(item.id ?? item.product_id);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
          return Response.json(
            { ok: false, error: "INVALID_ITEM", message: "اطلاعات یکی از کالاهای سفارش نامعتبر است." },
            { status: 400 }
          );
        }

        mergedItems.set(productId, (mergedItems.get(productId) || 0) + quantity);
      }

      // --- خواندن قیمت و موجودی واقعی از D1 (هرگز به اطلاعات مرورگر اعتماد نمی‌شود) ---

      const verifiedItems = [];
      let total = 0;

      for (const [productId, quantity] of mergedItems.entries()) {
        const product = await env.DB
          .prepare("SELECT id, name, price, stock, active FROM products WHERE id = ? LIMIT 1")
          .bind(productId)
          .first();

        if (!product || Number(product.active) !== 1) {
          return Response.json(
            { ok: false, error: "PRODUCT_NOT_AVAILABLE", message: "یکی از کالاهای سفارش دیگر قابل سفارش نیست." },
            { status: 400 }
          );
        }

        if (Number(product.stock) < quantity) {
          return Response.json(
            {
              ok: false,
              error: "INSUFFICIENT_STOCK",
              message: `موجودی «${product.name}» برای تعداد درخواستی کافی نیست.`,
            },
            { status: 409 }
          );
        }

        const price = Number(product.price) || 0;
        const subtotal = price * quantity;
        total += subtotal;

        verifiedItems.push({ productId: Number(product.id), productName: product.name, price, quantity, subtotal });
      }

      // --- کاهش اتمیک موجودی (هر UPDATE فقط وقتی موفق می‌شود که موجودی کافی باشد) ---
      // اگر یکی شکست بخورد، موجودیِ آیتم‌های قبلاً کاهش‌یافته برمی‌گردد (Rollback دستی).

      const decremented = [];
      let stockError = null;

      for (const item of verifiedItems) {
        const updateResult = await env.DB
          .prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
          .bind(item.quantity, item.productId, item.quantity)
          .run();

        if (!updateResult.meta?.changes) {
          stockError = item;
          break;
        }

        decremented.push(item);
      }

      if (stockError) {
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }

        return Response.json(
          {
            ok: false,
            error: "INSUFFICIENT_STOCK",
            message: `موجودی «${stockError.productName}» به‌تازگی تمام شده است. لطفاً سبد خرید را اصلاح کنید.`,
          },
          { status: 409 }
        );
      }

      // --- شناسایی مشتری واردشده به حساب کاربری (اختیاری) ---

      const sessionCustomer = await getSessionCustomer(request);
      const customerId = sessionCustomer ? sessionCustomer.id : null;

      // --- تولید کد پیگیری و ثبت سفارش ---

      let trackingCode;
      try {
        trackingCode = await generateTrackingCode();
      } catch (error) {
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }
        throw error;
      }

      const timestamp = nowIso();

      let orderId;
      try {
        const orderResult = await env.DB
          .prepare(
            "INSERT INTO orders (" +
            "tracking_code, customer_id, customer_name, customer_phone, customer_address, " +
            "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
            "latitude, longitude, total, status, payment_status, created_at, updated_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            trackingCode,
            customerId,
            customerName,
            mobile,
            composeAddressText(address),
            address.province,
            address.city,
            address.street,
            address.sub_street,
            address.alley,
            address.plaque,
            address.unit || null,
            address.postal_code,
            address.address_note || null,
            address.latitude,
            address.longitude,
            total,
            "pending",
            "unpaid",
            timestamp,
            timestamp
          )
          .run();

        orderId = orderResult.meta?.last_row_id ?? null;
        if (!orderId) throw new Error("ORDER_ID_NOT_CREATED");

        for (const item of verifiedItems) {
          await env.DB
            .prepare(
              "INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal) " +
              "VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(orderId, item.productId, item.productName, item.price, item.quantity, item.subtotal)
            .run();
        }

        await env.DB
          .prepare("INSERT INTO order_status_history (order_id, status, note) VALUES (?, 'pending', ?)")
          .bind(orderId, "ثبت سفارش توسط مشتری")
          .run();
      } catch (error) {
        // اگر ثبت سفارش شکست خورد، موجودی کاهش‌یافته باید برگردد.
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }
        throw error;
      }

      // --- ذخیره آدرس برای استفاده بعدی مشتری واردشده به حساب (اختیاری) ---

      if (customerId && body.save_address) {
        await env.DB
          .prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?")
          .bind(customerId)
          .run();

        await env.DB
          .prepare(
            "INSERT INTO customer_addresses (" +
            "customer_id, province, city, street, sub_street, alley, plaque, unit, " +
            "postal_code, address_note, latitude, longitude, is_default" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
          )
          .bind(
            customerId,
            address.province,
            address.city,
            address.street,
            address.sub_street,
            address.alley,
            address.plaque,
            address.unit || null,
            address.postal_code,
            address.address_note || null,
            address.latitude,
            address.longitude
          )
          .run();
      }

      await queueSms(
        orderId,
        mobile,
        "order_created",
        `سفارش شما با کد پیگیری ${trackingCode} ثبت شد. مبلغ: ${total.toLocaleString("fa-IR")} تومان.`
      );

      return Response.json(
        {
          ok: true,
          message: "سفارش شما با موفقیت ثبت شد.",
          order_id: orderId,
          tracking_code: trackingCode,
          total,
          status: "pending",
          status_label: STATUS_LABELS.pending,
          created_at: timestamp,
          mobile,
        },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "ORDER_CREATE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پیگیری سفارش مهمان / هر مشتری
  // GET /api/store/track?tracking_code=AP-XXXX&mobile=09xxxxxxxxx
  // =========================

  if (url.pathname === "/api/store/track" && request.method === "GET") {
    try {
      const trackingCode = (url.searchParams.get("tracking_code") || "").trim().toUpperCase();
      const mobile = normalizeDigits(url.searchParams.get("mobile") || "").trim();

      if (!trackingCode || !mobile) {
        return Response.json(
          { ok: false, error: "MISSING_PARAMS", message: "کد پیگیری و شماره موبایل را وارد کنید." },
          { status: 400 }
        );
      }

      const order = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_name, customer_phone, customer_address, " +
          "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
          "total, status, payment_status, postal_carrier, postal_tracking_code, created_at " +
          "FROM orders WHERE tracking_code = ? AND customer_phone = ? LIMIT 1"
        )
        .bind(trackingCode, mobile)
        .first();

      if (!order) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارشی با این مشخصات پیدا نشد." },
          { status: 404 }
        );
      }

      const itemsResult = await env.DB
        .prepare(
          "SELECT product_name, price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id ASC"
        )
        .bind(order.id)
        .all();

      const historyResult = await env.DB
        .prepare("SELECT status, created_at FROM order_status_history WHERE order_id = ? ORDER BY id ASC")
        .bind(order.id)
        .all();

      return Response.json({
        ok: true,
        order: {
          tracking_code: order.tracking_code,
invoice_number: INV-${String(order.id).padStart(6, "0")},
customer_name: order.customer_name,
mobile: order.customer_phone,
postal_code: order.postal_code,
          address: composeAddressText(order),
          total: order.total,
          status: order.status,
          status_label: STATUS_LABELS[order.status] || order.status,
          payment_status: order.payment_status,
          payment_status_label: PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status,
          postal_carrier: order.postal_carrier,
          postal_tracking_code: order.postal_tracking_code,
          created_at: order.created_at,
          items: itemsResult.results || [],
          history: (historyResult.results || []).map((h) => ({
            status: h.status,
            status_label: STATUS_LABELS[h.status] || h.status,
            created_at: h.created_at,
          })),
        },
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — ثبت‌نام
  // =========================

  if (url.pathname === "/api/store/customers/register" && request.method === "POST") {
    try {
      const body = await request.json();
      const fullName = String(body.full_name || body.name || "").trim();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const password = String(body.password || "");

      if (fullName.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return Response.json(
          { ok: false, error: "WEAK_PASSWORD", message: "رمز عبور باید حداقل ۶ کاراکتر باشد." },
          { status: 400 }
        );
      }

      const existing = await env.DB
        .prepare("SELECT id FROM customers WHERE phone = ? LIMIT 1")
        .bind(mobile)
        .first();

      if (existing) {
        return Response.json(
          { ok: false, error: "PHONE_EXISTS", message: "این شماره موبایل قبلاً ثبت‌نام کرده است." },
          { status: 409 }
        );
      }

      const passwordHash = await hashPassword(password);

      const insertResult = await env.DB
        .prepare("INSERT INTO customers (full_name, phone, password_hash) VALUES (?, ?, ?)")
        .bind(fullName, mobile, passwordHash)
        .run();

      const customerId = insertResult.meta?.last_row_id;
      const token = await createCustomerSession(customerId);

      return Response.json(
        { ok: true, customer: { id: customerId, full_name: fullName, phone: mobile } },
        { status: 201, headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — ورود
  // =========================

  if (url.pathname === "/api/store/customers/login" && request.method === "POST") {
    try {
      const body = await request.json();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const password = String(body.password || "");

      const customer = await env.DB
        .prepare("SELECT id, full_name, phone, password_hash FROM customers WHERE phone = ? LIMIT 1")
        .bind(mobile)
        .first();

      const valid = customer ? await verifyPassword(password, customer.password_hash) : false;

      if (!customer || !valid) {
        return Response.json(
          { ok: false, error: "INVALID_CREDENTIALS", message: "شماره موبایل یا رمز عبور اشتباه است." },
          { status: 401 }
        );
      }

      const token = await createCustomerSession(customer.id);

      return Response.json(
        { ok: true, customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone } },
        { headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — خروج
  // =========================

  if (url.pathname === "/api/store/customers/logout" && request.method === "POST") {
    const cookies = parseCookies(request);
    const token = cookies[SESSION_COOKIE_NAME];

    if (token) {
      try {
        await env.DB.prepare("DELETE FROM customer_sessions WHERE token = ?").bind(token).run();
      } catch {
        // بی‌اثر بودن خطا در این مرحله مشکلی ایجاد نمی‌کند.
      }
    }

    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": buildClearSessionCookie(request) } }
    );
  }

  // =========================
  // حساب مشتری — وضعیت فعلی ورود
  // =========================

  if (url.pathname === "/api/store/customers/me" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, logged_in: false });
    }

    return Response.json({
      ok: true,
      logged_in: true,
      customer: { id: sessionCustomer.id, full_name: sessionCustomer.full_name, phone: sessionCustomer.phone },
    });
  }

  // =========================
  // حساب مشتری — آدرس پیش‌فرض ذخیره‌شده
  // =========================

  if (url.pathname === "/api/store/customers/address" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const address = await env.DB
        .prepare(
          "SELECT province, city, street, sub_street, alley, plaque, unit, postal_code, " +
          "address_note, latitude, longitude FROM customer_addresses " +
          "WHERE customer_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1"
        )
        .bind(sessionCustomer.id)
        .first();

      return Response.json({ ok: true, address: address || null });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — سفارش‌های من (فهرست)
  // =========================

  if (url.pathname === "/api/store/customers/orders" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED", message: "لطفاً وارد حساب کاربری شوید." }, { status: 401 });
    }

    try {
      const ordersResult = await env.DB
        .prepare(
          "SELECT id, tracking_code, total, status, payment_status, postal_carrier, " +
          "postal_tracking_code, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC"
        )
        .bind(sessionCustomer.id)
        .all();

      const orders = ordersResult.results || [];

      for (const order of orders) {
        const itemCount = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?")
          .bind(order.id)
          .first();

        order.item_count = itemCount?.count || 0;
        order.status_label = STATUS_LABELS[order.status] || order.status;
        order.payment_status_label = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status;
      }

      return Response.json({ ok: true, orders });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — جزئیات یک سفارش
  // GET /api/store/customers/orders/:id
  // =========================

  if (
    url.pathname.startsWith("/api/store/customers/orders/") &&
    request.method === "GET"
  ) {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED", message: "لطفاً وارد حساب کاربری شوید." }, { status: 401 });
    }

    try {
      const orderId = Number(url.pathname.split("/").pop());

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json({ ok: false, error: "INVALID_ORDER_ID" }, { status: 400 });
      }

      const order = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
          "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
          "total, status, payment_status, postal_carrier, postal_tracking_code, created_at " +
          "FROM orders WHERE id = ? LIMIT 1"
        )
        .bind(orderId)
        .first();

      if (!order || order.customer_id !== sessionCustomer.id) {
        return Response.json({ ok: false, error: "ORDER_NOT_FOUND", message: "سفارش پیدا نشد." }, { status: 404 });
      }

      const itemsResult = await env.DB
        .prepare("SELECT product_name, price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id ASC")
        .bind(orderId)
        .all();

      const historyResult = await env.DB
        .prepare("SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY id ASC")
        .bind(orderId)
        .all();

      order.address = composeAddressText(order);
      order.status_label = STATUS_LABELS[order.status] || order.status;
      order.payment_status_label = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status;
      order.items = itemsResult.results || [];
      order.history = (historyResult.results || []).map((h) => ({
        status: h.status,
        status_label: STATUS_LABELS[h.status] || h.status,
        note: h.note,
        created_at: h.created_at,
      }));

      return Response.json({ ok: true, order });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی — ثبت تیکت جدید (مهمان یا مشتری ثبت‌نام‌شده)
  // POST /api/support/tickets
  // =========================

  if (url.pathname === "/api/support/tickets" && request.method === "POST") {
    try {
      const body = await request.json();

      const name = String(body.name || "").trim();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const email = String(body.email || "").trim();
      const subject = String(body.subject || "").trim();
      const message = String(body.message || "").trim();

      if (name.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { ok: false, error: "INVALID_EMAIL", message: "ایمیل واردشده معتبر نیست." },
          { status: 400 }
        );
      }

      if (!subject || subject.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_SUBJECT", message: "موضوع درخواست را وارد کنید." },
          { status: 400 }
        );
      }

      if (!message || message.length < 5) {
        return Response.json(
          { ok: false, error: "INVALID_MESSAGE", message: "متن درخواست خیلی کوتاه است." },
          { status: 400 }
        );
      }

      const sessionCustomer = await getSessionCustomer(request);
      const customerId = sessionCustomer ? sessionCustomer.id : null;

      const orderId = body.order_id != null && Number.isInteger(Number(body.order_id))
        ? Number(body.order_id)
        : null;

      const trackingCode = await generateTicketTrackingCode();
      const timestamp = nowIso();

      const insertResult = await env.DB
        .prepare(
          "INSERT INTO tickets (" +
          "tracking_code, customer_id, order_id, name, mobile, email, subject, message, " +
          "status, created_at, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)"
        )
        .bind(trackingCode, customerId, orderId, name, mobile, email || null, subject, message, timestamp, timestamp)
        .run();

      const ticketId = insertResult.meta?.last_row_id;

      await env.DB
        .prepare(
          "INSERT INTO ticket_messages (ticket_id, sender_type, message) VALUES (?, 'customer', ?)"
        )
        .bind(ticketId, message)
        .run();

      await queueTicketSms(
        ticketId,
        mobile,
        "ticket_created",
        `درخواست پشتیبانی شما با کد پیگیری ${trackingCode} ثبت شد.`
      );

      if (email) {
        await queueEmail(
          null,
          ticketId,
          email,
          `دریافت درخواست پشتیبانی — ${trackingCode}`,
          `درخواست شما با موضوع «${subject}» دریافت شد. کد پیگیری: ${trackingCode}`
        );
      }

      return Response.json(
        {
          ok: true,
          message: "درخواست پشتیبانی شما با موفقیت ثبت شد.",
          tracking_code: trackingCode,
          status: "received",
          status_label: TICKET_STATUS_LABELS.received,
          created_at: timestamp,
        },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "TICKET_CREATE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی — پیگیری تیکت (مهمان یا هر کاربر) با کد پیگیری + موبایل
  // GET /api/support/tickets/track?tracking_code=TK-XXXX&mobile=09xxxxxxxxx
  // =========================

  if (url.pathname === "/api/support/tickets/track" && request.method === "GET") {
    try {
      const trackingCode = (url.searchParams.get("tracking_code") || "").trim().toUpperCase();
      const mobile = normalizeDigits(url.searchParams.get("mobile") || "").trim();

      if (!trackingCode || !mobile) {
        return Response.json(
          { ok: false, error: "MISSING_PARAMS", message: "کد پیگیری و شماره موبایل را وارد کنید." },
          { status: 400 }
        );
      }

      const ticket = await env.DB
        .prepare(
          "SELECT id, tracking_code, name, subject, status, created_at, updated_at " +
          "FROM tickets WHERE tracking_code = ? AND mobile = ? LIMIT 1"
        )
        .bind(trackingCode, mobile)
        .first();

      if (!ticket) {
        return Response.json(
          { ok: false, error: "TICKET_NOT_FOUND", message: "درخواستی با این مشخصات پیدا نشد." },
          { status: 404 }
        );
      }

      const messagesResult = await env.DB
        .prepare(
          "SELECT sender_type, message, created_at FROM ticket_messages " +
          "WHERE ticket_id = ? ORDER BY id ASC"
        )
        .bind(ticket.id)
        .all();

      return Response.json({
        ok: true,
        ticket: {
          tracking_code: ticket.tracking_code,
          name: ticket.name,
          subject: ticket.subject,
          status: ticket.status,
          status_label: TICKET_STATUS_LABELS[ticket.status] || ticket.status,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          messages: messagesResult.results || [],
        },
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی — سفارش‌های من: تیکت‌های مشتری واردشده به حساب
  // GET /api/support/tickets/mine
  // =========================

  if (url.pathname === "/api/support/tickets/mine" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED", message: "لطفاً وارد حساب کاربری شوید." }, { status: 401 });
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, tracking_code, subject, status, created_at FROM tickets " +
          "WHERE customer_id = ? ORDER BY id DESC"
        )
        .bind(sessionCustomer.id)
        .all();

      const tickets = (result.results || []).map((t) => ({
        ...t,
        status_label: TICKET_STATUS_LABELS[t.status] || t.status,
      }));

      return Response.json({ ok: true, tickets });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — فهرست تیکت‌ها
  // GET /api/support/admin/tickets
  // نکته: پنل تصویری مدیریت تیکت طبق دستورالعمل فعلاً در مراحل بعدی ساخته می‌شود؛
  // این API از هم‌اکنون آماده است تا آن مرحله بدون بازنویسی ساختار انجام شود.
  // =========================

  if (url.pathname === "/api/support/admin/tickets" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const statusFilter = (url.searchParams.get("status") || "").trim();
      const query = (url.searchParams.get("q") || "").trim();

      const conditions = [];
      const params = [];

      if (statusFilter) {
        conditions.push("status = ?");
        params.push(statusFilter);
      }

      if (query) {
        conditions.push("(tracking_code LIKE ? OR mobile LIKE ? OR name LIKE ?)");
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, order_id, name, mobile, email, subject, " +
          "status, created_at, updated_at FROM tickets " +
          whereClause +
          " ORDER BY id DESC LIMIT 200"
        )
        .bind(...params)
        .all();

      const tickets = (result.results || []).map((t) => ({
        ...t,
        status_label: TICKET_STATUS_LABELS[t.status] || t.status,
      }));

      return Response.json({ ok: true, tickets });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — جزئیات یک تیکت
  // GET /api/support/admin/tickets/:id
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const ticketId = Number(url.pathname.split("/").pop());

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      const ticket = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, order_id, name, mobile, email, subject, " +
          "status, created_at, updated_at FROM tickets WHERE id = ? LIMIT 1"
        )
        .bind(ticketId)
        .first();

      if (!ticket) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      const messagesResult = await env.DB
        .prepare(
          "SELECT id, sender_type, message, attachment_url, created_at FROM ticket_messages " +
          "WHERE ticket_id = ? ORDER BY id ASC"
        )
        .bind(ticketId)
        .all();

      ticket.status_label = TICKET_STATUS_LABELS[ticket.status] || ticket.status;
      ticket.messages = messagesResult.results || [];

      return Response.json({ ok: true, ticket });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — تغییر وضعیت تیکت
  // PUT /api/support/admin/tickets/:id
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const ticketId = Number(url.pathname.split("/").pop());
      const body = await request.json();
      const status = String(body.status || "").trim();

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      if (!ALLOWED_TICKET_STATUSES.includes(status)) {
        return Response.json(
          { ok: false, error: "INVALID_STATUS", message: "وضعیت تیکت نامعتبر است." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, nowIso(), ticketId)
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      return Response.json({ ok: true, ticket_id: ticketId, status });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — پاسخ به تیکت
  // POST /api/support/admin/tickets/:id/reply
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    url.pathname.endsWith("/reply") &&
    request.method === "POST"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const segments = url.pathname.split("/");
      const ticketId = Number(segments[segments.length - 2]);
      const body = await request.json();
      const message = String(body.message || "").trim();

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      if (!message) {
        return Response.json(
          { ok: false, error: "INVALID_MESSAGE", message: "متن پاسخ نمی‌تواند خالی باشد." },
          { status: 400 }
        );
      }

      const ticket = await env.DB
        .prepare("SELECT id, mobile, email, tracking_code FROM tickets WHERE id = ? LIMIT 1")
        .bind(ticketId)
        .first();

      if (!ticket) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      await env.DB
        .prepare("INSERT INTO ticket_messages (ticket_id, sender_type, message) VALUES (?, 'admin', ?)")
        .bind(ticketId, message)
        .run();

      await env.DB
        .prepare("UPDATE tickets SET status = 'answered', updated_at = ? WHERE id = ?")
        .bind(nowIso(), ticketId)
        .run();

      await queueTicketSms(
        ticketId,
        ticket.mobile,
        "ticket_replied",
        `به درخواست پشتیبانی شما (${ticket.tracking_code}) پاسخ داده شد.`
      );

      if (ticket.email) {
        await queueEmail(
          null,
          ticketId,
          ticket.email,
          `پاسخ به درخواست پشتیبانی — ${ticket.tracking_code}`,
          message
        );
      }

      return Response.json({ ok: true, ticket_id: ticketId, status: "answered" });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // API Not Found
  // =========================

  return Response.json({ ok: false, error: "API_NOT_FOUND" }, { status: 404 });
}


// =========================
// Worker
// =========================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      url.pathname.startsWith("/api/store/") ||
      url.pathname.startsWith("/api/support/")
    ) {
      return handleStoreApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
