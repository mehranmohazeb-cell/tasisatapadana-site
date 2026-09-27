// =========================================================================
// تست‌های واقعی اتصال Worker → Integration Proxy موجود (/api/v1/tapin/quote) → Tapin
// =========================================================================
// این فایل جایگزین نسخه قبلی (که فرض «/tapin/request» عمومی را تست می‌کرد)
// شده، چون آن مسیر طبق دستور جدید کاربر باید کنار گذاشته شود — ساختار واقعی
// VPS (routers/tapin.py, prefix /api/v1/tapin) اکنون مبنا است.
//
// همان‌طور که در گزارش نهایی این مرحله هم آمده: کد واقعی Python سمت VPS
// (routers/tapin.py, integrations/tapin.py) هرگز در اختیار این محیط نبوده،
// پس این تست‌ها فقط رفتار Worker (src/shipping-engine.js) را با Mock کردن
// fetch تأیید می‌کنند؛ قرارداد دقیق Request/Response با Proxy یک فرض مستند
// است (به کامنت‌های src/shipping-engine.js و گزارش نهایی مراجعه کنید).
//
// اجرا:  node test/tapin-proxy.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { quoteViaTapin, findTapinCityMatch, getShippingOptionsViaEngine } from "../src/shipping-engine.js";

let passed = 0;
let failed = 0;
function test(name, fn) {
  return fn()
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    });
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

function makeDbWithTapinConfig(configOverrides = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE shipping_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'disabled',
      mode TEXT NOT NULL DEFAULT 'quote',
      fallback_provider_code TEXT,
      config_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  const config = {
    product_type_id: 1,
    packing_type_id: 2,
    payment_type: 10,
    service_type: 7,
    delivery_type: 10,
    type_pickup: 10,
    default_packaging_weight_grams: 500,
    ...configOverrides,
  };
  db.prepare(
    "INSERT INTO shipping_providers (code, status, mode, fallback_provider_code, config_json) VALUES ('internal','active','quote',NULL,NULL), ('tapin', ?, 'quote', 'internal', ?)"
  ).run("active", JSON.stringify(config));
  return wrapD1(db);
}

const REAL_PROXY_KEY = "proxy-secret-key-should-never-leak";
const DEFAULT_PROXY_URL = "https://proxy.tasisatapadanaesfahan.ir/api/v1/tapin/quote";

function baseEnv(overrides = {}) {
  return {
    DB: makeDbWithTapinConfig(),
    PROXY_API_KEY: REAL_PROXY_KEY,
    ...overrides,
  };
}

function installMockFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

const sampleItems = [{ price: 100000, weightGrams: 500, quantity: 1 }];

await test("Worker فقط /api/v1/tapin/quote را صدا می‌زند — نه /tapin/request قدیمی، نه api.tapin.ir", async () => {
  const mock = installMockFetch((url) => {
    if (String(url).includes("api.tapin.ir")) throw new Error("نباید مستقیماً api.tapin.ir صدا زده شود");
    if (String(url).includes("/tapin/request")) throw new Error("مسیر قدیمی /tapin/request نباید دیگر استفاده شود");
    return jsonResponse({
      ok: true,
      cost: 15000,
      currency: "IRT",
      matched_city: { city_id: 111, province_id: 10, city_title: "اصفهان", province_title: "اصفهان" },
      quote_id: null,
      tracking: null,
    });
  });
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, DEFAULT_PROXY_URL);
  } finally {
    mock.restore();
  }
});

await test("Header و بدنه درخواست به Proxy صحیح ساخته می‌شود (نام شهر خام + config از D1)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, `Bearer ${REAL_PROXY_KEY}`);
    assert.equal(body.destination_city, "اصفهان");
    assert.equal(body.product_type_id, 1);
    assert.equal(body.packing_type_id, 2);
    assert.equal(body.payment_type, 10);
    assert.equal(body.service_type, 7);
    assert.equal(body.delivery_type, 10);
    assert.equal(body.type_pickup, 10);
    assert.equal(body.length, 5);
    assert.equal(body.width, 5);
    assert.equal(body.height, 5);
    assert.equal(body.weight_package, 500);
    assert.equal(body.products[0].count_per_amount, 1_000_000);
    assert.equal(body.products[0].weight_per_count, 500);
    assert.equal(body.shop_id, undefined);
    assert.equal(body.token, undefined);
    assert.equal(body.authorization, undefined);
    return jsonResponse({ ok: true, cost: 15000, currency: "IRT", matched_city: null, quote_id: null, tracking: null });
  });
  try {
    await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
  } finally {
    mock.restore();
  }
});

await test("بدون PROXY_API_KEY هرگز fetch اجرا نمی‌شود", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const result = await quoteViaTapin(baseEnv({ PROXY_API_KEY: undefined }), {
      destinationCity: "اصفهان",
      items: sampleItems,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_CREDENTIALS_MISSING");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("config_json ناقص → TAPIN_CONFIG_INCOMPLETE بدون هیچ تماس شبکه", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const env = baseEnv({ DB: makeDbWithTapinConfig({ service_type: undefined }) });
    const result = await quoteViaTapin(env, { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_CONFIG_INCOMPLETE");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("پاسخ منطقی ناموفق Proxy (CITY_NOT_FOUND) بدون تفسیر اضافه Passthrough می‌شود", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({ ok: false, error: "CITY_NOT_FOUND", message: "شهر پیدا نشد" })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "شهر خیالی", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "CITY_NOT_FOUND");
  } finally {
    mock.restore();
  }
});

await test("پاسخ منطقی ناموفق Proxy (AMBIGUOUS_CITY_NAME) همراه candidates حفظ می‌شود", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({ ok: false, error: "AMBIGUOUS_CITY_NAME", message: "چند شهر", candidates: [{ cityId: 1 }, { cityId: 2 }] })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "ری", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "AMBIGUOUS_CITY_NAME");
    assert.equal(result.candidates.length, 2);
  } finally {
    mock.restore();
  }
});

