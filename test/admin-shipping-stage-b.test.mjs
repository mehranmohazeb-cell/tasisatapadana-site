// =========================================================================
// تست Stage B — Route Override محصول (Endpoint موجود PUT /admin/shipping-routing/product)
// Worker واقعی (src/index.js) + D1 (node:sqlite). هیچ منطق Routing جدیدی تعریف/بازسازی نمی‌شود؛
// ثابت می‌شود Override با همان Endpoint/Validation/Audit موجود ذخیره می‌شود و Summary (Stage A)
// مسیر مؤثر و دلیل را از منطق موجود می‌دهد.
// اجرا: node --no-warnings test/admin-shipping-stage-b.test.mjs
// (رفتار UI در مرورگر واقعی: test/browser/stage-b-product-override.browser.py)
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
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
const ADMIN = { "X-Admin-Token": "adm" };

// legacy=true → Migration مرحلهٔ ۲ (route_policy / override / Snapshot سفارش) اجرا نشده.
function makeEnv({ legacy = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE packaging_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, length_tolerance_cm REAL DEFAULT 0, width_tolerance_cm REAL DEFAULT 0, height_tolerance_cm REAL DEFAULT 0, weight_tolerance_grams INTEGER DEFAULT 0, weight_tolerance_percent REAL DEFAULT 0, min_package_length_cm REAL DEFAULT 10, min_package_width_cm REAL DEFAULT 10, min_package_height_cm REAL DEFAULT 5, min_shipping_weight_grams INTEGER DEFAULT 200, protection_level TEXT DEFAULT 'standard', packaging_group TEXT, allow_combine_with_other_items INTEGER DEFAULT 1, require_separate_shipment INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
    INSERT INTO packaging_profiles (id,code,name,is_default) VALUES (1,'GENERIC','عمومی',1);
    INSERT INTO packaging_profiles (id,code,name,packaging_group,require_separate_shipment) VALUES (2,'FACTORY_PACKAGED','دارای بسته‌بندی کارخانه‌ای',NULL,0),(3,'BULKY','حجیم','bulky',1);
    CREATE TABLE shipping_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, default_packaging_profile_id INTEGER, created_at TEXT, updated_at TEXT${legacy ? "" : ", route_policy TEXT"});
    INSERT INTO shipping_classes (id,name,default_packaging_profile_id) VALUES (1,'کالای عادی',NULL),(2,'پکیج و آبگرمکن',2),(3,'رادیاتور',3),(4,'کلاس بدون policy',NULL);
    ${legacy ? "" : "UPDATE shipping_classes SET route_policy='normal' WHERE id=1; UPDATE shipping_classes SET route_policy='normal' WHERE id=2; UPDATE shipping_classes SET route_policy='freight' WHERE id=3;"}
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, stock INTEGER, active INTEGER DEFAULT 1, image TEXT, weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, shipping_class_id INTEGER, packaging_profile_id INTEGER, package_length_cm REAL, package_width_cm REAL, package_height_cm REAL, package_weight_grams INTEGER, packaging_confidence TEXT, shipping_cost INTEGER, shipping_method TEXT, shipping_time TEXT${legacy ? "" : ", shipping_route_override TEXT"});
    INSERT INTO products (id,name,weight_grams,length_cm,width_cm,height_cm,package_length_cm,package_width_cm,package_height_cm,package_weight_grams,shipping_class_id,packaging_profile_id) VALUES
      (1,'پکیج آدنا',36000,46,24,69,NULL,NULL,NULL,NULL,2,NULL),
      (2,'رادیاتور پنلی',20000,100,10,60,NULL,NULL,NULL,NULL,3,NULL),
      (3,'شیر برقی',250,10,10,10,12,12,12,300,1,1),
      (4,'کالای بدون کلاس',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (5,'کالا با کلاس بدون policy',500,10,10,10,NULL,NULL,NULL,NULL,4,NULL),
      (6,'ابعاد بسته ناقص',500,10,10,10,20,NULL,NULL,NULL,1,3);
    UPDATE products SET shipping_cost=111, shipping_method='پست پیشتاز', shipping_time='۳ روز کاری';
    ${legacy ? "" : "UPDATE products SET shipping_route_override='normal' WHERE id=2;"}
    CREATE TABLE shipping_route_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT, changed_at TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_code TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT, province TEXT, city TEXT, street TEXT, sub_street TEXT, alley TEXT, plaque TEXT, unit TEXT, postal_code TEXT, address_note TEXT, total INTEGER, shipping_cost INTEGER, shipping_method_id INTEGER, shipping_method_name TEXT, shipping_is_cod INTEGER, payable_amount INTEGER, status TEXT, payment_status TEXT, payment_reference TEXT, postal_carrier TEXT, postal_tracking_code TEXT, actual_shipping_cost INTEGER, shipping_cost_variance INTEGER, shipping_cost_recorded_at TEXT, created_at TEXT, updated_at TEXT${legacy ? "" : ", shipping_payment_mode TEXT, shipping_route TEXT, shipping_max_dispatch_days INTEGER"});
    INSERT INTO orders (id,tracking_code,customer_name,total,shipping_cost,shipping_method_name,shipping_is_cod,status,payment_status,created_at) VALUES
      (1,'AP-1','الف',100,0,'باربری (پس‌کرایه)',1,'pending','unpaid','2026-10-01T00:00:00Z'),
      (2,'AP-2','ب',100,0,'پیک موتوری',0,'pending','unpaid','2026-10-01T00:00:00Z'),
      (3,'AP-3','ج',100,0,'قدیمی',0,'pending','unpaid','2026-09-01T00:00:00Z');
    ${legacy ? "" : `UPDATE orders SET shipping_payment_mode='receiver_pays', shipping_route='freight', shipping_max_dispatch_days=3 WHERE id=1;
      UPDATE orders SET shipping_payment_mode='free', shipping_route='isfahan_courier', shipping_max_dispatch_days=3 WHERE id=2;`}
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, product_name TEXT, price INTEGER, quantity INTEGER, subtotal INTEGER, created_at TEXT);
    CREATE TABLE product_images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, image TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE order_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE order_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, is_read INTEGER DEFAULT 0, read_at TEXT);
    CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, status TEXT);
  `);
  return { DB: wrapD1(db), ADMIN_TOKEN: "adm", _raw: db };
}

async function call(env, method, path, body, headers = ADMIN) {
  const r = await worker.fetch(new Request(`https://x.test${path}`, { method, headers: { ...headers, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: r.status, data: await r.json() };
}
const summary = async (env, id) => (await call(env, "GET", `/api/store/admin/shipping-routing/product-summary?product_id=${id}`)).data;
const classes = async (env) => (await call(env, "GET", "/api/store/admin/shipping-classes")).data;
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };


