// =========================================================================
// تست Routing قطعی ارسال — مرحله ۲ (سناریوهای A تا L + Override + Fail-Safe + یکسانی Checkout)
// Worker واقعی (src/index.js) با D1 (node:sqlite) و Proxy موک‌شده؛ «Tapin فراخوانی شد؟» از
// شمارندهٔ تماس‌های fetch ثابت می‌شود، نه از نتیجهٔ UI. شبکهٔ واقعی در Sandbox نیست.
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

console.log("0) اثبات رفتار «قبلی»: پکیج بدون کلاس باربری در مشهد، mode=online_fallback_internal");
await test("پکیج (کلاس عادی/بدون کلاس) → ابتدا Tapin فراخوانی می‌شود، بعد Fallback داخلی (رفتار قبلی؛ طبقه‌بندی وابسته به شکست Tapin)", async () => {
  const env = makeEnv({ mode: "online_fallback_internal" });
  env._raw.exec("UPDATE products SET shipping_class_id = 1 WHERE id = 1");
  const p = installProxy(tapinDown);
  try {
    const d = await estimate(env, { ...VARAMIN, ...ids(PKG) }); // شهری که Internal تعرفه ندارد (مثل مشهد در تست زنده)
    assert.equal(p.calls.length, 1, "Tapin اول صدا زده شده");
    assert.equal(d.fell_back, true);
    assert.deepEqual(d.shipping_methods, []); // مشهد تعرفه داخلی ندارد → «روشی در دسترس نیست»
  } finally { p.restore(); }
});

console.log("A/D) کالای عادی → Tapin، مستقل از Internal");
await test("A) عادی + ورامین → Tapin (۱ تماس، route=normal)", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try { const d = await estimate(env, { ...VARAMIN, ...ids(VALVE) });
    assert.equal(p.calls.length, 1); assert.equal(d.source, "tapin"); assert.equal(d.route, "normal");
    assert.equal(d.shipping_methods[0].cost, 90000); assert.equal(d.shipping_methods[0].payment_mode, "prepaid");
  } finally { p.restore(); }
});
await test("D) عادی + شهری که Internal تعرفه ندارد (مشهد) → Tapin مستقل کار می‌کند", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1290000));
  try { const d = await estimate(env, { ...MASHHAD, ...ids(VALVE) });
    assert.equal(p.calls.length, 1); assert.equal(d.shipping_methods[0].cost, 129000);
  } finally { p.restore(); }
});

console.log("B/C/E) کالای غیرعادی → Internal/Freight، هرگز Tapin");
await test("B) غیرعادی (پکیج) + مشهد → باربری/پس‌کرایه، Tapin صفر تماس", async () => {
  const env = makeEnv({ mode: "online_fallback_internal" }); const p = installProxy(() => tapinOk(1));
  try { const d = await estimate(env, { ...MASHHAD, ...ids(PKG) });
    assert.equal(p.calls.length, 0); assert.equal(d.route, "freight"); assert.equal(d.shipping_methods.length, 1);
    const m = d.shipping_methods[0];
    assert.equal(m.payment_mode, "receiver_pays"); assert.equal(m.cost_type, "cod"); assert.equal(m.cost_known, false);
    assert.equal(m.max_dispatch_days, 3); assert.equal(d.tapin_called, undefined);
    assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM shipping_quote_history").get().c, 0);
  } finally { p.restore(); }
});
await test("C) غیرعادی + شهر بدون تعرفهٔ Internal (تهران) در هر ۳ حالت → باربری؛ نه Tapin و نه «روشی در دسترس نیست»", async () => {
  for (const mode of ["internal", "online", "online_fallback_internal"]) {
    const env = makeEnv({ mode }); const p = installProxy(() => tapinOk(1));
    try { const d = await estimate(env, { ...TEHRAN, ...ids(PKG) });
      assert.equal(d.shipping_methods[0].id, "freight", mode); assert.equal(p.calls.length, 0, mode); assert.equal(d.unavailable, null, mode);
    } finally { p.restore(); }
  }
});
await test("E) غیرعادی + خطای مصنوعی Tapin (502 / Exception / موفق) → نتیجه دقیقاً یکسان؛ Routing به Tapin وابسته نیست", async () => {
  const outs = [];
  for (const h of [tapinDown, tapinThrows, () => tapinOk(5000000)]) {
    const env = makeEnv({ mode: "online_fallback_internal" }); const p = installProxy(h);
    try { const d = await estimate(env, { ...MASHHAD, ...ids(PKG) }); outs.push(JSON.stringify(d.shipping_methods)); assert.equal(p.calls.length, 0); } finally { p.restore(); }
  }
  assert.equal(new Set(outs).size, 1);
});

