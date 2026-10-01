// =========================================================================
// تست Audit/تشخیص خطا در مسیر Quote ارسال (بازتولید مشکل «بدون رکورد در shipping_quote_history»)
// (قالب Harness از تست مسیر مشترک Quote) (Estimate / Cart / Checkout ← resolveCustomerShipping)
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
import { getShippingOptionsViaEngine } from "../src/shipping-engine.js";

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
  pay_type: 1,
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


const enc = (q) => q.split("&").map((p) => p.split("=").map(encodeURIComponent).join("=")).join("&");
const Q = enc("city=ورامین&province=تهران&product_ids=1&quantities=1");
const rowsOf = (env) => env._raw.prepare("SELECT calculation_mode, status, error_code, error_message, request_json, response_json FROM shipping_quote_history").all();
const countOf = (env) => env._raw.prepare("SELECT COUNT(*) c FROM shipping_quote_history").get().c;

function silence() {
  const orig = console.error; const logs = [];
  console.error = (...a) => logs.push(a.join(" "));
  return { logs, restore: () => (console.error = orig) };
}

console.log("Audit و علت واقعی خطا");

await test("خطای Proxy (FastAPI detail) با علت واقعی و HTTP status ثبت می‌شود و Secret پاک می‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => ({ ok: false, status: 502, json: { detail: `Tapin failed status 10405 for key ${PROXY_KEY}` } }));
  try {
    const data = await estimate(env, Q);
    assert.equal(data.shipping_methods.length, 0);
    assert.equal(data.unavailable.code, "PROXY_HTTP_ERROR");
    assert.equal(countOf(env), 1);
    const r = rowsOf(env)[0];
    assert.equal(r.status, "error");
    assert.equal(r.error_code, "PROXY_HTTP_ERROR");
    assert.match(r.error_message, /HTTP 502/);
    assert.match(r.error_message, /10405/);
    assert.ok(!JSON.stringify(r).includes(PROXY_KEY), "PROXY_API_KEY نباید در Audit باشد");
    assert.equal(r.calculation_mode, "online");
    assert.ok(!JSON.stringify(data).includes(PROXY_KEY));
    assert.equal("audit" in data, false, "audit نباید در پاسخ عمومی باشد");
  } finally { proxy.restore(); }
});

await test("پاسخ غیر-JSON (مثلاً HTML خطای Cloudflare/nginx) → PROXY_INVALID_RESPONSE با HTTP status", async () => {
  const env = makeEnv({ mode: "online" });
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, text: async () => "<html>error code: 1010</html>", json: async () => { throw new Error("x"); } });
  try {
    const data = await estimate(env, Q);
    assert.equal(data.unavailable.code, "PROXY_INVALID_RESPONSE");
    const r = rowsOf(env)[0];
    assert.match(r.error_message, /HTTP 403/);
    assert.match(r.error_message, /1010/);
  } finally { global.fetch = original; }
});

await test("Timeout/قطع اتصال Proxy → PROXY_TIMEOUT ثبت می‌شود و signal ارسال شده است", async () => {
  const env = makeEnv({ mode: "online" });
  const original = global.fetch;
  let sawSignal = false;
  global.fetch = async (url, options) => {
    sawSignal = !!options.signal;
    const e = new Error("aborted"); e.name = "AbortError"; throw e;
  };
  try {
    const data = await estimate(env, Q);
    assert.equal(sawSignal, true);
    assert.equal(data.unavailable.code, "PROXY_TIMEOUT");
    assert.equal(rowsOf(env)[0].error_code, "PROXY_TIMEOUT");
  } finally { global.fetch = original; }
});

await test("Secret با newline انتهایی → هدر Authorization بدون newline ارسال می‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  env.PROXY_API_KEY = PROXY_KEY + "\n";
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const data = await estimate(env, Q);
    assert.equal(data.shipping_methods[0].cost, 165000);
    assert.equal(proxy.calls[0].headers.Authorization, `Bearer ${PROXY_KEY}`);
  } finally { proxy.restore(); }
});

await test("PROXY_API_KEY ست‌نشده → خطای مشخص و رکورد Audit (نه پیام مبهم بدون علت)", async () => {
  const env = makeEnv({ mode: "online" });
  delete env.PROXY_API_KEY;
  const data = await estimate(env, Q);
  assert.equal(data.unavailable.code, "PROXY_CREDENTIALS_MISSING");
  const r = rowsOf(env)[0];
  assert.equal(r.error_code, "PROXY_CREDENTIALS_MISSING");
  assert.match(r.error_message, /PROXY_API_KEY/);
});

