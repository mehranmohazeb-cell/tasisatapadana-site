// =========================================================================
// تست حداقلی و واقعی (نه Mock) برای هماهنگی recordShippingQuote/
// listShippingQuoteHistory با Schema واقعی جدول shipping_quote_history در
// D1 (طبق گزارش کاربر — نسخه واقعی deploy شده، نه Migration قدیمی موجود در
// database/shipping-providers-and-quotes.sql که دیگر با D1 واقعی مطابقت
// ندارد).
//
// این تست عمداً جدول را دقیقاً با همان ۹ ستون واقعی می‌سازد (نه بیشتر) تا
// اگر کد به هر ستون غیرواقعی (carrier, service, origin, destination_city,
// weight_grams, cart_value, quoted_cost, quote_id, metadata_json,
// ttl_seconds, quoted_at) نیاز داشته باشد، INSERT با SQLITE_ERROR شکست
// بخورد — دقیقاً همان نوع خطایی که در Production رخ داده بود.
//
// اجرا: node test/shipping-quote-history.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { recordShippingQuote, listShippingQuoteHistory } from "../src/shipping-engine.js";

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

// دقیقاً همان Schema واقعی گزارش‌شده توسط کاربر برای D1 — هیچ ستون اضافه‌ای
// ندارد (نه quoted_at، نه carrier/service/origin/destination_city/...).
function makeRealD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE shipping_quote_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_code TEXT NOT NULL,
      calculation_mode TEXT NOT NULL,
      request_json TEXT,
      response_json TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return wrapD1(db);
}

console.log("\n[شیپینگ] recordShippingQuote ↔ shipping_quote_history (Schema واقعی D1)\n");

await test("رکورد موفق (available: true) بدون خطای SQLITE روی Schema واقعی درج می‌شود", async () => {
  const env = { DB: makeRealD1() };
  const result = await recordShippingQuote(env, {
    provider_code: "tapin",
    calculation_mode: "online",
    destination_city: "تهران",
    destination_province: "تهران",
    weight_grams: 1200,
    cart_value: 450000,
    available: true,
    metadata: { raw: { ok: true, provider: "tapin", carrier: "tipax", cost: 85000 } },
  });
  assert.equal(result.ok, true, `انتظار درج موفق بود ولی خطا داد: ${result.error || ""}`);
});

await test("رکورد ناموفق (available: false) بدون خطای SQLITE درج و status/error_code ثبت می‌شود", async () => {
  const env = { DB: makeRealD1() };
  const result = await recordShippingQuote(env, {
    provider_code: "tapin",
    calculation_mode: "online",
    destination_city: "شهر ناشناخته",
    available: false,
    metadata: { raw: { ok: false, error: "NOT_FOUND", message: "Provider پیدا نشد." } },
  });
  assert.equal(result.ok, true, `انتظار درج موفق بود ولی خطا داد: ${result.error || ""}`);
});

await test("رکورد درج‌شده فقط شامل ستون‌های واقعی جدول است (status/error_code/error_message صحیح)", async () => {
  const env = { DB: makeRealD1() };
  await recordShippingQuote(env, {
    provider_code: "tapin",
    calculation_mode: "online",
    available: false,
    metadata: { raw: { ok: false, error: "PROXY_NETWORK_ERROR", message: "خطای شبکه" } },
  });
  const history = await listShippingQuoteHistory(env, { limit: 10 });
  assert.equal(history.length, 1);
  const row = history[0];
  assert.equal(row.provider_code, "tapin");
  assert.equal(row.calculation_mode, "online");
  assert.equal(row.status, "error");
  assert.equal(row.error_code, "PROXY_NETWORK_ERROR");
  assert.equal(row.error_message, "خطای شبکه");
  // این ستون‌ها دیگر در Schema واقعی وجود ندارند — نباید به‌عنوان ستون
  // فیزیکی روی row حاضر باشند (فقط JSON درون request_json/response_json).
  for (const removedColumn of [
    "carrier",
    "service",
    "origin",
    "destination_city",
    "weight_grams",
    "cart_value",
    "quoted_cost",
    "quote_id",
    "ttl_seconds",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(row, removedColumn),
      false,
      `ستون غیرواقعی "${removedColumn}" نباید به‌عنوان ستون فیزیکی در نتیجه Query حاضر باشد`
    );
  }
  // quoted_at فقط باید Alias محاسبه‌شده از created_at باشد (نه ستون مجزا)
  assert.equal(row.quoted_at, row.created_at);
});

await test("عدم NOT NULL بودن provider_code/calculation_mode باعث خطای Constraint می‌شود (نه Silent Fail)", async () => {
  const env = { DB: makeRealD1() };
  const result = await recordShippingQuote(env, {
    // provider_code عمداً حذف شده تا رفتار NOT NULL واقعی تأیید شود
    calculation_mode: "online",
    available: true,
  });
  assert.equal(result.ok, false, "انتظار می‌رفت Constraint واقعی NOT NULL باعث شکست کنترل‌شده شود");
});

console.log(`\n# نتیجه: ${passed} موفق، ${failed} ناموفق (از مجموع ${passed + failed})`);
if (failed > 0) process.exit(1);
