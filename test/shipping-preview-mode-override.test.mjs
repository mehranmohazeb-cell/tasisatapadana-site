// =========================================================================
// تست پارامتر mode در Endpoint پیش‌نمایش Admin (مرحله ۱: تست موتور داخلی در
// کنار سیستم فعلی، بدون تغییر حالت زندهٔ D1)
// =========================================================================
// Worker واقعی (src/index.js) + D1 (node:sqlite) + Proxy موک‌شده. Round-trip
// واقعی با Tapin/VPS انجام نمی‌شود (Sandbox شبکه ندارد).
//
// اجرا:  node --no-warnings test/shipping-preview-mode-override.test.mjs
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
  return { DB: wrapD1(db), PROXY_API_KEY: PROXY_KEY, ADMIN_TOKEN: "admin-test-token", _raw: db };
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


const ADMIN = { "X-Admin-Token": "admin-test-token" };
async function preview(env, query, headers = ADMIN) {
  const res = await worker.fetch(new Request(`https://x.test/api/store/admin/shipping-engine-preview?${query}`, { headers }), env, {});
  return { status: res.status, data: await res.json() };
}
async function customerEstimate(env, query) {
  const res = await worker.fetch(new Request(`https://x.test/api/store/shipping-methods?${query}`), env, {});
  return res.json();
}
const liveMode = (env) => env._raw.prepare("SELECT shipping_calculation_mode AS m FROM site_settings WHERE id=1").get().m;
const historyCount = (env) => env._raw.prepare("SELECT COUNT(*) AS c FROM shipping_quote_history").get().c;
const ISF = "city=" + encodeURIComponent("اصفهان") + "&product_ids=1&quantities=1";
const VAR = "city=" + encodeURIComponent("ورامین") + "&province=" + encodeURIComponent("تهران") + "&product_ids=1&quantities=1";

console.log("Preview mode override — موتور داخلی کنار حالت زندهٔ online");

await test("A) live=online + preview mode=internal → خروجی موتور داخلی، بدون تماس شبکه و بدون ردیف Audit، حالت زنده دست‌نخورده", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1650000));
  try {
    const { status, data } = await preview(env, ISF + "&mode=internal");
    assert.equal(status, 200);
    assert.equal(data.mode, "internal");
    assert.equal(data.mode_override, true);
    assert.equal(data.live_mode, "online");
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].provider, "internal");
    assert.equal(data.results[0].cost, 30000);
    assert.equal(proxy.calls.length, 0);
    assert.equal(historyCount(env), 0);
    assert.equal(liveMode(env), "online");
  } finally { proxy.restore(); }
});

await test("B) preview بدون mode → رفتار قبلی (حالت زنده)، بدون کلید mode_override", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1650000));
  try {
    const { data } = await preview(env, VAR);
    assert.equal(data.mode, "online");
    assert.equal(data.mode_override, undefined);
    assert.equal(data.results[0].provider, "tapin");
    assert.equal(proxy.calls.length, 1);
  } finally { proxy.restore(); }
});

await test("C) mode نامعتبر → 400 INVALID_MODE", async () => {
  const env = makeEnv({ mode: "online" });
  const { status, data } = await preview(env, ISF + "&mode=bogus");
  assert.equal(status, 400);
  assert.equal(data.error, "INVALID_MODE");
});

await test("D) بدون X-Admin-Token → 401 (mode نمی‌تواند Preview را عمومی کند)", async () => {
  const env = makeEnv({ mode: "online" });
  const { status } = await preview(env, ISF + "&mode=internal", {});
  assert.equal(status, 401);
});

await test("E) Endpoint مشتری پارامتر mode را نادیده می‌گیرد و همچنان از حالت زنده (online → Tapin) می‌خواند", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => tapinOk(1650000));
  try {
    const data = await customerEstimate(env, VAR + "&mode=internal");
    assert.equal(data.mode, "online");
    assert.equal(data.source, "tapin");
    assert.equal(data.shipping_methods[0].id, "tapin");
    assert.equal(proxy.calls.length, 1);
  } finally { proxy.restore(); }
});

await test("F) live=online + preview mode=online_fallback_internal + شکست Tapin → Fallback داخلی با fell_back=true؛ حالت زنده دست‌نخورده", async () => {
  const env = makeEnv({ mode: "online" });
  const proxy = installProxy(() => ({ ok: false, status: 502, json: { ok: false, error: "UPSTREAM" } }));
  try {
    const { data } = await preview(env, ISF + "&mode=online_fallback_internal");
    assert.equal(data.mode, "online_fallback_internal");
    assert.equal(data.fell_back, true);
    assert.equal(data.results[0].provider, "internal");
    assert.equal(data.live_mode, "online");
    assert.equal(liveMode(env), "online");
  } finally { proxy.restore(); }
});

await test("G) موتور داخلی برای مقصد غیر اصفهان (فقط روش scope=city تعریف شده) → فهرست خالی، نه خطا", async () => {
  const env = makeEnv({ mode: "online" });
  const { data } = await preview(env, VAR + "&mode=internal");
  assert.equal(data.mode, "internal");
  assert.deepEqual(data.results, []);
});

await test("H) Rollback: PUT حالت زنده internal ← online برمی‌گردد و Estimate مشتری دوباره Tapin می‌شود", async () => {
  const env = makeEnv({ mode: "online" });
  const put = (mode) => worker.fetch(new Request("https://x.test/api/store/admin/shipping-calculation-mode", {
    method: "PUT", headers: { ...ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }), env, {}).then((r) => r.json());
  assert.equal((await put("internal")).ok, true);
  assert.equal(liveMode(env), "engine");
  assert.equal((await customerEstimate(env, ISF)).source, "internal");
  assert.equal((await put("online")).ok, true);
  assert.equal(liveMode(env), "online");
  const proxy = installProxy(() => tapinOk(1650000));
  try { assert.equal((await customerEstimate(env, VAR)).source, "tapin"); } finally { proxy.restore(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
