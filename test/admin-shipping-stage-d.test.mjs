import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
    INSERT INTO shipping_classes (id,name,route_policy) VALUES (2,'پکیج و آبگرمکن','normal'),(3,'رادیاتور','freight');
    CREATE TABLE shipping_route_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT, changed_at TEXT);
    CREATE TABLE packaging_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, length_tolerance_cm REAL DEFAULT 0, width_tolerance_cm REAL DEFAULT 0, height_tolerance_cm REAL DEFAULT 0, weight_tolerance_grams INTEGER DEFAULT 0, weight_tolerance_percent REAL DEFAULT 0, min_package_length_cm REAL DEFAULT 10, min_package_width_cm REAL DEFAULT 10, min_package_height_cm REAL DEFAULT 5, min_shipping_weight_grams INTEGER DEFAULT 200, protection_level TEXT DEFAULT 'standard', packaging_group TEXT, allow_combine_with_other_items INTEGER DEFAULT 1, require_separate_shipment INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
    INSERT INTO packaging_profiles (id,code,name,is_default) VALUES (1,'GENERIC','عمومی',1);
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


const LEGACY_KEYS = ["shipping_cost", "shipping_method", "shipping_time"];
const PUTP = (env, body) => http(env, "PUT", "/api/store/products", body, ADMIN);
const NEW_FORM_PAYLOAD = (extra = {}) => ({ id: 1, name: "پکیج تست", slug: "pkg-test", description: "<p>توضیح</p>", price: 5000000, stock: 3, active: true, brand: "برند", model: "مدل", sku: "SKU1", shipping_class_id: 2, weight_grams: 36000, length_cm: 46, width_cm: 24, height_cm: 69, ...extra });
const legacyRow = (env, id) => { const r = row(env, id); return { c: r.shipping_cost, m: r.shipping_method, t: r.shipping_time }; };
const FIRST = { c: LEGACY_COST, m: LEGACY_METHOD, t: LEGACY_TIME };

console.log("— A) فایل Backup عمومی —");

