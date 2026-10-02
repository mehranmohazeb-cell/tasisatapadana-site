// =========================================================================
// تست Stage A — Admin Visibility (Shipping Classes / خلاصهٔ حمل محصول / Snapshot سفارش)
// Worker واقعی (src/index.js) + D1 (node:sqlite). هیچ تغییری در منطق Routing را تست‌شده فرض نمی‌کند؛
// فقط نشان می‌دهد پنل همان خروجی منطق موجود را نمایش می‌دهد (Single Source of Truth).
// اجرا: node --no-warnings test/admin-shipping-stage-a.test.mjs
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
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, stock INTEGER, active INTEGER DEFAULT 1, image TEXT, weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, shipping_class_id INTEGER, packaging_profile_id INTEGER, package_length_cm REAL, package_width_cm REAL, package_height_cm REAL, package_weight_grams INTEGER, packaging_confidence TEXT${legacy ? "" : ", shipping_route_override TEXT"});
    INSERT INTO products (id,name,weight_grams,length_cm,width_cm,height_cm,package_length_cm,package_width_cm,package_height_cm,package_weight_grams,shipping_class_id,packaging_profile_id) VALUES
      (1,'پکیج آدنا',36000,46,24,69,NULL,NULL,NULL,NULL,2,NULL),
      (2,'رادیاتور پنلی',20000,100,10,60,NULL,NULL,NULL,NULL,3,NULL),
      (3,'شیر برقی',250,10,10,10,12,12,12,300,1,1),
      (4,'کالای بدون کلاس',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (5,'کالا با کلاس بدون policy',500,10,10,10,NULL,NULL,NULL,NULL,4,NULL),
      (6,'ابعاد بسته ناقص',500,10,10,10,20,NULL,NULL,NULL,1,3);
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

console.log("— Shipping Classes: GET / POST / PUT —");

await test("GET کلاس‌ها route_policy و وضعیت صریح (valid/unset) را برمی‌گرداند", async () => {
  const env = makeEnv();
  const d = await classes(env);
  assert.equal(d.ok, true);
  assert.equal(d.route_policy_available, true);
  assert.deepEqual(d.route_policy_values, ["normal", "freight"]);
  const byId = Object.fromEntries(d.shipping_classes.map((c) => [c.id, c]));
  assert.equal(byId[3].route_policy, "freight");
  assert.equal(byId[3].route_policy_status, "valid");
  assert.equal(byId[4].route_policy, null);
  assert.equal(byId[4].route_policy_status, "unset");
});

await test("مقدار نامعتبر در D1 بی‌صدا تبدیل نمی‌شود: خام + status=invalid", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE shipping_classes SET route_policy='fragile' WHERE id=4");
  const c = (await classes(env)).shipping_classes.find((x) => x.id === 4);
  assert.equal(c.route_policy, "fragile");
  assert.equal(c.route_policy_status, "invalid");
});

await test("Migration نشده (ستون route_policy نیست): GET نمی‌شکند و unavailable اعلام می‌شود", async () => {
  const env = makeEnv({ legacy: true });
  const d = await classes(env);
  assert.equal(d.ok, true);
  assert.equal(d.route_policy_available, false);
  assert.ok(d.shipping_classes.every((c) => c.route_policy === null && c.route_policy_status === "unavailable"));
});

await test("POST با route_policy ذخیره می‌کند و Audit می‌نویسد", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/store/admin/shipping-classes", { name: "شکننده", route_policy: "freight" });
  assert.equal(r.status, 201);
  const row = env._raw.prepare("SELECT route_policy FROM shipping_classes WHERE id=?").get(r.data.id);
  assert.equal(row.route_policy, "freight");
  const audit = env._raw.prepare("SELECT * FROM shipping_route_audit WHERE entity_type='shipping_class' AND entity_id=?").all(r.data.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].new_value, "freight");
});

await test("POST با route_policy نامعتبر (مثلاً fragile) رد می‌شود؛ Route جدید اختراع نمی‌شود", async () => {
  const env = makeEnv();
  for (const bad of ["fragile", "special", "", null, "FREIGHT"]) {
    const r = await call(env, "POST", "/api/store/admin/shipping-classes", { name: `x-${String(bad)}`, route_policy: bad });
    assert.equal(r.status, 400, `باید رد شود: ${bad}`);
  }
  assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM shipping_classes").get().c, 4);
});

