// =========================================================================
// تست مسیر مشترک Quote ارسال (Estimate / Cart / Checkout ← resolveCustomerShipping)
// =========================================================================
// این تست‌ها Worker واقعی (src/index.js) را با D1 (node:sqlite) و Proxy موک‌شده
// اجرا می‌کنند. هیچ Round-trip واقعی با Tapin/VPS انجام نمی‌شود (Sandbox شبکه ندارد).
//
// A) online → Tapin Quote          B) online-only failure → بدون Fallback بی‌صدا
// C) online_fallback_internal      D) Estimate واقعاً Provider آنلاین را صدا می‌زند
// E) Checkout همان مسیر Quote      F) یکسانی Estimate و Checkout
// G) Multi-package: چند کالای متفاوت → TAPIN_MULTI_PACKAGE_UNSUPPORTED، یک کالا × چند عدد → count
//
// اجرا:  node --no-warnings test/shipping-shared-quote.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import worker from "../src/index.js";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n    ${error.stack || error.message}`);
  }
}

function wrapD1(db) {
  return {
    prepare(sql) {
      const stmt = () => db.prepare(sql);
      const wrap = (args) => ({
        first: async () => stmt().get(...args) ?? null,
        all: async () => ({ results: stmt().all(...args) }),
        run: async () => {
          const r = stmt().run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      });
      return { bind: (...args) => wrap(args), ...wrap([]) };
    },
  };
}

const PROXY_KEY = "proxy-secret-key-should-never-leak";
const TAPIN_CONFIG = {
  pay_type: 1, order_type: 0,
};

function makeEnv({ mode = "online", tapinStatus = "active" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE site_settings (id INTEGER PRIMARY KEY, store_status TEXT, services_status TEXT,
      store_updated_at TEXT, services_updated_at TEXT, shipping_calculation_mode TEXT);
    INSERT INTO site_settings (id, store_status, services_status, shipping_calculation_mode)
      VALUES (1, 'open', 'open', '${mode === "internal" ? "engine" : mode}');
    CREATE TABLE shipping_providers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, type TEXT,
      status TEXT, mode TEXT, fallback_provider_code TEXT, config_json TEXT, sort_order INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT);
    INSERT INTO shipping_providers (code, name, type, status, mode, fallback_provider_code, config_json, sort_order) VALUES
      ('internal','داخلی','internal','active','quote',NULL,NULL,10),
      ('tapin','تاپین','online','${tapinStatus}','quote','internal','${JSON.stringify(TAPIN_CONFIG)}',20);
    CREATE TABLE shipping_quote_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_code TEXT NOT NULL,
      calculation_mode TEXT NOT NULL, request_json TEXT, response_json TEXT, status TEXT, error_code TEXT,
      error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE shipping_methods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, cost REAL, cost_type TEXT DEFAULT 'flat',
      active INTEGER DEFAULT 1, scope TEXT DEFAULT 'global', allowed_city TEXT, sort_order INTEGER DEFAULT 0, volumetric_divisor REAL);
    INSERT INTO shipping_methods (name, cost, cost_type, scope, allowed_city) VALUES ('پیک اصفهان', 30000, 'flat', 'city', 'اصفهان');
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, stock INTEGER, active INTEGER DEFAULT 1,
      weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, shipping_class_id INTEGER,
      packaging_profile_id INTEGER, package_length_cm REAL, package_width_cm REAL, package_height_cm REAL,
      package_weight_grams INTEGER, packaging_confidence TEXT);
    INSERT INTO products (id, name, price, stock, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_weight_grams)
      VALUES (1, 'پکیج شوفاژ دیواری آدنا 24 کیلووات', 112000000, 5, 36000, 80, 45, 35, 1500);
    INSERT INTO products (id, name, price, stock, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_weight_grams)
      VALUES (2, 'شیر برقی', 500000, 5, 300, 10, 10, 10, 100);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_code TEXT, customer_id INTEGER, customer_name TEXT,
      customer_phone TEXT, customer_address TEXT, province TEXT, city TEXT, street TEXT, sub_street TEXT, alley TEXT,
      plaque TEXT, unit TEXT, postal_code TEXT, address_note TEXT, latitude REAL, longitude REAL, total INTEGER,
      shipping_cost INTEGER, shipping_method_id INTEGER, shipping_method_name TEXT, shipping_is_cod INTEGER,
      payable_amount INTEGER, status TEXT, payment_status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, product_name TEXT,
      price INTEGER, quantity INTEGER, subtotal INTEGER);
    CREATE TABLE order_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE order_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER UNIQUE, created_at TEXT, is_read INTEGER DEFAULT 0);
  `);
  return { DB: wrapD1(db), PROXY_API_KEY: PROXY_KEY, _raw: db };
}

// Proxy موک: پاسخ Tapin (ریال) بر اساس بدنه دریافتی.
function installProxy(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body, headers: options.headers });
    const out = await handler(body, calls.length);
    return { ok: out.ok !== false, status: out.status || 200, json: async () => out.json };
  };
  return { calls, restore: () => (global.fetch = original) };
}
const tapinOk = (rial) => ({ json: { ok: true, entries: { total_send_price: rial } } });

async function estimate(env, query) {
  const res = await worker.fetch(new Request(`https://x.test/api/store/shipping-methods?${query}`), env, {});
  return res.json();
}