await test("A1) public/store/product.html.bak دیگر وجود ندارد", async () => {
  assert.equal(existsSync(new URL("../public/store/product.html.bak", import.meta.url)), false);
});
await test("A2) هیچ .assetsignore ساخته نشده و هیچ نسخهٔ Backup مشابهی از product.html در public/store نیست", async () => {
  assert.equal(existsSync(new URL("../.assetsignore", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/.assetsignore", import.meta.url)), false);
  const names = readdirSync(new URL("../public/store/", import.meta.url));
  assert.ok(names.includes("product.html"), "صفحهٔ اصلی محصول باید بماند");
  assert.deepEqual(names.filter((n) => /^product\.html\./.test(n)), []);
});

console.log("— B) GET ادمین محصولات —");

await test("B1) هیچ‌یک از سه کلید قدیمی در پاسخ GET ادمین نیست (حتی برای محصول دارای داده‌ی قدیمی)", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/api/store/products?page=1&limit=20", null, ADMIN);
  assert.equal(r.status, 200);
  assert.ok(r.data.products.length >= 2);
  for (const p of r.data.products) for (const k of LEGACY_KEYS) assert.ok(!(k in p), `${k} در محصول ${p.id}`);
  assert.ok(!r.text.includes(LEGACY_METHOD) && !r.text.includes(LEGACY_TIME) && !r.text.includes(String(LEGACY_COST)), "مقدار قدیمی نباید در JSON باشد");
});
await test("B2) بقیهٔ قرارداد لیست ادمین سالم: صفحه‌بندی، جست‌وجو، فیلتر فعال، کلیدهای فرم محصول (کلاس، وزن/ابعاد، Packaging)", async () => {
  const env = makeEnv();
  const r = await http(env, "GET", "/api/store/products?page=1&limit=1", null, ADMIN);
  assert.equal(r.data.ok, true); assert.equal(r.data.limit, 1); assert.equal(r.data.total, 2); assert.equal(r.data.total_pages, 2); assert.equal(r.data.products.length, 1);
  const all = (await http(env, "GET", "/api/store/products?page=1&limit=20", null, ADMIN)).data.products;
  const p = all.find((x) => x.id === 1);
  for (const k of ["id", "name", "slug", "description", "price", "image", "stock", "active", "brand", "model", "sku", "compare_at_price", "warranty_months", "warranty_provider", "return_days", "category_id",
    "shipping_class_id", "weight_grams", "length_cm", "width_cm", "height_cm", "packaging_profile_id", "package_length_cm", "package_width_cm", "package_height_cm", "package_weight_grams", "packaging_confidence", "images", "specs"]) assert.ok(k in p, `کلید ${k} باید بماند`);
  assert.equal(p.shipping_class_id, 2); assert.equal(p.weight_grams, 36000);
  const q = (await http(env, "GET", "/api/store/products?q=rad&active=1", null, ADMIN)).data;
  assert.equal(q.products.length, 1); assert.equal(q.products[0].slug, "rad-test");
});
await test("B3) GET ادمین بدون توکن همچنان لیست «همه» را به ادمین نمی‌دهد (احراز هویت تغییر نکرد)", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE products SET active=0 WHERE id=2");
  const anon = await http(env, "GET", "/api/store/products?page=1&limit=20&active=0");
  assert.ok(!(anon.data.products || []).some((p) => p.id === 2), "کاربر ناشناس محصول غیرفعال را نمی‌بیند");
  const adm = await http(env, "GET", "/api/store/products?page=1&limit=20&active=0", null, ADMIN);
  assert.ok(adm.data.products.some((p) => p.id === 2));
});
await test("B4) Product Admin فعلی نمی‌شکند: Shipping Class، Summary و Override همچنان کار می‌کنند", async () => {
  const env = makeEnv();
  const classes = await http(env, "GET", "/api/store/admin/shipping-classes", null, ADMIN);
  assert.equal(classes.data.ok, true);
  assert.deepEqual(classes.data.shipping_classes.map((c) => [c.id, c.route_policy_status]).sort(), [[2, "valid"], [3, "valid"]]);
  const sum = async () => (await http(env, "GET", "/api/store/admin/shipping-routing/product-summary?product_id=1", null, ADMIN)).data.summary;
  const setOv = (v) => http(env, "PUT", "/api/store/admin/shipping-routing/product", { product_id: 1, override: v }, ADMIN);
  let s = await sum(); // داده‌ی آزمایشی: کلاس «پکیج و آبگرمکن» (normal) + Override=freight
  assert.equal(s.shipping_class.name, "پکیج و آبگرمکن");
  assert.equal(s.route_policy, "normal");
  assert.equal(s.override, "freight");
  assert.equal(s.effective_route_outside_isfahan, "freight");
  assert.equal(s.route_reason, "PRODUCT_OVERRIDE_FREIGHT");
  assert.equal((await setOv(null)).data.ok, true);          // پیش‌فرض کلاس → NULL
  s = await sum();
  assert.equal(s.override_status, "none"); assert.equal(s.effective_route_outside_isfahan, "normal"); assert.equal(s.route_reason, "CLASS_NORMAL");
  assert.equal((await setOv("normal")).data.ok, true);
  assert.equal((await sum()).override, "normal");
  assert.equal((await setOv("freight")).data.ok, true);
  assert.equal((await sum()).effective_route_outside_isfahan, "freight");
  assert.deepEqual(legacyRow(env, 1), FIRST, "ذخیرهٔ Override ستون‌های قدیمی را دست نزد");
});

console.log("— C) حفظ پایگاه داده —");

await test("C1) ستون‌های products.shipping_cost/method/time هنوز در schema هستند (PRAGMA table_info)", async () => {
  const env = makeEnv();
  const cols = env._raw.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  for (const k of LEGACY_KEYS) assert.ok(cols.includes(k), k);
});
await test("C2) داده‌ی قدیمی بعد از همهٔ عملیات Stage D (GET ادمین، SSR، API عمومی) دست‌نخورده است", async () => {
  const env = makeEnv();
  await http(env, "GET", "/api/store/products?page=1&limit=20", null, ADMIN);
  await http(env, "GET", "/store/product/pkg-test");
  await http(env, "GET", "/api/store/products/pkg-test");
  await http(env, "GET", "/api/store/products");
  assert.deepEqual(legacyRow(env, 1), FIRST);
  assert.deepEqual(legacyRow(env, 2), { c: null, m: null, t: null });
});
await test("C3) پوشهٔ database/ بایت‌به‌بایت مثل Stage C است: همان ۲۲ فایل، بدون Migration جدید و بدون DROP/RENAME COLUMN", async () => {
  const dir = new URL("../database/", import.meta.url);
  const files = readdirSync(dir).sort();
  assert.equal(files.length, 22);
  const h = createHash("sha256");
  for (const f of files) { h.update(f); h.update(createHash("sha256").update(readFileSync(new URL(f, dir))).digest()); }
  assert.equal(h.digest("hex"), "f60ed9df9fa94666f1831015c535952408a3767d99c2a761457a8cea4c18a6a3");
  // Migrationهای تاریخی دیگر (مثلاً calculation-mode روی site_settings) RENAME/DROP COLUMN دارند؛ فقط ستون‌های قدیمی ارسال محصول مهم است.
  for (const f of files) assert.ok(!/(DROP|RENAME)\s+COLUMN\s+shipping_(cost|method|time)\b/i.test(readFileSync(new URL(f, dir), "utf8")), f);
});

console.log("— D) Product Save حافظ داده‌ی قدیمی —");

await test("D1) Save محصول دارای داده‌ی قدیمی (فرم جدید) داده‌ی قدیمی را تغییر نمی‌دهد؛ سایر فیلدها ذخیره می‌شوند", async () => {
  const env = makeEnv();
  const r = await PUTP(env, NEW_FORM_PAYLOAD({ name: "پکیج تست — ویرایش", price: 5200000 }));
  assert.equal(r.status, 200, r.text);
  assert.equal(row(env, 1).name, "پکیج تست — ویرایش"); assert.equal(row(env, 1).price, 5200000);
  assert.deepEqual(legacyRow(env, 1), FIRST);
});
await test("D2) چند Save پشت‌سرهم + کلاینت قدیمی که سه فیلد را می‌فرستد: داده‌ی قدیمی همچنان دست‌نخورده (بی‌اثر پذیرفته می‌شود)", async () => {
  const env = makeEnv();
  for (let i = 0; i < 3; i++) assert.equal((await PUTP(env, NEW_FORM_PAYLOAD({ stock: i + 1 }))).status, 200);
  const old = await PUTP(env, NEW_FORM_PAYLOAD({ shipping_cost: 5, shipping_method: "x", shipping_time: "y" }));
  assert.equal(old.status, 200, old.text);
  assert.deepEqual(legacyRow(env, 1), FIRST);
  assert.equal(row(env, 1).stock, 3);
});
await test("D3) Save محصول مقدار Override را (مثل Stage B) تغییر نمی‌دهد", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE products SET shipping_route_override='freight' WHERE id=1");
  await PUTP(env, NEW_FORM_PAYLOAD());
  assert.equal(row(env, 1).shipping_route_override, "freight");
});
await test("D4) محصول جدید (POST): ستون‌های قدیمی NULL و ساخت موفق", async () => {
  const env = makeEnv();
  const r = await http(env, "POST", "/api/store/products", { name: "جدید", slug: "new-d", description: "", price: 1, stock: 1, active: true }, ADMIN);
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(legacyRow(env, r.data.product_id), { c: null, m: null, t: null });
});