// هش فایل‌های Engine در ZIP مرجع Stage A (این فایل‌ها نباید در Stage B تغییر کنند).
const STAGE_A_ROUTING_SHA = "27ace08e4584cf550a0de879edfbd225845d9266c43feec10625821f1f21197c";
const STAGE_A_ENGINE_SHA = "099a18e92cd7df9aed1f724825d0eef2f18883718fb22c26de092c8f9a0b4ee9";
const STAGE_A_PACKAGING_SHA = "3af74117ed9d903b3f3b838d131a6cf68b6cf26297519d1760dda31724e17cef";

const PUT = (env, body, headers = ADMIN) => call(env, "PUT", "/api/store/admin/shipping-routing/product", body, headers);
const ov = (env, id) => env._raw.prepare("SELECT shipping_route_override v FROM products WHERE id=?").get(id).v;
const snapshot = (env, id) => ({
  product: { ...env._raw.prepare("SELECT id,name,weight_grams,length_cm,width_cm,height_cm,shipping_class_id,packaging_profile_id,package_length_cm,package_width_cm,package_height_cm,package_weight_grams,shipping_cost,shipping_method,shipping_time FROM products WHERE id=?").get(id) },
  classes: env._raw.prepare("SELECT * FROM shipping_classes ORDER BY id").all().map((c) => ({ ...c })),
});
const auditRows = (env, id) => env._raw.prepare("SELECT old_value,new_value FROM shipping_route_audit WHERE entity_type='product' AND entity_id=? ORDER BY id").all(id).map((r) => ({ ...r }));

console.log("— ذخیرهٔ Override با Endpoint موجود —");

