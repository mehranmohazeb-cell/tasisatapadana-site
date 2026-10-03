// =========================================================================
// تست Stage C — حذف نمایش/وابستگی نمایشی فیلدهای قدیمی ارسال محصول
// (products.shipping_cost / shipping_method / shipping_time)
// Worker واقعی (src/index.js) + D1 آزمایشی (node:sqlite) + صفحهٔ واقعی public/store/product.html به‌عنوان shell.
// اجرا: node --no-warnings test/admin-shipping-stage-c.test.mjs
// (رفتار UI در Chromium واقعی: test/browser/stage-c-legacy-fields.browser.py)
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../src/index.js";

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
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex");
const SHELL = read("../public/store/product.html");
const ADMIN = { "X-Admin-Token": "adm" };

// مقادیر قدیمی «گمراه‌کننده» که نباید هرگز به HTML/JSON عمومی برسند.
const LEGACY_COST = 987654, LEGACY_METHOD = "روش-قدیمی-تست", LEGACY_TIME = "زمان-قدیمی-تست";

function makeEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, description TEXT, price INTEGER, image TEXT, stock INTEGER, active INTEGER DEFAULT 1,
      brand TEXT, model TEXT, sku TEXT, compare_at_price INTEGER, shipping_cost INTEGER, shipping_method TEXT, shipping_time TEXT,
      warranty_months INTEGER, warranty_provider TEXT, return_days INTEGER, category_id INTEGER,
      shipping_class_id INTEGER, weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, packaging_profile_id INTEGER,
      package_length_cm REAL, package_width_cm REAL, package_height_cm REAL, package_weight_grams INTEGER, packaging_confidence TEXT, shipping_route_override TEXT);
    -- محصول ۱: داده قدیمی ارسال دارد؛ محصول ۲: NULL (پیش‌فرض‌های «رایگان/پست پیشتاز/۳ روز کاری» سابقاً از اینجا می‌آمد)
    INSERT INTO products (id,name,slug,description,price,image,stock,active,brand,model,sku,warranty_months,return_days,shipping_cost,shipping_method,shipping_time,shipping_class_id,weight_grams,length_cm,width_cm,height_cm,shipping_route_override)
      VALUES (1,'پکیج تست','pkg-test','<p>توضیح</p>',5000000,'/img/a.jpg',3,1,'برند','مدل','SKU1',12,7,${LEGACY_COST},'${LEGACY_METHOD}','${LEGACY_TIME}',2,36000,46,24,69,'freight');
    INSERT INTO products (id,name,slug,description,price,image,stock,active,brand,model,sku,warranty_months,return_days)
      VALUES (2,'رادیاتور تست','rad-test','<p>x</p>',1000000,'/img/b.jpg',5,1,'برند','مدل','SKU2',NULL,NULL);
    CREATE TABLE product_images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, image TEXT, alt TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE product_specs (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, label TEXT, value TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE shipping_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, default_packaging_profile_id INTEGER, route_policy TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO shipping_classes (id,name,route_policy) VALUES (2,'پکیج و آبگرمکن','normal');
  `);
  const ASSETS = { fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/store/product.html") return new Response(SHELL, { headers: { "content-type": "text/html; charset=UTF-8" } });
    return new Response("not found", { status: 404 });
  } };
  return { DB: wrapD1(db), ADMIN_TOKEN: "adm", ASSETS, _raw: db };
}
async function http(env, method, path, body, headers = {}) {
  const r = await worker.fetch(new Request(`https://x.test${path}`, { method, headers: { ...headers, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, {});
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: r.status, text, data };
}
const row = (env, id) => ({ ...env._raw.prepare("SELECT * FROM products WHERE id=?").get(id) });
const LEGACY_TEXTS = ["هزینه ارسال:", "روش ارسال:", "زمان ارسال:", "پست پیشتاز", "۳ روز کاری", "product-shipping-info", LEGACY_METHOD, LEGACY_TIME];

console.log("— SSR (HTML عمومی محصول) —");

