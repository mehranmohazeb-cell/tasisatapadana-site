// تست اصلاح پیام Freight (Route="freight") — Worker واقعی + D1 (node:sqlite)، Proxy موک‌شده.
// اجرا: node --no-warnings test/shipping-freight-message.test.mjs
// اجرا: node --no-warnings test/shipping-routing.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { isOfficialIsfahan, detectShippingDataSuspicions } from "../src/shipping-routing.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack || e.message}`); }
}
function wrapD1(db) {
  return { prepare(sql) {
    const stmt = () => db.prepare(sql);
    const wrap = (a) => ({
      first: async () => stmt().get(...a) ?? null,
      all: async () => ({ results: stmt().all(...a) }),
      run: async () => { const r = stmt().run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    });
    return { bind: (...a) => wrap(a), ...wrap([]) };
  } };
}
const KEY = "proxy-secret-key-should-never-leak";
const ADMIN = { "X-Admin-Token": "adm" };

// legacy=true → Migration مرحله ۲ اجرا نشده (Fail-Safe).
function makeEnv({ mode = "online", legacy = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE site_settings (id INTEGER PRIMARY KEY, store_status TEXT, services_status TEXT, store_updated_at TEXT, services_updated_at TEXT, shipping_calculation_mode TEXT);
    INSERT INTO site_settings (id, store_status, services_status, shipping_calculation_mode) VALUES (1,'open','open','${mode === "internal" ? "engine" : mode}');
    CREATE TABLE shipping_providers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, type TEXT, status TEXT, mode TEXT, fallback_provider_code TEXT, config_json TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    INSERT INTO shipping_providers (code,name,type,status,mode,fallback_provider_code,config_json,sort_order) VALUES
      ('internal','داخلی','internal','active','quote',NULL,NULL,10),
      ('tapin','تاپین','online','active','quote','internal','{"pay_type":1}',20);
    CREATE TABLE shipping_quote_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_code TEXT NOT NULL, calculation_mode TEXT NOT NULL, request_json TEXT, response_json TEXT, status TEXT, error_code TEXT, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE shipping_methods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, cost REAL, cost_type TEXT DEFAULT 'prepaid', active INTEGER DEFAULT 1, scope TEXT DEFAULT 'all', allowed_city TEXT, sort_order INTEGER DEFAULT 0, volumetric_divisor REAL);
    INSERT INTO shipping_methods (name,cost,cost_type,scope,allowed_city) VALUES ('پیک مشهد',30000,'prepaid','city','مشهد');
    CREATE TABLE shipping_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, default_packaging_profile_id INTEGER, updated_at TEXT${legacy ? "" : ", route_policy TEXT"});
    INSERT INTO shipping_classes (id,name) VALUES (1,'عادی'),(2,'حجیم/باربری');
    ${legacy ? "" : "UPDATE shipping_classes SET route_policy='freight' WHERE id=2; UPDATE shipping_classes SET route_policy='normal' WHERE id=1;"}
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, stock INTEGER, active INTEGER DEFAULT 1, weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, shipping_class_id INTEGER, packaging_profile_id INTEGER, package_length_cm REAL, package_width_cm REAL, package_height_cm REAL, package_weight_grams INTEGER, packaging_confidence TEXT${legacy ? "" : ", shipping_route_override TEXT"});
    INSERT INTO products (id,name,price,stock,weight_grams,package_length_cm,package_width_cm,package_height_cm,package_weight_grams,shipping_class_id) VALUES
      (1,'پکیج شوفاژ دیواری آدنا 24 کیلووات',112000000,5,36000,80,45,35,1500,2),
      (2,'شیر ماشین‌لباسشویی',500000,5,300,10,10,10,100,1),
      (3,'شیر برقی',400000,5,250,10,10,10,100,1),
      (4,'کالای بدون کلاس',100000,5,500,12,12,12,100,NULL);
    CREATE TABLE shipping_route_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT, changed_at TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_code TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT, province TEXT, city TEXT, street TEXT, sub_street TEXT, alley TEXT, plaque TEXT, unit TEXT, postal_code TEXT, address_note TEXT, latitude REAL, longitude REAL, total INTEGER, shipping_cost INTEGER, shipping_method_id INTEGER, shipping_method_name TEXT, shipping_is_cod INTEGER, payable_amount INTEGER, status TEXT, payment_status TEXT, created_at TEXT, updated_at TEXT${legacy ? "" : ", shipping_payment_mode TEXT, shipping_route TEXT, shipping_max_dispatch_days INTEGER"});
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, product_name TEXT, price INTEGER, quantity INTEGER, subtotal INTEGER);
    CREATE TABLE order_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE order_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER UNIQUE, created_at TEXT, is_read INTEGER DEFAULT 0);
  `);
  return { DB: wrapD1(db), PROXY_API_KEY: KEY, ADMIN_TOKEN: "adm", _raw: db };
}
// Proxy موک: calls = «Tapin واقعاً فراخوانی شد؟»
function installProxy(handler) {
  const calls = []; const orig = global.fetch;
  global.fetch = async (url, o) => { const body = JSON.parse(o.body); calls.push({ url: String(url), body }); const out = await handler(body); return { ok: out.ok !== false, status: out.status || 200, json: async () => out.json }; };
  return { calls, restore: () => (global.fetch = orig) };
}
const tapinOk = (rial) => ({ json: { ok: true, entries: { total_send_price: rial } } });
const tapinDown = () => ({ ok: false, status: 502, json: { message: "down" } });
const tapinThrows = () => { throw new Error("شبکه قطع"); };

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
async function estimate(env, o) { return (await worker.fetch(new Request(`https://x.test/api/store/shipping-methods?${q(o)}`), env, {})).json(); }
async function preview(env, o) { const r = await worker.fetch(new Request(`https://x.test/api/store/admin/shipping-engine-preview?${q(o)}`, { headers: ADMIN }), env, {}); return r.json(); }
async function adminCall(env, method, path, body) {
  const r = await worker.fetch(new Request(`https://x.test/api/store/admin/shipping-routing${path}`, { method, headers: { ...ADMIN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: r.status, data: await r.json() };
}
async function checkout(env, { city, province, items, method, expected }) {
  const oe = console.error; console.error = () => {};
  try {
    const r = await worker.fetch(new Request("https://x.test/api/store/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      customer: { name: "علی رضایی", mobile: "09121234567", province, city, street: "خیابان اصلی", sub_street: "", alley: "", plaque: "12", unit: "", postal_code: "1234567890", address_note: "" },
      items, shipping_method_id: method, expected_shipping_cost: expected }) }), env, {});
    return { status: r.status, data: await r.json() };
  } finally { console.error = oe; }
}
const MASHHAD = { city: "مشهد", province: "خراسان رضوی" };
const TEHRAN = { city: "تهران", province: "تهران" };
const VARAMIN = { city: "ورامین", province: "تهران" };
const ISF = { city: "اصفهان", province: "اصفهان" };
const PKG = 1, VALVE = 2, VALVE2 = 3;
const ids = (...a) => ({ product_ids: a.join(","), quantities: a.map(() => 1).join(",") });