await test("۱) Override=NULL: Summary حالت «none» و مسیر از کلاس", async () => {
  const env = makeEnv();
  assert.equal(ov(env, 1), null);
  const s = (await summary(env, 1)).summary;
  assert.equal(s.override, null);
  assert.equal(s.override_status, "none");
  assert.equal(s.route_reason, "CLASS_NORMAL");
});

await test("۲) Override=normal ذخیره می‌شود و Summary مقدار ذخیره‌شده را از Server برمی‌گرداند", async () => {
  const env = makeEnv();
  const r = await PUT(env, { product_id: 3, override: "normal" });
  assert.equal(r.status, 200); assert.equal(r.data.ok, true); assert.equal(r.data.audited, true);
  assert.equal(ov(env, 3), "normal");
  const s = (await summary(env, 3)).summary;
  assert.equal(s.override, "normal"); assert.equal(s.override_status, "valid");
});

await test("۳) Override=freight ذخیره می‌شود؛ مسیر مؤثر باربری با دلیل Override (از منطق موجود)", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 1, override: "freight" });
  assert.equal(ov(env, 1), "freight");
  const s = (await summary(env, 1)).summary;
  assert.equal(s.effective_route_outside_isfahan, "freight");
  assert.equal(s.route_reason, "PRODUCT_OVERRIDE_FREIGHT");
  assert.equal(s.effective_route_inside_isfahan, "isfahan_courier"); // داخل اصفهان همچنان پیک رایگان
});

await test("۴) مقدار نامعتبر رد می‌شود (400) و D1 تغییر نمی‌کند", async () => {
  const env = makeEnv();
  for (const bad of ["fragile", "special", "FREIGHT", "Normal", "isfahan_courier", "0", 1, true, "abc"]) {
    const r = await PUT(env, { product_id: 3, override: bad });
    assert.equal(r.status, 400, `باید رد شود: ${bad}`);
  }
  assert.equal(ov(env, 3), null);
  assert.equal(auditRows(env, 3).length, 0);
  assert.equal((await PUT(env, { product_id: "x", override: "normal" })).status, 400);
  assert.equal((await PUT(env, { product_id: 999, override: "normal" })).status, 404);
});

await test("۵) NULL واقعاً ذخیره می‌شود: override:null و override:\"\" هر دو → NULL (نه رشتهٔ خالی/«null»)", async () => {
  for (const nullish of [null, ""]) {
    const env = makeEnv();
    await PUT(env, { product_id: 2, override: nullish }); // محصول ۲ با override=normal شروع می‌شود
    const row = env._raw.prepare("SELECT shipping_route_override v, typeof(shipping_route_override) t FROM products WHERE id=2").get();
    assert.equal(row.v, null);
    assert.equal(row.t, "null");
  }
});

await test("۶–۹) انتقال‌های normal→freight، freight→normal، normal→NULL، freight→NULL + Audit هر کدام", async () => {
  const env = makeEnv();
  const steps = [["normal", null, "normal"], ["freight", "normal", "freight"], ["normal", "freight", "normal"], [null, "normal", null], ["freight", null, "freight"], [null, "freight", null]];
  for (const [to] of steps) {
    const r = await PUT(env, { product_id: 3, override: to });
    assert.equal(r.data.ok, true);
    assert.equal(ov(env, 3), to);
  }
  assert.deepEqual(auditRows(env, 3), [
    { old_value: null, new_value: "normal" },
    { old_value: "normal", new_value: "freight" },
    { old_value: "freight", new_value: "normal" },
    { old_value: "normal", new_value: null },
    { old_value: null, new_value: "freight" },
    { old_value: "freight", new_value: null },
  ]);
});

console.log("— استقلال Override از بقیهٔ داده‌ها —");

await test("۱۰–۱۳) تغییر Override: Shipping Class، route_policy کلاس‌ها، Packaging، وزن/ابعاد و فیلدهای قدیمی ارسال دست‌نخورده", async () => {
  const env = makeEnv();
  const before = JSON.stringify([1, 2, 3, 4, 5, 6].map((id) => snapshot(env, id).product)) + JSON.stringify(snapshot(env, 1).classes);
  for (const [id, v] of [[1, "freight"], [2, null], [3, "normal"], [6, "freight"], [1, null]]) await PUT(env, { product_id: id, override: v });
  const after = JSON.stringify([1, 2, 3, 4, 5, 6].map((id) => snapshot(env, id).product)) + JSON.stringify(snapshot(env, 1).classes);
  // تنها ستون مجاز تغییر shipping_route_override است که در snapshot نیست.
  assert.equal(after, before);
  assert.equal(snapshot(env, 1).product.shipping_cost, 111);
  assert.equal(snapshot(env, 1).product.shipping_method, "پست پیشتاز");
});