const checkoutBody = (over = {}) => ({
  customer: { name: "علی رضایی", mobile: "09121234567", province: "تهران", city: "ورامین", street: "خیابان اصلی",
    sub_street: "", alley: "", plaque: "12", unit: "", postal_code: "1234567890", address_note: "" },
  items: [{ id: 1, quantity: 1 }],
  shipping_method_id: "tapin",
  expected_shipping_cost: 165000,
  ...over,
});
async function checkout(env, body) {
  // جداول/کلید SMS در این Harness عمداً نیستند؛ نویز لاگ‌های غیرمرتبط SMS ساکت می‌شود.
  const origErr = console.error, origLog = console.log;
  console.error = () => {};
  try {
    const res = await worker.fetch(
      new Request("https://x.test/api/store/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      env, {}
    );
    return { status: res.status, data: await res.json() };
  } finally {
    console.error = origErr; console.log = origLog;
  }
}

const VARAMIN = "city=ورامین&province=تهران&product_ids=1&quantities=1";
const enc = (q) => q.split("&").map((p) => p.split("=").map(encodeURIComponent).join("=")).join("&");

console.log("A) Online Quote");
await test("online: Estimate ورامین → Quote تیپاکس (ریال→تومان یک‌بار)، نه موتور داخلی", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const data = await estimate(env, enc(VARAMIN));
    assert.equal(data.ok, true);
    assert.equal(data.source, "tapin");
    assert.equal(data.shipping_methods.length, 1);
    assert.equal(data.shipping_methods[0].id, "tapin");
    assert.equal(data.shipping_methods[0].cost, 165000);
    assert.equal(data.shipping_methods[0].source, "tapin");
    assert.equal(proxy.calls.length, 1);
    assert.equal(proxy.calls[0].url, "https://proxy.tasisatapadanaesfahan.ir/api/v1/tapin/quote");
    assert.equal(proxy.calls[0].body.destination_city, "ورامین");
    assert.equal(proxy.calls[0].body.destination_province, "تهران"); // قرارداد جدید: استان همیشه ارسال می‌شود
  } finally { proxy.restore(); }
});

await test("بدنه Tapin: نام فیلدهای صحیح، تومان→ریال یک‌بار، وزن کالا ≠ وزن بسته، بدون ۵×۵×۵", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_000_000));
  try {
    await estimate(env, enc(VARAMIN));
    const b = proxy.calls[0].body;
    const p = b.products[0];
    assert.equal(p.price, 1_120_000_000);
    assert.equal(p.discount, 0);
    assert.equal(p.weight, 36000);
    assert.equal(p.count, 1);
    assert.equal(p.title, "پکیج شوفاژ دیواری آدنا 24 کیلووات"); // نام واقعی محصول از D1
    assert.equal(p.product_id, 1);
    assert.equal(b.package_weight, 1500);
    assert.deepEqual([b.length, b.width, b.height], [80, 45, 35]);
    assert.equal(b.pay_type, 1);
    assert.equal(b.order_type, 0);
    for (const bad of ["service_type", "pickup_type", "delivery_type", "payment_type", "product_type_id", "packing_type_id",
      "count_per_discount", "count_per_amount", "weight_package", "type_pickup", "receiver_city_id", "receiver_province_id"]) assert.equal(b[bad], undefined);
    for (const bad of ["amount_per_count", "discount_per_count", "weight_per_count"]) assert.equal(p[bad], undefined);
    assert.ok(!JSON.stringify(proxy.calls[0].body).includes(PROXY_KEY));
  } finally { proxy.restore(); }
});