console.log("F) خطای Tapin برای کالای عادی");
await test("F) عادی + خطای Tapin → Classification تغییر نمی‌کند: online=«در دسترس نیست»، fallback=Internal با fell_back؛ هیچ‌وقت باربری نمی‌شود", async () => {
  let env = makeEnv({ mode: "online" }); let p = installProxy(tapinDown);
  try { const d = await estimate(env, { ...MASHHAD, ...ids(VALVE) });
    assert.equal(d.route, "normal"); assert.deepEqual(d.shipping_methods, []); assert.ok(d.unavailable?.message); assert.equal(p.calls.length, 1);
  } finally { p.restore(); }
  env = makeEnv({ mode: "online_fallback_internal" }); p = installProxy(tapinDown);
  try { const d = await estimate(env, { ...MASHHAD, ...ids(VALVE) });
    assert.equal(d.route, "normal"); assert.equal(d.fell_back, true); assert.equal(d.shipping_methods[0].name, "پیک مشهد");
  } finally { p.restore(); }
});

console.log("G/H) سبد");
await test("G) سبد عادی+غیرعادی → کل سبد باربری (بدون Split)، Tapin صفر؛ در Estimate و Preview یکسان", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try {
    const d = await estimate(env, { ...VARAMIN, ...ids(VALVE, PKG) });
    assert.equal(d.shipping_methods[0].id, "freight"); assert.equal(p.calls.length, 0);
    const pv = await preview(env, { ...VARAMIN, ...ids(VALVE, PKG) });
    assert.equal(pv.route, "freight"); assert.equal(pv.tapin_called, false);
    assert.equal(pv.route_items.find((i) => i.product_id === PKG).abnormal, true);
  } finally { p.restore(); }
});
await test("H) سبد چند کالای عادی → همان رفتار فعلی Tapin (چندکالایی هنوز پشتیبانی نمی‌شود، بدون Regression)", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try { const d = await estimate(env, { ...VARAMIN, ...ids(VALVE, VALVE2) });
    assert.equal(d.route, "normal"); assert.equal(d.unavailable.code, "TAPIN_MULTI_PACKAGE_UNSUPPORTED"); assert.equal(p.calls.length, 0);
  } finally { p.restore(); }
});

console.log("I/J/K/L) محدودهٔ رسمی اصفهان");
await test("I) اصفهان + عادی → فقط پیک موتوری رایگان، Tapin صفر", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try { const d = await estimate(env, { ...ISF, ...ids(VALVE) });
    assert.equal(d.shipping_methods.length, 1); const m = d.shipping_methods[0];
    assert.equal(m.name, "پیک موتوری"); assert.equal(m.cost, 0); assert.equal(m.payment_mode, "free"); assert.equal(m.cost_type, "prepaid"); assert.equal(m.cost_known, true);
    assert.equal(p.calls.length, 0);
    assert.ok(!/فوری|سریع/.test(m.customer_message), "رایگان ≠ فوری");
    assert.ok(m.customer_message.includes("۳ روز"));
  } finally { p.restore(); }
});
await test("J) اصفهان + غیرعادی / سبد ترکیبی → فقط پیک موتوری رایگان (روش داخلی «پیک مشهد» هم نمی‌آید)", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try { for (const items of [ids(PKG), ids(VALVE, PKG)]) {
    const d = await estimate(env, { ...ISF, ...items });
    assert.equal(d.shipping_methods.length, 1); assert.equal(d.shipping_methods[0].id, "isfahan_courier"); assert.equal(d.route, "isfahan_courier");
  } assert.equal(p.calls.length, 0); } finally { p.restore(); }
});
await test("K) بهارستان / شاهین‌شهر / خمینی‌شهر (حتی با استان اصفهان) اصفهان نیستند", async () => {
  for (const city of ["بهارستان", "شاهین‌شهر", "خمینی‌شهر", "نجف‌آباد"]) assert.equal(isOfficialIsfahan(city, "اصفهان"), false, city);
  assert.equal(isOfficialIsfahan("اصفهان", "اصفهان"), true);
  assert.equal(isOfficialIsfahan("اصفهان", ""), true); // برآورد صفحه محصول فقط شهر می‌فرستد
  assert.equal(isOfficialIsfahan("اصفهان", "تهران"), false);
  assert.equal(isOfficialIsfahan("اصفهان ", "اصفهان"), true); // فاصلهٔ اضافه
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try { const d = await estimate(env, { city: "بهارستان", province: "اصفهان", ...ids(VALVE) });
    assert.equal(d.route, "normal"); assert.equal(d.shipping_methods[0].id, "tapin");
    const f = await estimate(env, { city: "خمینی‌شهر", province: "اصفهان", ...ids(PKG) });
    assert.equal(f.shipping_methods[0].id, "freight");
  } finally { p.restore(); }
});
await test("L) تهران و سایر شهرها: عادی → Tapin، غیرعادی → باربری", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try { assert.equal((await estimate(env, { ...TEHRAN, ...ids(VALVE) })).shipping_methods[0].id, "tapin");
    assert.equal((await estimate(env, { ...TEHRAN, ...ids(PKG) })).shipping_methods[0].id, "freight"); } finally { p.restore(); }
});