await test("Override فقط روی همان محصول اثر دارد (محصولات دیگر و کلاس مشترک تغییر نمی‌کنند)", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 3, override: "freight" });
  assert.equal(ov(env, 1), null); assert.equal(ov(env, 6), null); assert.equal(ov(env, 2), "normal");
  // محصول ۶ هم‌کلاس محصول ۳ است (کلاس ۱)
  assert.equal((await summary(env, 6)).summary.effective_route_outside_isfahan, "normal");
});

console.log("— مسیر مؤثر و دلیل از منطق موجود —");

await test("۱۴–۱۵) Effective Route/Reason فقط از Summary می‌آید و با لیست Routing موجود برای همهٔ محصولات برابر است", async () => {
  const env = makeEnv();
  for (const [id, v] of [[1, "freight"], [3, "normal"], [5, "freight"], [2, null], [6, "normal"]]) await PUT(env, { product_id: id, override: v });
  const list = (await call(env, "GET", "/api/store/admin/shipping-routing?limit=300")).data;
  for (const p of list.products) {
    const s = (await summary(env, p.id)).summary;
    assert.equal(s.effective_route_outside_isfahan, p.effective_route_outside_isfahan, `route p${p.id}`);
    assert.equal(s.route_reason, p.route_reason, `reason p${p.id}`);
    assert.deepEqual(s.flags, p.flags, `flags p${p.id}`);
    assert.equal(s.override, p.override, `override p${p.id}`);
  }
});

await test("Override مهم‌ترین اولویت: کلاس freight + Override=normal → عادی؛ کلاس normal + Override=freight → باربری", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 2, override: "normal" });  // کلاس رادیاتور = freight
  let s = (await summary(env, 2)).summary;
  assert.equal(s.route_policy, "freight"); assert.equal(s.effective_route_outside_isfahan, "normal"); assert.equal(s.route_reason, "PRODUCT_OVERRIDE_NORMAL");
  await PUT(env, { product_id: 1, override: "freight" }); // کلاس پکیج = normal
  s = (await summary(env, 1)).summary;
  assert.equal(s.route_policy, "normal"); assert.equal(s.shipping_class.name, "پکیج و آبگرمکن");
  assert.equal(s.effective_route_outside_isfahan, "freight");
  assert.equal(s.route_reason_label, "Override مدیریتی محصول: باربری");
});

await test("برگشت به NULL: مسیر دوباره از Route Policy کلاس می‌آید", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 2, override: null });
  const s = (await summary(env, 2)).summary;
  assert.equal(s.override_status, "none");
  assert.equal(s.effective_route_outside_isfahan, "freight");
  assert.equal(s.route_reason, "CLASS_FREIGHT");
});

console.log("— Audit / احراز هویت / Migration —");

await test("۱۶) Audit با entity_type=product و entity_id درست ثبت می‌شود و کلاس‌ها را آلوده نمی‌کند", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 4, override: "freight" });
  const rows = env._raw.prepare("SELECT entity_type, entity_id, old_value, new_value, changed_at FROM shipping_route_audit").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_type, "product"); assert.equal(rows[0].entity_id, 4);
  assert.ok(rows[0].changed_at);
  const feed = (await call(env, "GET", "/api/store/admin/shipping-routing/audit")).data;
  assert.equal(feed.ok, true);
});

await test("خطای Audit باعث موفقیت دروغین نمی‌شود: Override ذخیره، audited=false اعلام می‌شود", async () => {
  const env = makeEnv();
  env._raw.exec("DROP TABLE shipping_route_audit");
  const r = await quiet(() => PUT(env, { product_id: 3, override: "freight" }));
  assert.equal(r.status, 200); assert.equal(r.data.audited, false);
  assert.equal(ov(env, 3), "freight");
});

