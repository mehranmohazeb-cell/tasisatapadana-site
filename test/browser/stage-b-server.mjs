// سرور آزمایشی مرورگر (فقط برای تست؛ بخشی از Production نیست).
// فایل‌های public/ را سرو می‌کند و /api/* را به Worker واقعی با D1 آزمایشی (node:sqlite) می‌فرستد.
// اجرا: node --no-warnings test/browser/stage-b-server.mjs [port]
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import worker from "../../src/index.js";

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


const env = makeEnv();
// ردیف‌های لازم برای لیست محصولات صفحهٔ Admin (فقط داده، نه منطق)
const root = fileURLToPath(new URL("../../public", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/__test/sql") { // فقط‌خواندنی + اجرای کنترل‌شده برای Seed
      const sql = url.searchParams.get("q");
      const rows = env._raw.prepare(sql).all();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(rows));
    }
    if (url.pathname === "/__test/exec") {
      env._raw.exec(url.searchParams.get("q"));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await worker.fetch(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, {});
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, p);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(e.stack || e));
  }
});
const port = Number(process.argv[2] || 8799);
server.listen(port, "127.0.0.1", () => console.log(`READY http://127.0.0.1:${port}`));