console.log("Override مدیریتی / Audit / برگشت");
await test("Override محصول: پکیج→normal ⇒ Tapin؛ شیر→freight ⇒ باربری؛ حذف Override = برگشت؛ Audit ثبت", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try {
    assert.equal((await adminCall(env, "PUT", "/product", { product_id: PKG, override: "normal" })).data.ok, true);
    assert.equal((await estimate(env, { ...VARAMIN, ...ids(PKG) })).shipping_methods[0].id, "tapin");
    assert.equal((await adminCall(env, "PUT", "/product", { product_id: VALVE, override: "freight" })).data.ok, true);
    assert.equal((await estimate(env, { ...VARAMIN, ...ids(VALVE) })).shipping_methods[0].id, "freight");
    await adminCall(env, "PUT", "/product", { product_id: PKG, override: null });
    assert.equal((await estimate(env, { ...VARAMIN, ...ids(PKG) })).shipping_methods[0].id, "freight");
    const a = (await adminCall(env, "GET", "/audit")).data.audit;
    assert.equal(a.length, 3); assert.equal(a[0].old_value, "normal"); assert.equal(a[0].new_value, null);
  } finally { p.restore(); }
});
await test("route_policy کلاس حمل: تغییر کلاس به freight تمام محصولات آن را باربری می‌کند و قابل برگشت است", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try {
    await adminCall(env, "PUT", "/class", { id: 1, route_policy: "freight" });
    assert.equal((await estimate(env, { ...VARAMIN, ...ids(VALVE) })).shipping_methods[0].id, "freight");
    await adminCall(env, "PUT", "/class", { id: 1, route_policy: "normal" });
    assert.equal((await estimate(env, { ...VARAMIN, ...ids(VALVE) })).shipping_methods[0].id, "tapin");
  } finally { p.restore(); }
});
await test("Admin: بدون توکن 401؛ مقدار نامعتبر 400؛ لیست محصولات مسیر مؤثر + Flag نشان می‌دهد", async () => {
  const env = makeEnv();
  const r = await worker.fetch(new Request("https://x.test/api/store/admin/shipping-routing"), env, {});
  assert.equal(r.status, 401);
  assert.equal((await adminCall(env, "PUT", "/product", { product_id: 1, override: "express" })).status, 400);
  const list = (await adminCall(env, "GET", "?filter=all")).data;
  assert.equal(list.rules.max_dispatch_days, 3);
  assert.equal(list.products.find((x) => x.id === PKG).effective_route_outside_isfahan, "freight");
  assert.ok(list.products.find((x) => x.id === 4).flags.includes("NO_SHIPPING_CLASS"));
});

console.log("Flag داده‌های مشکوک ≠ Routing");
await test("Flag فقط هشدار است: محصول دارای Flag مسیر عادی خود را حفظ می‌کند", async () => {
  const flags = detectShippingDataSuspicions({ id: 9, weight_grams: 5000, package_weight_grams: 1000, length_cm: 50, width_cm: 40, height_cm: 30, package_length_cm: 10, package_width_cm: 10, package_height_cm: 10 });
  assert.ok(flags.includes("PACKAGE_WEIGHT_BELOW_PRODUCT_WEIGHT")); assert.ok(flags.includes("PACKAGE_SMALLER_THAN_PRODUCT"));
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try { const d = await estimate(env, { ...VARAMIN, ...ids(4) }); assert.equal(d.route, "normal"); assert.equal(d.shipping_methods[0].id, "tapin"); } finally { p.restore(); }
});
await test("هیچ آستانهٔ عددی وزن/ابعاد/قیمت در لایهٔ Routing نیست: پکیج ۳۶ کیلویی ۱۱۲ میلیونی با کلاس عادی، عادی می‌ماند", async () => {
  const env = makeEnv(); env._raw.exec("UPDATE products SET shipping_class_id = 1 WHERE id = 1");
  const p = installProxy(() => tapinOk(900000));
  try { const d = await estimate(env, { ...VARAMIN, ...ids(PKG) }); assert.equal(d.route, "normal"); assert.equal(p.calls.length, 1); } finally { p.restore(); }
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../src/shipping-routing.js", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/(weight_grams|length_cm|price|cost)\s*[<>]=?\s*\d/.test(code));
});

