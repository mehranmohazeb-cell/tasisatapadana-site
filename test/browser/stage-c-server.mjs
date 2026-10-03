// سرور آزمایشی مرورگر Stage C (فقط برای تست؛ بخشی از Production نیست).
// Worker واقعی (src/index.js) + D1 آزمایشی (node:sqlite) + ASSETS = فایل‌های واقعی public/.
// هم صفحهٔ Admin و هم صفحهٔ عمومی SSR محصول (/store/product/:slug) را از Worker واقعی می‌دهد.
// اجرا: node --no-warnings test/browser/stage-c-server.mjs [port]
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker from "../../src/index.js";

export const LEGACY_COST = 987654, LEGACY_METHOD = "روش-قدیمی-تست", LEGACY_TIME = "زمان-قدیمی-تست";

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

const root = fileURLToPath(new URL("../../public", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

function staticFile(pathname) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE packaging_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, length_tolerance_cm REAL DEFAULT 0, width_tolerance_cm REAL DEFAULT 0, height_tolerance_cm REAL DEFAULT 0, weight_tolerance_grams INTEGER DEFAULT 0, weight_tolerance_percent REAL DEFAULT 0, min_package_length_cm REAL DEFAULT 10, min_package_width_cm REAL DEFAULT 10, min_package_height_cm REAL DEFAULT 5, min_shipping_weight_grams INTEGER DEFAULT 200, protection_level TEXT DEFAULT 'standard', packaging_group TEXT, allow_combine_with_other_items INTEGER DEFAULT 1, require_separate_shipment INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
  INSERT INTO packaging_profiles (id,code,name,is_default) VALUES (1,'GENERIC','عمومی',1);
  INSERT INTO packaging_profiles (id,code,name) VALUES (2,'FACTORY_PACKAGED','دارای بسته‌بندی کارخانه‌ای');
  CREATE TABLE shipping_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, default_packaging_profile_id INTEGER, route_policy TEXT, created_at TEXT, updated_at TEXT);
  INSERT INTO shipping_classes (id,name,default_packaging_profile_id,route_policy) VALUES (1,'کالای عادی',NULL,'normal'),(2,'پکیج و آبگرمکن',2,'normal'),(3,'رادیاتور',NULL,'freight');
  CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, description TEXT, price INTEGER, image TEXT, stock INTEGER, active INTEGER DEFAULT 1,
    brand TEXT, model TEXT, sku TEXT, compare_at_price INTEGER, shipping_cost INTEGER, shipping_method TEXT, shipping_time TEXT,
    warranty_months INTEGER, warranty_provider TEXT, return_days INTEGER, category_id INTEGER,
    shipping_class_id INTEGER, weight_grams INTEGER, length_cm REAL, width_cm REAL, height_cm REAL, packaging_profile_id INTEGER,
    package_length_cm REAL, package_width_cm REAL, package_height_cm REAL, package_weight_grams INTEGER, packaging_confidence TEXT, shipping_route_override TEXT);
  INSERT INTO products (id,name,slug,description,price,image,stock,active,brand,model,sku,warranty_months,return_days,shipping_cost,shipping_method,shipping_time,shipping_class_id,weight_grams,length_cm,width_cm,height_cm)
    VALUES (1,'پکیج تست','pkg-test','<p>توضیح پکیج</p>',5000000,'/img/a.jpg',3,1,'برند','مدل','SKU1',12,7,${LEGACY_COST},'${LEGACY_METHOD}','${LEGACY_TIME}',2,36000,46,24,69);
  INSERT INTO products (id,name,slug,description,price,image,stock,active,brand,model,sku) VALUES (2,'رادیاتور تست','rad-test','<p>x</p>',1000000,'/img/b.jpg',5,1,'برند','مدل','SKU2');
  CREATE TABLE product_images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, image TEXT, alt TEXT, sort_order INTEGER DEFAULT 0);
  CREATE TABLE product_specs (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, label TEXT, value TEXT, sort_order INTEGER DEFAULT 0);
  CREATE TABLE shipping_route_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT, changed_at TEXT);
`);
const env = {
  DB: wrapD1(db), ADMIN_TOKEN: "adm", _raw: db,
  ASSETS: { fetch: async (req) => {
    const f = staticFile(new URL(req.url).pathname);
    if (!f) return new Response("not found", { status: 404 });
    return new Response(readFileSync(f), { headers: { "content-type": MIME[extname(f)] || "application/octet-stream" } });
  } },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/__test/sql") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(db.prepare(url.searchParams.get("q")).all()));
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/store/product/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await worker.fetch(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env, {});
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const f = staticFile(url.pathname);
    if (!f) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end(String(e.stack || e));
  }
});
const port = Number(process.argv[2] || 8797);
server.listen(port, "127.0.0.1", () => console.log(`READY http://127.0.0.1:${port}`));