await test("SSR: بلوک قدیمی ارسال تزریق نمی‌شود (نه مقدار قدیمی D1 و نه پیش‌فرض «رایگان/پست پیشتاز/۳ روز کاری»)", async () => {
  const env = makeEnv();
  for (const slug of ["pkg-test", "rad-test"]) {
    const r = await http(env, "GET", `/store/product/${slug}`);
    assert.equal(r.status, 200, slug);
    const ssrPart = r.text.slice(r.text.indexOf('id="product-detail"'), r.text.indexOf('id="product-detail"') + 4000);
    assert.ok(ssrPart.includes("پکیج تست") || ssrPart.includes("رادیاتور تست"), "SSR واقعاً اجرا شده");
    for (const t of LEGACY_TEXTS) assert.ok(!ssrPart.includes(t), `نباید در SSR باشد: ${t} (${slug})`);
    assert.ok(!r.text.includes(String(LEGACY_COST)) && !r.text.includes("987"), "مبلغ قدیمی در HTML نیست");
  }
});

await test("SSR: بخش‌های معتبر دیگر سالم می‌مانند (نام، قیمت، برند/مدل، گارانتی، ضمانت بازگشت)", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/store/product/pkg-test");
  assert.match(r.text, /پکیج تست/);
  assert.match(r.text, /ضمانت بازگشت/);
  assert.match(r.text, /ماه گارانتی/);
  assert.match(r.text, /برند/);
});

await test("SSR: برآوردگر واقعی ارسال (شهر + /shipping-methods) در shell دست‌نخورده است", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/store/product/pkg-test");
  assert.ok(r.text.includes("shipping-estimator-container"));
  assert.ok(r.text.includes("برآورد هزینه ارسال"));
  assert.ok(r.text.includes("/shipping-methods?city="));
});

console.log("— SEO / JSON-LD —");

await test("JSON-LD: هیچ مقدار قدیمی ارسال وارد Structured Data نمی‌شود و فیلدهای معتبر حفظ شده‌اند", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/store/product/pkg-test");
  const m = r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD وجود دارد");
  const raw = m[1];
  const ld = JSON.parse(raw);
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.name, "پکیج تست");
  assert.equal(ld.offers["@type"], "Offer");
  assert.equal(ld.offers.price, "5000000");
  assert.equal(ld.offers.priceCurrency, "IRR");
  assert.ok(ld.offers.availability.endsWith("InStock"));
  assert.ok(ld.offers.hasMerchantReturnPolicy, "سیاست بازگشت حفظ شده");
  assert.equal(ld.sku, "SKU1");
  for (const t of [...LEGACY_TEXTS, "shippingDetails", "shippingRate", "OfferShippingDetails", String(LEGACY_COST)]) assert.ok(!raw.includes(t), `JSON-LD نباید داشته باشد: ${t}`);
  // canonical/meta همچنان تولید می‌شود
  assert.match(r.text, /<link rel="canonical"/);
  assert.match(r.text, /<meta name="description"/);
});

console.log("— API عمومی —");

await test("GET /api/store/products/:slug: فیلدهای قدیمی (و پیش‌فرض‌های گمراه‌کننده) برنمی‌گردد؛ بقیهٔ قرارداد سالم", async () => {
  const env = makeEnv();
  for (const slug of ["pkg-test", "rad-test"]) {
    const r = await http(env, "GET", `/api/store/products/${slug}`);
    assert.equal(r.status, 200);
    const p = r.data.product || r.data;
    for (const k of ["shipping_cost", "shipping_method", "shipping_time"]) assert.ok(!(k in p), `کلید ${k} نباید باشد (${slug})`);
    for (const k of ["id", "name", "slug", "price", "stock", "brand", "model", "sku", "compare_at_price", "in_stock", "discount_active", "has_warranty", "has_return_policy", "canonical_url"]) assert.ok(k in p, `کلید ${k} باید بماند`);
  }
});