await test("POST بدون route_policy سازگار با رفتار قبلی است (NULL)", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/store/admin/shipping-classes", { name: "قدیمی" });
  assert.equal(r.status, 201);
  assert.equal(env._raw.prepare("SELECT route_policy FROM shipping_classes WHERE id=?").get(r.data.id).route_policy, null);
});

await test("PUT با route_policy مقدار را عوض و Audit می‌کند؛ بدون تغییر Audit نمی‌نویسد", async () => {
  const env = makeEnv();
  let r = await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 1, name: "کالای عادی", route_policy: "freight" });
  assert.equal(r.data.ok, true);
  assert.equal(env._raw.prepare("SELECT route_policy FROM shipping_classes WHERE id=1").get().route_policy, "freight");
  r = await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 1, name: "کالای عادی", route_policy: "freight" });
  const audits = env._raw.prepare("SELECT old_value,new_value FROM shipping_route_audit WHERE entity_id=1").all();
  assert.equal(audits.length, 1);
  assert.deepEqual({ ...audits[0] }, { old_value: "normal", new_value: "freight" });
});

await test("PUT بدون route_policy (مثلاً غیرفعال‌سازی قدیمی) مقدار فعلی را دست نمی‌زند، حتی NULL/نامعتبر", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE shipping_classes SET route_policy='fragile' WHERE id=3");
  await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 3, name: "رادیاتور", active: false });
  assert.equal(env._raw.prepare("SELECT route_policy FROM shipping_classes WHERE id=3").get().route_policy, "fragile");
  await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 4, name: "کلاس بدون policy", active: false });
  assert.equal(env._raw.prepare("SELECT route_policy FROM shipping_classes WHERE id=4").get().route_policy, null);
  assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM shipping_route_audit").get().c, 0);
});

await test("PUT با route_policy نامعتبر یا کلاس ناموجود رد می‌شود", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 1, name: "x", route_policy: "special" })).status, 400);
  assert.equal((await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 999, name: "x", route_policy: "normal" })).status, 404);
});

await test("Migration نشده: ذخیرهٔ route_policy با خطای صریح ROUTING_MIGRATION_MISSING (بدون تغییر داده)", async () => {
  const env = makeEnv({ legacy: true });
  const p = await call(env, "POST", "/api/store/admin/shipping-classes", { name: "جدید", route_policy: "normal" });
  assert.equal(p.data.error, "ROUTING_MIGRATION_MISSING");
  const u = await call(env, "PUT", "/api/store/admin/shipping-classes", { id: 1, name: "کالای عادی", route_policy: "normal" });
  assert.equal(u.data.error, "ROUTING_MIGRATION_MISSING");
  assert.equal(env._raw.prepare("SELECT COUNT(*) c FROM shipping_classes").get().c, 4);
});

await test("احراز هویت: بدون توکن Admin همهٔ Endpointهای جدید 401 می‌دهند", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "GET", "/api/store/admin/shipping-routing/product-summary?product_id=1", null, {})).status, 401);
  assert.equal((await call(env, "GET", "/api/store/admin/shipping-classes", null, {})).status, 401);
  assert.equal((await call(env, "GET", "/api/store/orders", null, {})).status, 401);
});

console.log("— خلاصهٔ حمل محصول —");

await test("کلاس با Route Policy باربری: خارج اصفهان باربری، داخل اصفهان پیک رایگان، دلیل CLASS_FREIGHT", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE products SET shipping_route_override=NULL WHERE id=2");
  const s = (await summary(env, 2)).summary;
  assert.equal(s.shipping_class.name, "رادیاتور");
  assert.equal(s.route_policy, "freight");
  assert.equal(s.route_policy_status, "valid");
  assert.equal(s.effective_route_outside_isfahan, "freight");
  assert.equal(s.effective_route_inside_isfahan, "isfahan_courier");
  assert.equal(s.route_reason, "CLASS_FREIGHT");
  assert.equal(s.override_status, "none");
});

await test("Effective Route ≠ Route Policy: کلاس freight + Override=normal → مؤثر normal با دلیل Override", async () => {
  const env = makeEnv(); // محصول ۲: کلاس freight ولی override=normal
  const s = (await summary(env, 2)).summary;
  assert.equal(s.route_policy, "freight");
  assert.equal(s.override, "normal");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  assert.equal(s.route_reason, "PRODUCT_OVERRIDE_NORMAL");
  assert.equal(s.route_reason_label, "Override مدیریتی محصول: عادی");
});