await test("خطای HTTP سطح Proxy (غیر ۲xx) → PROXY_HTTP_ERROR", async () => {
  const mock = installMockFetch(() => jsonResponse({ message: "قطع سرویس" }, { ok: false, status: 502 }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_HTTP_ERROR");
    assert.equal(result.status, 502);
  } finally {
    mock.restore();
  }
});

await test("خطای شبکه در تماس با Proxy → PROXY_NETWORK_ERROR", async () => {
  const original = global.fetch;
  global.fetch = async () => {
    throw new Error("connection refused");
  };
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_NETWORK_ERROR");
  } finally {
    global.fetch = original;
  }
});

await test("پاسخ غیرقابل‌Parse از Proxy → PROXY_INVALID_RESPONSE", async () => {
  const mock = installMockFetch(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("bad json");
    },
  }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_INVALID_RESPONSE");
  } finally {
    mock.restore();
  }
});

await test("در صورت موفقیت، cost/matched_city/quote_id/tracking از پاسخ Proxy درست map می‌شوند", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({
      ok: true,
      cost: 15000,
      currency: "IRT",
      matched_city: { city_id: 111, province_id: 10, city_title: "اصفهان", province_title: "اصفهان" },
      quote_id: null,
      tracking: null,
    })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "tapin");
    assert.equal(result.cost, 15000);
    assert.equal(result.currency, "IRT");
    assert.equal(result.quote_id, null);
    assert.equal(result.tracking, null);
    assert.equal(result.metadata.matched_city.city_id, 111);
  } finally {
    mock.restore();
  }
});

await test("سازگاری قدیمی: اگر Proxy هنوز price_send_total خام (ریال) برگرداند، Worker همچنان ÷۱۰ می‌کند", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true, price_send_total: 150000 }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    assert.equal(result.ok, true);
    assert.equal(result.cost, 15000);
  } finally {
    mock.restore();
  }
});

await test("Secret (PROXY_API_KEY) در نتیجه برگشتی نشت نمی‌کند", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true, cost: 15000 }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(REAL_PROXY_KEY), "PROXY_API_KEY نباید در نتیجه ظاهر شود");
  } finally {
    mock.restore();
  }
});

await test("آدرس/مسیر Proxy با env.INTEGRATION_PROXY_BASE_URL/QUOTE_PATH قابل‌تنظیم است (نه از ورودی کاربر)", async () => {
  const mock = installMockFetch((url) => {
    assert.equal(url, "https://custom-proxy.example.com/custom/quote-path");
    return jsonResponse({ ok: true, cost: 1000 });
  });
  try {
    await quoteViaTapin(
      baseEnv({
        INTEGRATION_PROXY_BASE_URL: "https://custom-proxy.example.com",
        INTEGRATION_PROXY_TAPIN_QUOTE_PATH: "/custom/quote-path",
      }),
      { destinationCity: "اصفهان", items: sampleItems }
    );
  } finally {
    mock.restore();
  }
});

await test("findTapinCityMatch (تابع خالص City Mapping) هنوز به‌عنوان مرجع/تست در دسترس و صحیح است", async () => {
  const cities = [{ pk: 111, title: "اصفهان", province_pk: 10, province_title: "اصفهان" }];
  const match = findTapinCityMatch(cities, "اصفهان");
  assert.equal(match.matched, true);
  assert.equal(match.cityId, 111);
});

await test("Fallback موتور داخلی Shipping Engine وقتی Proxy/Tapin شکست بخورد سالم است", async () => {
  const mock = installMockFetch(() => jsonResponse({ message: "قطع VPS" }, { ok: false, status: 502 }));
  try {
    const internalOptionsFn = async () => [{ id: 1, name: "پست پیشتاز", cost: 45000, cost_type: "flat", scope: "global" }];
    const dbRaw = new DatabaseSync(":memory:");
    dbRaw.exec(`
      CREATE TABLE shipping_providers (id INTEGER PRIMARY KEY, code TEXT UNIQUE, status TEXT, mode TEXT, fallback_provider_code TEXT, config_json TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE site_settings (id INTEGER PRIMARY KEY, shipping_calculation_mode TEXT);
      INSERT INTO shipping_providers (code, status, mode, fallback_provider_code, config_json, sort_order) VALUES
        ('internal','active','quote',NULL,NULL,10),
        ('tapin','active','quote','internal', ?, 20);
      INSERT INTO site_settings (id, shipping_calculation_mode) VALUES (1, 'online_fallback_internal');
    `.replace("?", `'${JSON.stringify({
      product_type_id: 1, packing_type_id: 2, payment_type: 10, service_type: 7, delivery_type: 10, type_pickup: 10,
    }).replace(/'/g, "''")}'`));
    const wrappedEnv = { PROXY_API_KEY: REAL_PROXY_KEY, DB: wrapD1(dbRaw) };

    const engineResult = await getShippingOptionsViaEngine(wrappedEnv, {
      cartItems: sampleItems,
      city: "اصفهان",
      internalOptionsFn,
    });
    assert.equal(engineResult.fell_back, true);
    assert.equal(engineResult.results.length, 1);
    assert.equal(engineResult.results[0].cost, 45000);
    assert.equal(engineResult.results[0].provider, "internal");
  } finally {
    mock.restore();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