await test("GET /api/store/products (لیست عمومی): shipping_cost قدیمی برنمی‌گردد؛ بقیه سالم", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/api/store/products");
  assert.equal(r.status, 200);
  const list = r.data.products || r.data;
  assert.ok(list.length >= 2);
  for (const p of list) {
    assert.ok(!("shipping_cost" in p));
    for (const k of ["id", "name", "slug", "price", "stock"]) assert.ok(k in p);
  }
});

console.log("— Admin API: حفظ داده + عدم نوشتن ستون‌های قدیمی —");

// Stage D: ادمین GET دیگر این ۳ ستون را برنمی‌گرداند (در Stage C عمداً باقی مانده بود). ستون‌ها در D1 هستند و مقدارشان دست‌نخورده.
await test("لیست ادمین (Stage D): سه کلید قدیمی در پاسخ نیست ولی داده‌ی D1 دست‌نخورده است", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/api/store/products?page=1&limit=20", null, ADMIN);
  assert.equal(r.status, 200);
  const p = (r.data.products || []).find((x) => x.id === 1);
  for (const k of ["shipping_cost", "shipping_method", "shipping_time"]) assert.ok(!(k in p), k);
  const d1 = row(env, 1);
  assert.equal(d1.shipping_cost, LEGACY_COST); assert.equal(d1.shipping_method, LEGACY_METHOD); assert.equal(d1.shipping_time, LEGACY_TIME);
});

await test("PUT محصول (فرم جدید بدون سه فیلد): داده‌های قدیمی D1 پاک/NULL نمی‌شوند", async () => {
  const env = makeEnv();
  const r = await http(env, "PUT", "/api/store/products", { id: 1, name: "پکیج تست ویرایش‌شده", slug: "pkg-test", description: "<p>جدید</p>", price: 5100000, stock: 4, active: true, shipping_class_id: 2, weight_grams: 36000, length_cm: 46, width_cm: 24, height_cm: 69 }, ADMIN);
  assert.equal(r.status, 200, r.text);
  const p = row(env, 1);
  assert.equal(p.name, "پکیج تست ویرایش‌شده");
  assert.equal(p.price, 5100000);
  assert.equal(p.shipping_cost, LEGACY_COST);
  assert.equal(p.shipping_method, LEGACY_METHOD);
  assert.equal(p.shipping_time, LEGACY_TIME);
  assert.equal(p.shipping_route_override, "freight"); // Override مستقل است و با ذخیرهٔ محصول دست نمی‌خورد
});

await test("PUT قدیمی که هنوز سه فیلد را می‌فرستد: نادیده گرفته می‌شود (نوشتن در ستون‌های Archive متوقف)", async () => {
  const env = makeEnv();
  const r = await http(env, "PUT", "/api/store/products", { id: 1, name: "x", slug: "pkg-test", description: "", price: 1, stock: 1, active: true, shipping_cost: 5, shipping_method: "تغییر", shipping_time: "تغییر" }, ADMIN);
  assert.equal(r.status, 200, r.text);
  const p = row(env, 1);
  assert.equal(p.shipping_cost, LEGACY_COST); assert.equal(p.shipping_method, LEGACY_METHOD); assert.equal(p.shipping_time, LEGACY_TIME);
});

await test("POST محصول جدید: ایجاد می‌شود و ستون‌های قدیمی NULL می‌مانند (حتی اگر کلاینت قدیمی بفرستد)", async () => {
  const env = makeEnv();
  const r = await http(env, "POST", "/api/store/products", { name: "جدید", slug: "new-one", description: "", price: 100, stock: 1, active: true, shipping_cost: 77, shipping_method: "m", shipping_time: "t" }, ADMIN);
  assert.equal(r.status, 201, r.text);
  const p = row(env, r.data.product_id);
  assert.equal(p.name, "جدید");
  assert.equal(p.shipping_cost, null); assert.equal(p.shipping_method, null); assert.equal(p.shipping_time, null);
});