await test("مقادیر از D1 می‌آیند: پکیج ۳۶۰۰۰ گرم، ۴۶×۲۴×۶۹، Profile پیش‌فرض کلاس", async () => {
  const env = makeEnv();
  const s = (await summary(env, 1)).summary;
  assert.equal(s.weight_grams, 36000);
  assert.deepEqual(s.dimensions_cm, { length: 46, width: 24, height: 69 });
  assert.equal(s.packaging_profile.code, "FACTORY_PACKAGED");
  assert.equal(s.packaging_profile.source, "CLASS_DEFAULT");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  assert.equal(s.route_reason, "CLASS_NORMAL");
  assert.equal(s.package_weight_grams, null); // مقدار ساختگی ندارد
});

await test("Profile اختصاصی محصول و وزن/ابعاد بسته‌بندی ثبت‌شده نمایش داده می‌شوند", async () => {
  const env = makeEnv();
  const s = (await summary(env, 3)).summary;
  assert.equal(s.packaging_profile.code, "GENERIC");
  assert.equal(s.packaging_profile.source, "PRODUCT");
  assert.equal(s.package_weight_grams, 300);
  assert.deepEqual(s.package_dimensions_cm, { length: 12, width: 12, height: 12 });
});

await test("بدون Shipping Class: NO_CLASS_DEFAULT_NORMAL + هشدارهای وزن/ابعاد (فقط Flag، مسیر تغییر نمی‌کند)", async () => {
  const env = makeEnv();
  const s = (await summary(env, 4)).summary;
  assert.equal(s.shipping_class, null);
  assert.equal(s.route_policy_status, "no_class");
  assert.equal(s.route_reason, "NO_CLASS_DEFAULT_NORMAL");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  for (const f of ["NO_SHIPPING_CLASS", "MISSING_WEIGHT", "MISSING_DIMENSIONS"]) assert.ok(s.flags.includes(f), f);
  assert.ok(s.flag_labels.includes("Shipping Class ندارد"));
});

await test("Suspicion ≠ Routing: ابعاد بسته ناقص Flag می‌شود ولی مسیر عادی می‌ماند", async () => {
  const env = makeEnv();
  const s = (await summary(env, 6)).summary;
  assert.ok(s.flags.includes("PACKAGE_DIMENSIONS_INCOMPLETE"));
  assert.equal(s.effective_route_outside_isfahan, "normal");
});

await test("route_policy ثبت‌نشده (NULL): مسیر عادی با یادداشت شفاف، نه کتمان", async () => {
  const env = makeEnv();
  const s = (await summary(env, 5)).summary;
  assert.equal(s.route_policy_status, "unset");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  assert.match(s.route_reason_note, /ثبت نشده/);
});

await test("route_policy نامعتبر در D1: status=invalid، رفتار موجود (عادی) بدون تغییر + یادداشت صریح", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE shipping_classes SET route_policy='fragile' WHERE id=4");
  const s = (await summary(env, 5)).summary;
  assert.equal(s.route_policy, "fragile");
  assert.equal(s.route_policy_status, "invalid");
  assert.equal(s.effective_route_outside_isfahan, "normal");
  assert.match(s.route_reason_note, /fragile/);
});

await test("Single Source of Truth: خلاصهٔ محصول با GET /admin/shipping-routing (منطق موجود) برای همهٔ محصولات یکی است", async () => {
  const env = makeEnv();
  const list = (await call(env, "GET", "/api/store/admin/shipping-routing?limit=300")).data;
  assert.equal(list.ok, true);
  for (const p of list.products) {
    const s = (await summary(env, p.id)).summary;
    assert.equal(s.effective_route_outside_isfahan, p.effective_route_outside_isfahan, `route p${p.id}`);
    assert.equal(s.route_reason, p.route_reason, `reason p${p.id}`);
    assert.deepEqual(s.flags, p.flags, `flags p${p.id}`);
  }
});

await test("Migration نشده: خلاصه نمی‌شکند؛ columns_ready=false و همه عادی", async () => {
  const env = makeEnv({ legacy: true });
  const d = await summary(env, 2);
  assert.equal(d.ok, true);
  assert.equal(d.columns_ready, false);
  assert.equal(d.summary.effective_route_outside_isfahan, "normal");
  assert.equal(d.summary.route_policy_status, "unavailable");
});

await test("product_id نامعتبر 400 و محصول ناموجود 404", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "GET", "/api/store/admin/shipping-routing/product-summary?product_id=abc")).status, 400);
  assert.equal((await call(env, "GET", "/api/store/admin/shipping-routing/product-summary?product_id=999")).status, 404);
});

