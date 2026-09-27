// =========================================================================
// تست کوچک و محدود — Save/Load «حالت محاسبه ارسال»
// (getShippingCalculationMode / setShippingCalculationMode ↔ site_settings)
//
// دقیقاً همان معیارهای خواسته‌شده را پوشش می‌دهد:
//   - حالت پیش‌فرض "internal" وقتی مقداری ذخیره نشده.
//   - انتخاب "online" ذخیره می‌شود.
//   - پس از یک خواندن مجدد (شبیه‌سازی Refresh صفحه) مقدار "online" برمی‌گردد.
//   - انتخاب مجدد "internal" قابل ذخیره است.
//   - رفتار Fail-Safe برای مقدار قدیمی/نامعتبر "table_rate" حفظ شده.
//
// اجرا: node test/shipping-calculation-mode.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { getShippingCalculationMode, setShippingCalculationMode } from "../src/shipping-engine.js";

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

// دقیقاً همان Schema مستندشده در database/site-status.sql +
// ALTER اضافه‌شده در database/shipping-providers-and-quotes.sql
function makeSiteSettingsDb(initialMode) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE site_settings (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      store_status        TEXT NOT NULL DEFAULT 'open',
      services_status     TEXT NOT NULL DEFAULT 'open',
      store_updated_at    TEXT,
      services_updated_at TEXT
    );
    ALTER TABLE site_settings ADD COLUMN shipping_calculation_mode TEXT NOT NULL DEFAULT 'internal';
  `);
  if (initialMode !== undefined) {
    db.exec(
      `INSERT INTO site_settings (id, store_status, services_status, shipping_calculation_mode) ` +
      `VALUES (1, 'open', 'open', '${initialMode}');`
    );
  }
  return wrapD1(db);
}

console.log("\n[شیپینگ] Save/Load حالت محاسبه ارسال (site_settings.shipping_calculation_mode)\n");

await test('پیش از هر Save، مقدار پیش‌فرض "internal" برگردانده می‌شود (رکورد خالی)', async () => {
  const env = { DB: makeSiteSettingsDb() };
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('انتخاب "online" با موفقیت ذخیره می‌شود', async () => {
  const env = { DB: makeSiteSettingsDb("internal") };
  const result = await setShippingCalculationMode(env, "online");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "online");
});

await test('پس از Save، یک خواندن مجدد (شبیه‌سازی Refresh) مقدار "online" را برمی‌گرداند', async () => {
  const env = { DB: makeSiteSettingsDb("internal") };
  await setShippingCalculationMode(env, "online");
  assert.equal(await getShippingCalculationMode(env), "online");
});

await test('انتخاب مجدد "internal" پس از یک "online" قبلی، دوباره قابل ذخیره است', async () => {
  const env = { DB: makeSiteSettingsDb("internal") };
  await setShippingCalculationMode(env, "online");
  const result = await setShippingCalculationMode(env, "internal");
  assert.equal(result.ok, true);
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('مقدار قدیمی/نامعتبر "table_rate" همچنان Fail-Safe به "internal" تعبیر می‌شود', async () => {
  const env = { DB: makeSiteSettingsDb("table_rate") };
  assert.equal(await getShippingCalculationMode(env), "internal");
});

await test('مقدار نامعتبر برای Save رد می‌شود (Validation دست‌نخورده)', async () => {
  const env = { DB: makeSiteSettingsDb("internal") };
  const result = await setShippingCalculationMode(env, "not_a_real_mode");
  assert.equal(result.ok, false);
  assert.equal(result.error, "INVALID_MODE");
  // نباید چیزی تغییر کرده باشد
  assert.equal(await getShippingCalculationMode(env), "internal");
});

console.log(`\n# نتیجه: ${passed} موفق، ${failed} ناموفق (از مجموع ${passed + failed})`);
if (failed > 0) process.exit(1);