await test("احراز هویت نوشتن محصول سر جایش است (۴۰۱ بدون توکن)", async () => {
  const env = makeEnv();
  assert.equal((await http(env, "PUT", "/api/store/products", { id: 1, name: "x", price: 1, stock: 1 })).status, 401);
  assert.equal((await http(env, "POST", "/api/store/products", { name: "x", slug: "y", price: 1, stock: 1 })).status, 401);
  assert.equal(row(env, 1).name, "پکیج تست");
});

console.log("— UI (بررسی منبع) —");

await test("Product Admin: سه فیلد قدیمی نه در HTML و نه در JS؛ بخش‌های Stage A/B سر جایش", async () => {
  const html = read("../public/admin/products/index.html"), js = read("../public/admin/products/products.js");
  for (const id of ["product-shipping-cost", "product-shipping-method", "product-shipping-time"]) { assert.ok(!html.includes(id), id); assert.ok(!js.includes(id), id); }
  // \b: «shipping_method_id» (Product Shipping Rates، جدول shipping_methods) و «shipping_methods» در کامنت، ستون قدیمی نیستند.
  for (const k of ["shipping_cost", "shipping_method", "shipping_time"]) assert.ok(!new RegExp(`\\b${k}\\b`).test(js), `products.js: ${k}`);
  for (const id of ["product-shipping-class", "shipping-summary-box", "shipping-summary-body", "product-packaging-profile", "product-weight", "product-length", "product-package-weight"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const s of ["product-route-override", "save-route-override", "saveRouteOverride", "isRouteOverrideDirty", "loadShippingSummary", "confirm("]) assert.ok(js.includes(s), s);
  assert.ok(!js.includes("سه فیلد «هزینه ارسال»"));
});

await test("Public product.html: renderShippingBlock و متن قدیمی حذف؛ برآوردگر شهر/روش ارسال باقی است", async () => {
  assert.ok(!SHELL.includes("renderShippingBlock"));
  for (const t of ["product.shipping_cost", "product.shipping_method", "product.shipping_time", "product-shipping-info", "<div>هزینه ارسال:", "<div>روش ارسال:", "<div>زمان ارسال:"]) assert.ok(!SHELL.includes(t), t);
  assert.ok(SHELL.includes("shipping-estimator-container") && SHELL.includes("برآورد هزینه ارسال") && SHELL.includes("shippingCostLabel"));
});

console.log("— موتور و منطق جدید بدون تغییر —");

await test("Routing/Engine/Packaging بایت‌به‌بایت یکسان با ZIP مرجع Stage B", async () => {
  assert.equal(sha("../src/shipping-routing.js"), "27ace08e4584cf550a0de879edfbd225845d9266c43feec10625821f1f21197c");
  assert.equal(sha("../src/shipping-engine.js"), "099a18e92cd7df9aed1f724825d0eef2f18883718fb22c26de092c8f9a0b4ee9");
  assert.equal(sha("../src/packaging-estimation.js"), "3af74117ed9d903b3f3b838d131a6cf68b6cf26297519d1760dda31724e17cef");
});

await test("Checkout/سفارش: ستون‌های orders.shipping_cost و shipping_method_* همچنان در منطق واقعی سفارش‌اند (وابستگی واقعی حفظ شد)", async () => {
  const src = read("../src/index.js");
  assert.ok(/INSERT INTO orders[\s\S]{0,400}shipping_cost, shipping_method_id, shipping_method_name/.test(src));
  assert.ok(src.includes("expected_shipping_cost"));
  assert.ok(!/resolveShippingInfo\(/.test(src) && !src.includes("STORE_DEFAULT_SHIPPING_"));
});

await test("هیچ Migration جدید و هیچ DROP/RENAME ستون: پوشهٔ database بدون تغییر نسبت به Stage B", async () => {
  const sqls = ["product-detail-enhancements.sql", "shipping-routing.sql", "packaging-estimation.sql"].map((f) => read(`../database/${f}`));
  assert.ok(sqls[0].includes("ALTER TABLE products ADD COLUMN shipping_cost INTEGER;"));
  for (const s of sqls) assert.ok(!/DROP\s+COLUMN|RENAME\s+COLUMN/i.test(s));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