await test("قیمت واقعی از D1 خوانده می‌شود (نه ورودی مرورگر) و Quote در shipping_quote_history با Schema واقعی ثبت می‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    await estimate(env, enc(VARAMIN) + "&price=1");
    const row = env._raw.prepare("SELECT * FROM shipping_quote_history").get();
    assert.equal(row.provider_code, "tapin");
    assert.equal(row.calculation_mode, "online");
    assert.equal(row.status, "success");
    const req = JSON.parse(row.request_json);
    assert.equal(req.items[0].price_toman, 112_000_000);
    assert.equal(req.destination_province, "تهران");
    assert.equal(Object.keys(row).includes("quoted_at"), false);
  } finally { proxy.restore(); }
});

console.log("B) Online-only failure");
await test("online + شکست Proxy → shipping_methods خالی + unavailable؛ موتور داخلی جایگزین نمی‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => ({ ok: false, status: 502, json: { message: "down" } }));
  try {
    const data = await estimate(env, enc("city=اصفهان&province=اصفهان&product_ids=1&quantities=1"));
    assert.equal(data.ok, true);
    assert.deepEqual(data.shipping_methods, []); // «پیک اصفهان» داخلی نباید بیاید، حتی برای اصفهان
    assert.equal(data.fell_back, false);
    assert.ok(data.unavailable?.message);
    const row = env._raw.prepare("SELECT status, error_code FROM shipping_quote_history").get();
    assert.equal(row.status, "error");
    assert.equal(row.error_code, "PROXY_HTTP_ERROR");
  } finally { proxy.restore(); }
});

await test("online + Provider تیپاکس غیرفعال → خطا، نه Fallback بی‌صدا به موتور داخلی", async () => {
  const env = makeEnv({ mode: "online", tapinStatus: "disabled" });
  const proxy = installProxy(() => { throw new Error("نباید تماسی برقرار شود"); });
  try {
    const data = await estimate(env, enc("city=اصفهان&province=اصفهان&product_ids=1&quantities=1"));
    assert.deepEqual(data.shipping_methods, []);
    assert.equal(data.unavailable.code, "TAPIN_PROVIDER_INACTIVE");
    assert.equal(proxy.calls.length, 0);
  } finally { proxy.restore(); }
});

await test("پاسخ Tapin بدون مبلغ معتبر → خطا، هرگز ارسال رایگان ۰ تومانی", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => ({ json: { ok: true, entries: {} } }));
  try {
    const data = await estimate(env, enc(VARAMIN));
    assert.deepEqual(data.shipping_methods, []);
    assert.equal(data.unavailable.code, "TAPIN_RESPONSE_UNRECOGNIZED");
  } finally { proxy.restore(); }
});

console.log("C) Online fallback");
await test("online_fallback_internal + شکست Tapin → موتور داخلی با fell_back=true و source=internal", async () => {
  const env = makeEnv({ mode: "online_fallback_internal" });
  const proxy = installProxy(() => ({ ok: false, status: 502, json: {} }));
  try {
    const data = await estimate(env, enc("city=اصفهان&province=اصفهان&product_ids=1&quantities=1"));
    assert.equal(data.fell_back, true);
    assert.equal(data.source, "internal");
    assert.equal(data.shipping_methods[0].name, "پیک اصفهان");
    assert.equal(data.shipping_methods[0].source, "internal");
  } finally { proxy.restore(); }
});

await test("online_fallback_internal + موفقیت Tapin → Quote تیپاکس (نه داخلی)", async () => {
  const env = makeEnv({ mode: "online_fallback_internal" });
  const proxy = installProxy(() => tapinOk(900_000));
  try {
    const data = await estimate(env, enc(VARAMIN));
    assert.equal(data.source, "tapin");
    assert.equal(data.shipping_methods[0].cost, 90000);
    assert.equal(data.fell_back, false);
  } finally { proxy.restore(); }
});