const FREIGHT_MSG = "این محصول به دلیل ابعاد یا وزن، توسط باربری و به‌صورت پس‌کرایه ارسال می‌شود.";
const OLD_MSG_PART = "روش ارسالی در دسترس نیست";
const FREIGHT_NAME = "باربری (پس‌کرایه)";

console.log("پیام Freight");
await test("buildFreightOption: پیام دقیق، عنوان بدون تغییر، cost_known/payment_mode/cost_type بدون تغییر", async () => {
  const { buildFreightOption } = await import("../src/shipping-routing.js");
  const o = buildFreightOption();
  assert.equal(o.customer_message, FREIGHT_MSG);
  assert.equal(o.name, FREIGHT_NAME);
  assert.equal(o.cost, 0); assert.equal(o.cost_known, false);
  assert.equal(o.payment_mode, "receiver_pays"); assert.equal(o.cost_type, "cod");
  assert.equal(o.route, "freight"); assert.equal(o.max_dispatch_days, 3);
  assert.ok(!o.customer_message.includes(OLD_MSG_PART));
});
await test("Estimate (/shipping-methods) برای پکیج غیرعادی در تهران/مشهد/ورامین در هر ۳ حالت: پیام دقیق، بدون «روشی در دسترس نیست»، بدون Tapin", async () => {
  for (const mode of ["internal", "online", "online_fallback_internal"]) {
    for (const dest of [TEHRAN, MASHHAD, VARAMIN]) {
      const env = makeEnv({ mode }); const p = installProxy(() => tapinOk(1));
      try {
        const d = await estimate(env, { ...dest, ...ids(PKG) });
        assert.equal(d.route, "freight", `${mode}/${dest.city}`);
        assert.equal(d.shipping_methods.length, 1);
        assert.equal(d.shipping_methods[0].customer_message, FREIGHT_MSG);
        assert.equal(d.shipping_methods[0].name, FREIGHT_NAME);
        assert.equal(d.unavailable, null);
        assert.ok(!JSON.stringify(d).includes(OLD_MSG_PART));
        assert.equal(p.calls.length, 0);
      } finally { p.restore(); }
    }
  }
});
await test("سبد مخلوط (پکیج + شیر) و Override محصول → همان پیام Freight", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try {
    const d = await estimate(env, { ...TEHRAN, product_ids: `${PKG},${VALVE}`, quantities: "1,1" });
    assert.equal(d.route, "freight"); assert.equal(d.shipping_methods[0].customer_message, FREIGHT_MSG);
    await adminCall(env, "PUT", "/product", { product_id: VALVE, override: "freight" });
    const d2 = await estimate(env, { ...VARAMIN, ...ids(VALVE) });
    assert.equal(d2.route, "freight"); assert.equal(d2.shipping_methods[0].customer_message, FREIGHT_MSG);
  } finally { p.restore(); }
});
await test("Checkout نهایی (Route=freight): ثبت موفق، شناسهٔ freight و عنوان روش ذخیره‌شده بدون تغییر، پیام قدیمی در پاسخ نیست", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try {
    const r = await checkout(env, { ...TEHRAN, items: [{ product_id: PKG, quantity: 1 }], method: "freight" });
    assert.ok(!JSON.stringify(r.data).includes(OLD_MSG_PART), JSON.stringify(r.data));
    if (r.data.ok) {
      const o = env._raw.prepare("SELECT shipping_route, shipping_payment_mode FROM orders ORDER BY id DESC LIMIT 1").get();
      assert.equal(o.shipping_route, "freight"); assert.equal(o.shipping_payment_mode, "receiver_pays");
    }
    assert.equal(p.calls.length, 0);
  } finally { p.restore(); }
});
await test("Regression: مسیر عادی و پیک اصفهان پیام خودشان را حفظ کرده‌اند", async () => {
  const { CUSTOMER_MESSAGES } = await import("../src/shipping-routing.js");
  assert.equal(CUSTOMER_MESSAGES.normal, "سفارش شما حداکثر تا ۳ روز از فروشگاه ارسال می‌شود.");
  assert.equal(CUSTOMER_MESSAGES.isfahan_courier, "ارسال با پیک موتوری و رایگان است. سفارش شما حداکثر تا ۳ روز از فروشگاه ارسال می‌شود.");
});
await test("checkout.html: برای Route=freight پیام قدیمی انتخاب نمی‌شود (بررسی منبع)", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../public/store/checkout.html", import.meta.url), "utf8");
  assert.ok(html.includes('data.route === "freight"'));
  assert.ok(html.includes(FREIGHT_MSG));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