console.log("— E) صفحهٔ عمومی محصول —");

await test("E1) SSR: بلوک قدیمی و مقادیر قدیمی نیستند؛ برآوردگر واقعی ارسال هست", async () => {
  const env = makeEnv();
  for (const slug of ["pkg-test", "rad-test"]) {
    const r = await http(env, "GET", `/store/product/${slug}`);
    assert.equal(r.status, 200);
    const visible = r.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    for (const t of ["هزینه ارسال:", "روش ارسال:", "زمان ارسال:", "پست پیشتاز", "۳ روز کاری"]) assert.ok(!visible.includes(t), `${t} (${slug})`);
    for (const t of ["product-shipping-info", LEGACY_METHOD, LEGACY_TIME, "987654"]) assert.ok(!r.text.includes(t), `${t} (${slug})`);
    assert.ok(r.text.includes("shipping-estimator-container") && r.text.includes("برآورد هزینه ارسال") && r.text.includes("/shipping-methods?city="));
  }
});
await test("E2) product.html: renderShippingBlock و بلوک قدیمی نیست؛ برآوردگر باقی است", async () => {
  assert.ok(!SHELL.includes("renderShippingBlock") && !SHELL.includes("product-shipping-info"));
  assert.ok(SHELL.includes("shipping-estimator-container") && SHELL.includes("shippingCostLabel"));
});
await test("E3) API عمومی محصول هنوز سه کلید قدیمی را برنمی‌گرداند (Stage C حفظ شده)", async () => {
  const env = makeEnv();
  const one = (await http(env, "GET", "/api/store/products/pkg-test")).data;
  const p = one.product || one;
  for (const k of LEGACY_KEYS) assert.ok(!(k in p), k);
  for (const x of (await http(env, "GET", "/api/store/products")).data.products) for (const k of LEGACY_KEYS) assert.ok(!(k in x), k);
});