await test("حالت internal (engine): هیچ تماس شبکه‌ای؛ منطق داخلی دست‌نخورده", async () => {
  const env = makeEnv({ mode: "internal" });
  const proxy = installProxy(() => { throw new Error("نباید Tapin صدا زده شود"); });
  try {
    const data = await estimate(env, enc("city=اصفهان&province=اصفهان&product_ids=1&quantities=1"));
    assert.equal(data.source, "internal");
    assert.equal(data.shipping_methods[0].name, "پیک اصفهان");
    assert.equal(proxy.calls.length, 0);
    const varamin = await estimate(env, enc(VARAMIN));
    assert.deepEqual(varamin.shipping_methods, []); // ورامین در جدول داخلی نیست (رفتار قبلی)
  } finally { proxy.restore(); }
});

console.log("D/E/F) Estimate، Checkout و یکسانی مبلغ");
await test("Checkout ورامین در حالت online: سفارش با مبلغ Quote تیپاکس ثبت می‌شود (نه «روش ارسالی در دسترس نیست»)", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const { status, data } = await checkout(env, checkoutBody());
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.ok, true);
    const order = env._raw.prepare("SELECT * FROM orders").get();
    assert.equal(order.shipping_cost, 165000);
    assert.equal(order.shipping_method_id, null);
    assert.equal(order.shipping_method_name, "ارسال پستی (Tapin)");
    assert.equal(order.total, 112_000_000 + 165000);
    assert.equal(proxy.calls.length, 1);
  } finally { proxy.restore(); }
});

await test("F) Estimate و Checkout برای شرایط یکسان بدنه Quote یکسان به Tapin می‌فرستند", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const est = await estimate(env, enc(VARAMIN));
    await checkout(env, checkoutBody({ expected_shipping_cost: est.shipping_methods[0].cost }));
    assert.equal(proxy.calls.length, 2);
    assert.deepEqual(proxy.calls[0].body, proxy.calls[1].body);
  } finally { proxy.restore(); }
});

await test("Checkout: اگر Quote تازه با مبلغ نمایش‌داده‌شده فرق کند → SHIPPING_COST_CHANGED و سفارش ثبت نمی‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_800_000));
  try {
    const { status, data } = await checkout(env, checkoutBody({ expected_shipping_cost: 165000 }));
    assert.equal(status, 409);
    assert.equal(data.error, "SHIPPING_COST_CHANGED");
    assert.equal(data.new_shipping_cost, 180000);
    assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
    assert.equal(env._raw.prepare("SELECT stock FROM products WHERE id=1").get().stock, 5);
  } finally { proxy.restore(); }
});

await test("Checkout online-only + شکست Tapin → SHIPPING_QUOTE_UNAVAILABLE (۵۰۳)، بدون سفارش/کاهش موجودی", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => ({ ok: false, status: 502, json: {} }));
  try {
    const { status, data } = await checkout(env, checkoutBody());
    assert.equal(status, 503);
    assert.equal(data.error, "SHIPPING_QUOTE_UNAVAILABLE");
    assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
    assert.equal(env._raw.prepare("SELECT stock FROM products WHERE id=1").get().stock, 5);
  } finally { proxy.restore(); }
});

await test("Checkout: انتخاب روش داخلی در حالت online پذیرفته نمی‌شود (Tapin شناسه tapin دارد، نه id داخلی)", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const { status, data } = await checkout(env, checkoutBody({ shipping_method_id: 1 }));
    assert.equal(status, 400);
    assert.equal(data.error, "INVALID_SHIPPING_METHOD");
  } finally { proxy.restore(); }
});

await test("Checkout در حالت internal: مسیر داخلی قبلی (روش عددی) همچنان کار می‌کند", async () => {
  const env = makeEnv({ mode: "internal" });
  const proxy = installProxy(() => { throw new Error("نباید Tapin صدا زده شود"); });
  try {
    const { status, data } = await checkout(env, checkoutBody({
      customer: { ...checkoutBody().customer, province: "اصفهان", city: "اصفهان" }, shipping_method_id: 1, expected_shipping_cost: undefined }));
    assert.equal(status, 201, JSON.stringify(data));
    const order = env._raw.prepare("SELECT * FROM orders").get();
    assert.equal(order.shipping_cost, 30000);
    assert.equal(order.shipping_method_id, 1);
  } finally { proxy.restore(); }
});