await test("Provider غیرفعال در حالت online → بدون Fallback، ولی Audit با TAPIN_PROVIDER_INACTIVE ثبت می‌شود", async () => {
  const env = makeEnv({ mode: "online", tapinStatus: "disabled" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const data = await estimate(env, Q);
    assert.equal(data.shipping_methods.length, 0);
    assert.equal(proxy.calls.length, 0);
    assert.equal(countOf(env), 1);
    assert.equal(rowsOf(env)[0].error_code, "TAPIN_PROVIDER_INACTIVE");
  } finally { proxy.restore(); }
});

await test("استثنای غیرمنتظره داخل Adapter → نتیجه ناموفق + Audit (نه ۵۰۰ بدون رکورد)", async () => {
  const env = makeEnv({ mode: "online" });
  const realDb = env.DB;
  env.DB = { prepare(sql) { if (/SELECT config_json FROM shipping_providers/.test(sql)) throw new Error("D1 boom"); return realDb.prepare(sql); } };
  const proxy = installProxy(() => tapinOk(1_650_000));
  const res = await worker.fetch(new Request(`https://x.test/api/store/shipping-methods?${Q}`), env, {});
  proxy.restore();
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.unavailable.code, "TAPIN_ADAPTER_EXCEPTION");
  const c = env._raw.prepare("SELECT error_code FROM shipping_quote_history").all();
  assert.equal(c.length, 1);
  assert.equal(c[0].error_code, "TAPIN_ADAPTER_EXCEPTION");
});

await test("Multi-package: همچنان TAPIN_MULTI_PACKAGE_UNSUPPORTED، بدون تماس Proxy، و Audit ثبت می‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const data = await estimate(env, enc("city=ورامین&province=تهران&product_ids=1,2&quantities=1,1"));
    assert.equal(data.unavailable.code, "TAPIN_MULTI_PACKAGE_UNSUPPORTED");
    assert.equal(proxy.calls.length, 0);
    assert.equal(rowsOf(env)[0].error_code, "TAPIN_MULTI_PACKAGE_UNSUPPORTED");
  } finally { proxy.restore(); }
});

await test("موفق: دقیقاً یک رکورد success در Audit (و بدون Fallback داخلی)", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1_650_000));
  try {
    const data = await estimate(env, Q);
    assert.equal(data.source, "tapin");
    assert.equal(data.shipping_methods.length, 1);
    assert.equal(countOf(env), 1);
    assert.equal(rowsOf(env)[0].status, "success");
  } finally { proxy.restore(); }
});

// ---- ریشهٔ احتمالی «هیچ رکوردی ثبت نشد»: Schema واقعی Production می‌تواند CHECK پنهان داشته باشد ----
await test("CHECK پنهان روی calculation_mode: INSERT شکست می‌خورد ولی دیگر بی‌صدا نیست (Log + DDL + audit.ok=false در Preview)", async () => {
  const env = makeEnv({ mode: "online" });
  env._raw.exec(`
    DROP TABLE shipping_quote_history;
    CREATE TABLE shipping_quote_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_code TEXT NOT NULL,
      calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('table_rate','engine')),
      request_json TEXT, response_json TEXT, status TEXT, error_code TEXT, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  const proxy = installProxy(() => tapinOk(1_650_000));
  const log = silence();
  try {
    // مسیر عمومی مشتری: کار می‌کند (Audit شکسته مسیر اصلی را نمی‌شکند) و audit نشت نمی‌کند
    const data = await estimate(env, Q);
    assert.equal(data.shipping_methods[0].cost, 165000);
    assert.equal(countOf(env), 0);
    const joined = log.logs.join("\n");
    assert.match(joined, /INSERT failed/);
    assert.match(joined, /CHECK constraint failed/i);
    assert.match(joined, /calculation_mode IN/);
    assert.ok(!joined.includes(PROXY_KEY));
    assert.equal("audit" in data, false);

    // Admin Preview: نتیجه Audit صریحاً گزارش می‌شود
    const preview = await getShippingOptionsViaEngine(env, {
      cartItems: [{ productId: 1, quantity: 1 }], city: "ورامین", province: "تهران",
      internalOptionsFn: async () => [],
    });
    assert.equal(preview.audit.ok, false);
    assert.match(preview.audit.error, /CHECK constraint failed/i);
  } finally { proxy.restore(); log.restore(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