await test("خلاصه فقط‌خواندنی است: هیچ ردیفی در D1 تغییر نمی‌کند", async () => {
  const env = makeEnv();
  const before = JSON.stringify([env._raw.prepare("SELECT * FROM products").all(), env._raw.prepare("SELECT * FROM shipping_classes").all(), env._raw.prepare("SELECT * FROM shipping_route_audit").all()]);
  for (const id of [1, 2, 3, 4, 5, 6]) await summary(env, id);
  const after = JSON.stringify([env._raw.prepare("SELECT * FROM products").all(), env._raw.prepare("SELECT * FROM shipping_classes").all(), env._raw.prepare("SELECT * FROM shipping_route_audit").all()]);
  assert.equal(after, before);
});

console.log("— Snapshot ارسال در سفارش‌ها —");

await test("لیست Admin سفارش‌ها: Snapshot ثبت‌شده همان‌طور که هست (بدون محاسبهٔ مجدد)", async () => {
  const env = makeEnv();
  const d = (await call(env, "GET", "/api/store/orders")).data;
  assert.equal(d.ok, true);
  const o = Object.fromEntries(d.orders.map((x) => [x.id, x]));
  assert.equal(o[1].shipping_route, "freight");
  assert.equal(o[1].shipping_payment_mode, "receiver_pays");
  assert.equal(o[1].shipping_max_dispatch_days, 3);
  assert.equal(o[2].shipping_route, "isfahan_courier");
  assert.equal(o[2].shipping_payment_mode, "free");
  assert.equal(o[1].shipping_snapshot_available, true);
});

await test("سفارش قدیمی بدون Snapshot: null می‌ماند (نه مقدار ساختگی)", async () => {
  const env = makeEnv();
  const d = (await call(env, "GET", "/api/store/orders")).data;
  const old = d.orders.find((x) => x.id === 3);
  assert.equal(old.shipping_route, null);
  assert.equal(old.shipping_payment_mode, null);
  assert.equal(old.shipping_max_dispatch_days, null);
  assert.equal(old.shipping_snapshot_available, true);
});

await test("جزئیات سفارش Admin: Snapshot برگردانده می‌شود", async () => {
  const env = makeEnv();
  const d = (await call(env, "GET", "/api/store/orders/1")).data;
  assert.equal(d.ok, true);
  const o = d.order || d;
  assert.equal(o.shipping_route, "freight");
  assert.equal(o.shipping_payment_mode, "receiver_pays");
  assert.equal(o.shipping_max_dispatch_days, 3);
});

await test("Snapshot با تغییر بعدی Route Policy کلاس تغییر نمی‌کند (محاسبهٔ مجدد نمی‌شود)", async () => {
  const env = makeEnv();
  env._raw.exec("UPDATE shipping_classes SET route_policy='normal' WHERE id=3; UPDATE products SET shipping_route_override='normal'");
  const o = (await call(env, "GET", "/api/store/orders/1")).data;
  assert.equal((o.order || o).shipping_route, "freight");
});

await test("Migration نشده: لیست/جزئیات سفارش‌ها نمی‌شکنند؛ فیلدها null و snapshot_available=false", async () => {
  const env = makeEnv({ legacy: true });
  const list = (await call(env, "GET", "/api/store/orders")).data;
  assert.equal(list.ok, true);
  assert.equal(list.orders.length, 3);
  assert.ok(list.orders.every((x) => x.shipping_route === null && x.shipping_snapshot_available === false));
  const det = (await call(env, "GET", "/api/store/orders/1")).data;
  assert.equal(det.ok, true);
  assert.equal((det.order || det).shipping_snapshot_available, false);
});

console.log("— عدم تغییر موتور (بررسی منبع) —");

import { readFileSync } from "node:fs";
await test("منطق Routing: ثابت‌ها و پیام Freight بدون تغییر (۳ روز، پیام مصوب، فقط normal/freight)", async () => {
  const src = readFileSync(new URL("../src/shipping-routing.js", import.meta.url), "utf8");
  assert.match(src, /max_dispatch_days: 3/);
  assert.match(src, /ROUTE_POLICY_VALUES = Object\.freeze\(\["normal", "freight"\]\)/);
  assert.match(src, /این محصول به دلیل ابعاد یا وزن، توسط باربری و به‌صورت پس‌کرایه ارسال می‌شود\./);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