await test("۱۷) بدون توکن یا با توکن اشتباه، ذخیره رد می‌شود (401) و D1 تغییر نمی‌کند", async () => {
  const env = makeEnv();
  assert.equal((await PUT(env, { product_id: 3, override: "freight" }, {})).status, 401);
  assert.equal((await PUT(env, { product_id: 3, override: "freight" }, { "X-Admin-Token": "wrong" })).status, 401);
  assert.equal(ov(env, 3), null);
  assert.equal(auditRows(env, 3).length, 0);
});

await test("Migration نشده: ذخیرهٔ Override با ROUTING_MIGRATION_MISSING رد می‌شود (بدون ایجاد ستون)", async () => {
  const env = makeEnv({ legacy: true });
  const r = await quiet(() => PUT(env, { product_id: 3, override: "freight" }));
  assert.equal(r.status, 500);
  assert.equal(r.data.error, "ROUTING_MIGRATION_MISSING");
});

console.log("— مقدار نامعتبر موجود در D1 —");

await test("۲۱) مقدار نامعتبر D1 بی‌صدا اصلاح نمی‌شود: Summary خام + invalid، GETها چیزی را نمی‌نویسند", async () => {
  const env = makeEnv();
  env._raw.exec("PRAGMA ignore_check_constraints=ON; UPDATE products SET shipping_route_override='fragile' WHERE id=3;");
  const s = (await summary(env, 3)).summary;
  assert.equal(s.override, "fragile");
  assert.equal(s.override_status, "invalid");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  assert.match(s.route_reason_note, /fragile/);
  await call(env, "GET", "/api/store/admin/shipping-routing?limit=300");
  await call(env, "GET", "/api/store/admin/shipping-routing/product-summary?product_id=3");
  assert.equal(ov(env, 3), "fragile");
  assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM shipping_route_audit").get().c, 0);
});

await test("مقدار نامعتبر D1 فقط با اقدام صریح مدیر اصلاح می‌شود (PUT معتبر) و Audit مقدار قبلی را نگه می‌دارد", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE products SET shipping_route_override='fragile' WHERE id=3;");
  await PUT(env, { product_id: 3, override: null });
  assert.equal(ov(env, 3), null);
  assert.deepEqual(auditRows(env, 3), [{ old_value: "fragile", new_value: null }]);
});

console.log("— Summary همچنان Single Source of Truth —");

await test("۲۲) Summary فقط‌خواندنی است و ساختار پاسخ Stage A حفظ شده", async () => {
  const env = makeEnv();
  const before = JSON.stringify(env._raw.prepare("SELECT * FROM products").all()) + JSON.stringify(env._raw.prepare("SELECT * FROM shipping_route_audit").all());
  const d = await summary(env, 2);
  for (const k of ["product_id", "shipping_class", "route_policy", "route_policy_status", "override", "override_status", "effective_route_outside_isfahan", "effective_route_inside_isfahan", "route_reason", "route_reason_label", "packaging_profile", "flags", "flag_labels"]) {
    assert.ok(k in d.summary, `کلید ${k}`);
  }
  assert.equal(d.columns_ready, true);
  assert.equal(JSON.stringify(env._raw.prepare("SELECT * FROM products").all()) + JSON.stringify(env._raw.prepare("SELECT * FROM shipping_route_audit").all()), before);
});

await test("سازگاری: Endpoint صفحهٔ Routing (GET لیست) همچنان Override ذخیره‌شده از فرم محصول را نشان می‌دهد", async () => {
  const env = makeEnv();
  await PUT(env, { product_id: 3, override: "freight" });
  const list = (await call(env, "GET", "/api/store/admin/shipping-routing?limit=300&filter=override")).data;
  assert.ok(list.products.some((p) => p.id === 3 && p.override === "freight"));
  assert.ok(list.totals.overridden >= 1);
});

await test("منطق Routing و Endpoint موجود بدون تغییر (فایل‌ها بایت‌به‌بایت یکسان با Stage A)", async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const h = (p) => createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex");
  assert.equal(h("../src/shipping-routing.js"), STAGE_A_ROUTING_SHA);
  assert.equal(h("../src/shipping-engine.js"), STAGE_A_ENGINE_SHA);
  assert.equal(h("../src/packaging-estimation.js"), STAGE_A_PACKAGING_SHA);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
