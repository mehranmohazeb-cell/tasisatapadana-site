// =========================================================================
// تست Save/Load «حالت محاسبه ارسال» + خود Migration واقعی
// (database/shipping-calculation-mode-v2.sql ↔ site_settings)
//
// این تست به‌جای ساختن دستی یک Schema «از قبل مهاجرت‌شده»، دقیقاً همان
// فایل Migration واقعی (database/shipping-calculation-mode-v2.sql) را روی
// یک Schema شبیه‌سازی‌شده از وضعیت فعلی D1 Production اجرا می‌کند — یعنی
// خودِ Migration را هم تست می‌کند، نه فقط نتیجه فرضی آن را.
//
// Schema پیش از Migration دقیقاً طبق خطای واقعی مشاهده‌شده روی Production
// ساخته شده: CHECK قدیمی فقط 'table_rate'/'engine' را مجاز می‌دانست
// ("CHECK constraint failed: shipping_calculation_mode IN
// (table_rate, 'engine)"). یک ستون کاملاً ناشناخته/فرضی («mystery_column»)
// هم عمداً به Schema پیش از Migration اضافه شده تا ثابت شود روش
// rename→add→migrate→drop این Migration، بر خلاف بازسازی کامل جدول، حتی
// ستون‌های ناشناخته/مستندنشدهٔ احتمالی Production را هم از دست نمی‌دهد.
//
// معیارهای خواسته‌شده:
//   - مقدار پیش‌فرض ("internal" در سطح کد، معادل 'engine' در D1).
//   - ذخیره "engine" (از طریق مقدار کد "internal").
//   - ذخیره "table_rate" در صورت معتبر بودن (فقط برای خواندن/سازگاری قدیمی).
//   - ذخیره "online".
//   - Load بعد از Save.
//   - رد مقدار نامعتبر (هم در سطح کد، هم CHECK واقعی D1).
//   - هیچ ستون دیگری (حتی ناشناخته) توسط Migration حذف نمی‌شود.
//
// اجرا: node test/shipping-calculation-mode.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getShippingCalculationMode, setShippingCalculationMode } from "../src/shipping-engine.js";

const MIGRATION_SQL = fs.readFileSync(
  new URL("../database/shipping-calculation-mode-v2.sql", import.meta.url),
  "utf8"
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    }
  })();
}

function wrapD1(sqliteDb) {
  return {
    prepare(sql) {
      return {
        bind: (...args) => ({
          first: async () => sqliteDb.prepare(sql).get(...args) ?? null,
          all: async () => ({ results: sqliteDb.prepare(sql).all(...args) }),
          run: async () => sqliteDb.prepare(sql).run(...args),
        }),
        first: async () => sqliteDb.prepare(sql).get() ?? null,
        all: async () => ({ results: sqliteDb.prepare(sql).all() }),
        run: async () => sqliteDb.prepare(sql).run(),
      };
    },
  };
}

// Schema پیش از Migration = دقیقاً وضعیت واقعی گزارش‌شده روی Production،
// به‌علاوه یک ستون ناشناخته که در هیچ Migration این پروژه ثبت نشده —
// برای اثبات اینکه Migration جدید آن را از دست نمی‌دهد.
function makePreMigrationDb(initialMode) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE site_settings (
      id                       INTEGER PRIMARY KEY CHECK (id = 1),
      store_status             TEXT NOT NULL DEFAULT 'open',
      services_status          TEXT NOT NULL DEFAULT 'open',
      store_updated_at         TEXT,
      services_updated_at      TEXT,
      show_categories_public   INTEGER NOT NULL DEFAULT 0,
      show_related_products    INTEGER NOT NULL DEFAULT 0,
      show_similar_products    INTEGER NOT NULL DEFAULT 0,
      show_cart_suggestions    INTEGER NOT NULL DEFAULT 0,
      shipping_calculation_mode TEXT NOT NULL DEFAULT 'internal'
        CHECK (shipping_calculation_mode IN ('table_rate', 'engine')),
      mystery_column TEXT DEFAULT 'do-not-lose-me'
    );
    INSERT INTO site_settings (id, store_status, services_status, shipping_calculation_mode)
    VALUES (1, 'open', 'open', '${initialMode ?? "table_rate"}');
  `);
  db.exec(MIGRATION_SQL);
  return wrapD1(db);
}

console.log("\n[شیپینگ] Migration واقعی + Save/Load حالت محاسبه ارسال\n");

await test('بعد از اجرای Migration، ستون ناشناخته Production ("mystery_column") حذف نمی‌شود', async () => {
  const env = { DB: makePreMigrationDb("table_rate") };
  const row = await env.DB.prepare("SELECT mystery_column FROM site_settings WHERE id=1").first();
  assert.equal(row.mystery_column, "do-not-lose-me");
});

await test('مقدار قدیمی "table_rate" بعد از Migration دست‌نخورده باقی می‌ماند و به "internal" تعبیر می‌شود', async () => {
  const env = { DB: makePreMigrationDb("table_rate") };
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('ذخیره حالت "internal" در D1 به‌صورت \'engine\' نوشته می‌شود و بدون خطای CHECK موفق است', async () => {
  const env = { DB: makePreMigrationDb("table_rate") };
  const result = await setShippingCalculationMode(env, "internal");
  assert.equal(result.ok, true, `انتظار موفقیت بود ولی خطا داد: ${result.error || ""}`);
  const raw = await env.DB.prepare("SELECT shipping_calculation_mode FROM site_settings WHERE id=1").first();
  assert.equal(raw.shipping_calculation_mode, "engine");
});

await test('ذخیره "online" دیگر با خطای CHECK constraint شکست نمی‌خورد', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  const result = await setShippingCalculationMode(env, "online");
  assert.equal(result.ok, true, `انتظار موفقیت بود ولی خطا داد: ${result.error || ""}`);
});

await test('پس از ذخیره "online"، خواندن مجدد (شبیه‌سازی Refresh) همان مقدار "online" را برمی‌گرداند', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  await setShippingCalculationMode(env, "online");
  assert.equal(await getShippingCalculationMode(env), "online");
});

await test('ذخیره "online_fallback_internal" هم بدون خطای CHECK موفق است و درست Load می‌شود', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  const result = await setShippingCalculationMode(env, "online_fallback_internal");
  assert.equal(result.ok, true, `انتظار موفقیت بود ولی خطا داد: ${result.error || ""}`);
  assert.equal(await getShippingCalculationMode(env), "online_fallback_internal");
});

await test('انتخاب مجدد "internal" پس از یک "online" قبلی، دوباره قابل ذخیره است', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  await setShippingCalculationMode(env, "online");
  const result = await setShippingCalculationMode(env, "internal");
  assert.equal(result.ok, true);
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('مقدار نامعتبر در سطح کد قبل از رسیدن به D1 رد می‌شود (Validation)', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  const result = await setShippingCalculationMode(env, "not_a_real_mode");
  assert.equal(result.ok, false);
  assert.equal(result.error, "INVALID_MODE");
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('بعد از Migration، CHECK واقعی D1 هم مقدار خارج از فهرست مجاز را در سطح دیتابیس رد می‌کند', async () => {
  const env = { DB: makePreMigrationDb("engine") };
  await assert.rejects(
    () => env.DB.prepare("UPDATE site_settings SET shipping_calculation_mode = 'not_allowed' WHERE id=1").run(),
    /CHECK constraint failed/
  );
});

console.log(`\n# نتیجه: ${passed} موفق، ${failed} ناموفق (از مجموع ${passed + failed})`);
if (failed > 0) process.exit(1);