console.log("G) Multi-package");
await test("چند کالای متفاوت → TAPIN_MULTI_PACKAGE_UNSUPPORTED، بدون تماس شبکه و بدون Fallback در online", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => { throw new Error("نباید تماسی برقرار شود"); });
  try {
    const data = await estimate(env, enc("city=ورامین&province=تهران&product_ids=1,2&quantities=1,1"));
    assert.deepEqual(data.shipping_methods, []);
    assert.equal(data.unavailable.code, "TAPIN_MULTI_PACKAGE_UNSUPPORTED");
    assert.equal(proxy.calls.length, 0);
  } finally { proxy.restore(); }
});

await test("یک کالا × چند عدد → count=3 با یک بسته؛ Quote موفق", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(2_000_000));
  try {
    const data = await estimate(env, enc("city=ورامین&province=تهران&product_ids=1&quantities=3"));
    assert.equal(data.shipping_methods[0].cost, 200000);
    assert.equal(proxy.calls[0].body.products[0].count, 3);
    assert.equal(proxy.calls[0].body.products[0].price, 1_120_000_000);
  } finally { proxy.restore(); }
});

await test("Quote قدیمی با تغییر تعداد/مقصد دوباره استفاده نمی‌شود (هر درخواست Quote تازه)", async () => {
  const env = makeEnv({ mode: "online" });
  let n = 0;
  const proxy = installProxy(() => tapinOk(1_000_000 + 100_000 * ++n));
  try {
    const a = await estimate(env, enc("city=ورامین&province=تهران&product_ids=1&quantities=1"));
    const b = await estimate(env, enc("city=ورامین&province=تهران&product_ids=1&quantities=2"));
    const c = await estimate(env, enc("city=اصفهان&province=اصفهان&product_ids=1&quantities=2"));
    assert.equal(proxy.calls.length, 3);
    assert.equal(proxy.calls[1].body.products[0].count, 2);
    assert.equal(proxy.calls[2].body.destination_city, "اصفهان");
    assert.equal(proxy.calls[2].body.service_type, undefined); // Post v2: service_type وجود ندارد
    assert.notEqual(a.shipping_methods[0].cost, b.shipping_methods[0].cost);
    assert.equal(c.shipping_methods[0].cost, 130000);
  } finally { proxy.restore(); }
});

console.log("وزن/بسته‌بندی");
await test("وزن کالای ثبت‌نشده → TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE (وزن جایگزین ساخته نمی‌شود)", async () => {
  const env = makeEnv({ mode: "online" });
  env._raw.exec("UPDATE products SET weight_grams = NULL WHERE id = 1");
  const proxy = installProxy(() => { throw new Error("نباید تماسی برقرار شود"); });
  try {
    const data = await estimate(env, enc(VARAMIN));
    assert.equal(data.unavailable.code, "TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE");
    assert.equal(proxy.calls.length, 0);
  } finally { proxy.restore(); }
});

await test("برآورد بسته (بدون Override): package_weight فقط سهم بسته‌بندی/تلرانس است، وزن کالا دوبار شمرده نمی‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  env._raw.exec("UPDATE products SET package_length_cm=NULL, package_width_cm=NULL, package_height_cm=NULL, package_weight_grams=NULL, length_cm=70, width_cm=40, height_cm=30 WHERE id = 1");
  const proxy = installProxy(() => tapinOk(1_000_000));
  try {
    await estimate(env, enc(VARAMIN));
    const b = proxy.calls[0].body;
    assert.equal(b.products[0].weight, 36000);
    assert.ok(b.package_weight > 0 && b.package_weight < 36000, `package_weight=${b.package_weight}`);
    assert.ok(b.length >= 70 && b.width >= 40 && b.height >= 30);
    assert.notDeepEqual([b.length, b.width, b.height], [5, 5, 5]);
  } finally { proxy.restore(); }
});

await test("Checkout Tapin بدون expected_shipping_cost → SHIPPING_COST_CHANGED و سفارش ثبت نمی‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const { status, data } = await checkout(env, checkoutBody({ expected_shipping_cost: undefined }));
    assert.equal(status, 409);
    assert.equal(data.error, "SHIPPING_COST_CHANGED");
    assert.equal(data.new_shipping_cost, 165000);
    assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
  } finally { proxy.restore(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