console.log("Fail-Safe: Migration مرحلهٔ ۲ هنوز اجرا نشده");
await test("بدون ستون‌های route: همه عادی (رفتار قبلی)، Isfahan همچنان پیک رایگان، بدون خطای ۵۰۰", async () => {
  const env = makeEnv({ legacy: true }); const p = installProxy(() => tapinOk(900000));
  try { const d = await estimate(env, { ...VARAMIN, ...ids(PKG) }); assert.equal(d.route, "normal"); assert.equal(d.ok, true);
    assert.equal((await estimate(env, { ...ISF, ...ids(PKG) })).shipping_methods[0].id, "isfahan_courier"); } finally { p.restore(); }
});

console.log("Product → Cart → Checkout → Order یکسان");
await test("Checkout باربری: Estimate = Checkout؛ سفارش پس‌کرایه (≠ رایگان) با Snapshot؛ مبلغ آنلاین بدون حمل؛ Tapin صفر", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try {
    const est = await estimate(env, { ...VARAMIN, ...ids(PKG) });
    const { status, data } = await checkout(env, { ...VARAMIN, items: [{ id: PKG, quantity: 1 }], method: est.shipping_methods[0].id });
    assert.equal(status, 201, JSON.stringify(data));
    const o = env._raw.prepare("SELECT * FROM orders").get();
    assert.equal(o.shipping_method_id, null); assert.equal(o.shipping_is_cod, 1); assert.equal(o.shipping_payment_mode, "receiver_pays");
    assert.equal(o.shipping_route, "freight"); assert.equal(o.shipping_max_dispatch_days, 3);
    assert.equal(o.payable_amount, 112000000); assert.equal(data.shipping_payment_mode, "receiver_pays");
    assert.equal(p.calls.length, 0);
  } finally { p.restore(); }
});
await test("Checkout اصفهان: پیک رایگان → shipping_payment_mode=free (متفاوت از receiver_pays) و shipping_is_cod=0", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(1));
  try { const { status, data } = await checkout(env, { ...ISF, items: [{ id: PKG, quantity: 1 }], method: "isfahan_courier" });
    assert.equal(status, 201, JSON.stringify(data));
    const o = env._raw.prepare("SELECT * FROM orders").get();
    assert.equal(o.shipping_payment_mode, "free"); assert.equal(o.shipping_is_cod, 0); assert.equal(o.shipping_cost, 0); assert.equal(o.shipping_route, "isfahan_courier");
    assert.equal(p.calls.length, 0);
  } finally { p.restore(); }
});
await test("Checkout نمی‌تواند روش نامجاز را تحمیل کند: انتخاب tapin برای سبد غیرعادی یا روش داخلی در اصفهان رد می‌شود (سفارش و کسر موجودی ندارد)", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try {
    let r = await checkout(env, { ...VARAMIN, items: [{ id: PKG, quantity: 1 }], method: "tapin", expected: 90000 });
    assert.equal(r.status, 400); assert.equal(r.data.error, "INVALID_SHIPPING_METHOD");
    r = await checkout(env, { ...ISF, items: [{ id: VALVE, quantity: 1 }], method: 1 });
    assert.equal(r.status, 400);
    assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM orders").get().c, 0);
    assert.equal(env._raw.prepare("SELECT stock FROM products WHERE id=1").get().stock, 5);
    assert.equal(p.calls.length, 0);
  } finally { p.restore(); }
});
await test("Checkout عادی Tapin همچنان کار می‌کند (بدون Regression) و نام مشتری‌پسند بدون «Tapin»", async () => {
  const env = makeEnv(); const p = installProxy(() => tapinOk(900000));
  try { const { status, data } = await checkout(env, { ...VARAMIN, items: [{ id: VALVE, quantity: 1 }], method: "tapin", expected: 90000 });
    assert.equal(status, 201, JSON.stringify(data)); assert.equal(data.shipping_method_name, "ارسال پستی");
    assert.equal(env._raw.prepare("SELECT shipping_payment_mode m FROM orders").get().m, "prepaid");
  } finally { p.restore(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