console.log("— F) CSS —");

await test("F1) .product-shipping-info دیگر در هیچ CSS/HTML/JS فعال پروژه نیست", async () => {
  const css = read("../public/store/store.css");
  assert.ok(!css.includes("product-shipping-info"));
  for (const f of ["../public/store/product.html", "../public/store/cart.html", "../public/store/checkout.html", "../public/store/store.js", "../src/index.js"]) assert.ok(!read(f).includes("product-shipping-info"), f);
});
await test("F2) CSS برآوردگر ارسال فعلی و ساختار CSS صفحهٔ محصول سر جایش است", async () => {
  const css = read("../public/store/store.css");
  for (const sel of [".shipping-estimator {", ".shipping-estimator h4 {", ".shipping-estimator select {", ".shipping-estimator .shipping-estimate-result {", ".shipping-estimator .shipping-estimate-note {"]) assert.ok(css.includes(sel), sel);
  assert.ok(css.includes("/* ---------- برآورد هزینه ارسال (صفحه محصول) ---------- */"));
  assert.ok(css.includes(".product-detail") || css.includes(".product-"), "CSS عمومی صفحهٔ محصول دست‌نخورده");
  // فقط همان بلوک پاک شده؛ فایل همچنان CRLF است (حفظ قالب فایل)
  assert.ok(css.includes("\r\n") && !/[^\r]\n/.test(css), "پایان خط‌ها (CRLF) حفظ شده");
});

console.log("— G) موتور و منطق جدید بدون تغییر —");

await test("G1) Routing/Engine/Packaging بایت‌به‌بایت مثل Stage B/C", async () => {
  assert.equal(sha("../src/shipping-routing.js"), "27ace08e4584cf550a0de879edfbd225845d9266c43feec10625821f1f21197c");
  assert.equal(sha("../src/shipping-engine.js"), "099a18e92cd7df9aed1f724825d0eef2f18883718fb22c26de092c8f9a0b4ee9");
  assert.equal(sha("../src/packaging-estimation.js"), "3af74117ed9d903b3f3b838d131a6cf68b6cf26297519d1760dda31724e17cef");
});
await test("G2) در src/index.js هیچ SELECT/INSERT/UPDATE جدول products سه ستون قدیمی را نمی‌نامد؛ وابستگی‌های orders/Checkout سر جایش", async () => {
  const src = read("../src/index.js");
  for (const m of src.matchAll(/(FROM products|INTO products|UPDATE products)\b/g)) {
    const start = src.lastIndexOf("prepare(", m.index);
    const tail = src.slice(m.index);
    const end = m.index + tail.search(/\)\s*\.(bind|all|first|run)\(/);
    const stmt = src.slice(start, end);
    assert.ok(stmt.length > 10 && stmt.length < 2500, `پنجرهٔ SQL معقول @${m.index}`);
    assert.ok(!/\bshipping_(cost|method|time)\b/.test(stmt), `نزدیک «${m[0]}» @${m.index}`);
  }
  assert.ok(/INSERT INTO orders[\s\S]{0,400}shipping_cost, shipping_method_id, shipping_method_name/.test(src));
  assert.ok(src.includes("expected_shipping_cost"));
});
await test("G3) نام‌های حذف‌شده در سورس فعال (src و public) صفر است: resolveShippingInfo / STORE_DEFAULT_SHIPPING_ / renderShippingBlock / product.html.bak", async () => {
  const files = ["../src/index.js", "../src/shipping-routing.js", "../src/shipping-engine.js", "../src/packaging-estimation.js", "../public/store/product.html", "../public/store/store.css", "../public/store/store.js", "../public/admin/products/products.js", "../public/admin/products/index.html"];
  for (const f of files) for (const n of ["resolveShippingInfo", "STORE_DEFAULT_SHIPPING_", "renderShippingBlock", "product.html.bak", "product-shipping-info"]) assert.ok(!read(f).includes(n), `${n} در ${f}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
