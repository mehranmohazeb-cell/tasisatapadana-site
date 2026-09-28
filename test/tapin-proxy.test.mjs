// =========================================================================
// تست‌های واقعی Tapin Adapter — قرارداد رسمی follow-tapin-tipax-1.pdf
// =========================================================================
// این نسخه جایگزین تست‌های قبلی (که فرض فیلدهای نادرست count_per_amount/
// weight_package/type_pickup و ابعاد ثابت ۵×۵×۵ را تست می‌کردند) شده است.
//
// محدودیت صادقانه (باید در گزارش نهایی هم تکرار شود): این Sandbox هیچ
// دسترسی شبکه/SSH به VPS واقعی یا api.tapin.ir ندارد. این تست‌ها فقط منطق
// Worker (src/shipping-engine.js) را با fetch/D1 موک‌شده تأیید می‌کنند —
// نه یک Round-trip واقعی با Tapin. قرارداد دقیق Response واقعی Tapin هرگز
// در این محیط دیده نشده؛ فرض روی entries.total_send_price دقیقاً همان چیزی
// است که PDF مستند کرده، نه چیزی که با پاسخ زنده تأیید شده باشد.
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
      console.log(`    ${error.stack || error.message}`);
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

// طبق دستور توسعه، shipping_providers تنها جدولی است که این Adapter واقعاً
// به آن نیاز دارد؛ packaging_profiles/shipping_classes عمداً در این DB
// ساخته نمی‌شوند تا مسیر Fail-Safe (بخش «داده ناقص») هم واقعاً تست شود —
// وقتی محصول تست به override کامل بسته‌بندی نیاز دارد، مستقیماً در productRows
// داده می‌شود، نه از این DB خوانده می‌شود.
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
    delivery_type: 10,
    pickup_type: 20,
    origin_city: "اصفهان",
    service_type_local: 7,
    service_type_domestic: 2,
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

// محصول تست دقیقاً همان مثال ساختاری بخش ۲۶ دستور: پکیج آدنا ۲۴ —
// وزن کالا ۳۲۰۰۰ گرم، بسته‌بندی ۸۰×۴۵×۳۵ و ۱۵۰۰ گرم Override واقعی.
const adenaProduct = {
  id: 1,
  name: "پکیج آدنا ۲۴",
  weight_grams: 32000,
  length_cm: null,
  width_cm: null,
  height_cm: null,
  shipping_class_id: null,
  packaging_profile_id: null,
  package_length_cm: 80,
  package_width_cm: 45,
  package_height_cm: 35,
  package_weight_grams: 1500,
  packaging_confidence: null,
};

const sampleItems = [{ productId: 1, price: 112_000_000, quantity: 1 }];
const sampleProductRows = [adenaProduct];

await test("Worker فقط /api/v1/tapin/quote را صدا می‌زند", async () => {
  const mock = installMockFetch((url) => {
    if (String(url).includes("api.tapin.ir")) throw new Error("نباید مستقیماً api.tapin.ir صدا زده شود");
    return jsonResponse({ ok: true, entries: { total_send_price: 150000 } });
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "تهران",
      items: sampleItems,
      productRows: sampleProductRows,
    });
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, DEFAULT_PROXY_URL);
  } finally {
    mock.restore();
  }
});

await test("بدنه درخواست دقیقاً با نام فیلدهای رسمی Tapin ساخته می‌شود (نه نام‌های نادرست قبلی)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, `Bearer ${REAL_PROXY_KEY}`);
    assert.equal(body.destination_city, "تهران");
    assert.equal(body.product_type_id, 1);
    assert.equal(body.packing_type_id, 2);
    assert.equal(body.payment_type, 10);
    assert.equal(body.delivery_type, 10);
    assert.equal(body.pickup_type, 20);
    // ابعاد واقعی بسته (Override) — نه ۵×۵×۵ ثابت نسخه قبلی:
    assert.equal(body.length, 80);
    assert.equal(body.width, 45);
    assert.equal(body.height, 35);
    assert.equal(body.package_weight, 1500);
    // نام دقیق فیلدهای products[] طبق PDF:
    const product = body.products[0];
    assert.equal(product.discount_per_count, 0);
    assert.equal(product.amount_per_count, 1_120_000_000); // ۱۱۲,۰۰۰,۰۰۰ تومان × ۱۰
    assert.equal(product.weight_per_count, 32000); // وزن کالا، مستقل از وزن بسته‌بندی
    assert.equal(product.count, 1);
    // نام‌های نادرست نسخه قبلی نباید دیگر وجود داشته باشند:
    assert.equal(body.count_per_amount, undefined);
    assert.equal(body.type_pickup, undefined);
    assert.equal(body.weight_package, undefined);
    assert.equal(body.shop_id, undefined);
    return jsonResponse({ ok: true, entries: { total_send_price: 150000 } });
  });
  try {
    await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
  } finally {
    mock.restore();
  }
});

await test("service_type پویا: مبدأ=مقصد → اکسپرس درون‌شهری (7)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.service_type, 7);
    return jsonResponse({ ok: true, entries: { total_send_price: 100000 } });
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان", // = config.origin_city
      items: sampleItems,
      productRows: sampleProductRows,
    });
    assert.equal(result.service, "اکسپرس درون‌شهری");
  } finally {
    mock.restore();
  }
});

await test("service_type پویا: مبدأ≠مقصد → اکسپرس ویژه بین‌شهری (2)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.service_type, 2);
    return jsonResponse({ ok: true, entries: { total_send_price: 100000 } });
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "تهران",
      items: sampleItems,
      productRows: sampleProductRows,
    });
    assert.equal(result.service, "اکسپرس ویژه بین‌شهری");
  } finally {
    mock.restore();
  }
});

await test("چند قلم کالای متفاوت در سبد → TAPIN_MULTI_PACKAGE_UNSUPPORTED، بدون هیچ تماس شبکه", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const secondProduct = { ...adenaProduct, id: 2, name: "شیر برقی" };
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "تهران",
      items: [
        { productId: 1, price: 112_000_000, quantity: 1 },
        { productId: 2, price: 500_000, quantity: 1 },
      ],
      productRows: [adenaProduct, secondProduct],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_MULTI_PACKAGE_UNSUPPORTED");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("ابعاد/وزن ناقص (نه Override و نه ابعاد پایه کامل) → TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE، بدون تماس شبکه", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const incompleteProduct = {
      id: 3,
      name: "محصول بدون داده بسته‌بندی",
      weight_grams: null,
      length_cm: null,
      width_cm: null,
      height_cm: null,
      shipping_class_id: null,
      packaging_profile_id: null,
      package_length_cm: null,
      package_width_cm: null,
      package_height_cm: null,
      package_weight_grams: null,
    };
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "تهران",
      items: [{ productId: 3, price: 100000, quantity: 1 }],
      productRows: [incompleteProduct],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE");
    assert.equal(mock.calls.length, 0);
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
      productRows: sampleProductRows,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_CREDENTIALS_MISSING");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("config_json ناقص (مثلاً بدون pickup_type) → TAPIN_CONFIG_INCOMPLETE بدون تماس شبکه", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const env = baseEnv({ DB: makeDbWithTapinConfig({ pickup_type: undefined }) });
    const result = await quoteViaTapin(env, { destinationCity: "اصفهان", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_CONFIG_INCOMPLETE");
    assert.ok(result.message.includes("pickup_type"));
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("پاسخ منطقی ناموفق Proxy (AMBIGUOUS_CITY_NAME) همراه candidates حفظ می‌شود", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({ ok: false, error: "AMBIGUOUS_CITY_NAME", message: "چند شهر", candidates: [{ cityId: 1 }, { cityId: 2 }] })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "ری", items: sampleItems, productRows: sampleProductRows });
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
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems, productRows: sampleProductRows });
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
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems, productRows: sampleProductRows });
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
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "اصفهان", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_INVALID_RESPONSE");
  } finally {
    mock.restore();
  }
});

await test("موفقیت: entries.total_send_price (ریال، مستند PDF) درست به تومان تبدیل می‌شود", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({
      ok: true,
      entries: { total_send_price: 150000, total_weight: 33500 },
      quote_id: "q-123",
      tracking: null,
    })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "tapin");
    assert.equal(result.cost, 15000); // ۱۵۰,۰۰۰ ریال ÷ ۱۰ = ۱۵,۰۰۰ تومان
    assert.equal(result.currency, "IRT");
    assert.equal(result.quote_id, "q-123");
  } finally {
    mock.restore();
  }
});

await test("پاسخ بدون entries.total_send_price (مثلاً فقط cost/price_send_total حدسی) → TAPIN_RESPONSE_UNRECOGNIZED، نه قیمت/رایگان", async () => {
  for (const payload of [{ ok: true, price_send_total: 150000 }, { ok: true, cost: 15000 }]) {
    const mock = installMockFetch(() => jsonResponse(payload));
    try {
      const result = await quoteViaTapin(baseEnv(), { destinationCity: "", items: sampleItems, productRows: sampleProductRows });
      assert.equal(result.ok, false);
      assert.equal(result.error, "TAPIN_RESPONSE_UNRECOGNIZED");
    } finally {
      mock.restore();
    }
  }
});

await test("destination_province فقط با TAPIN_PROXY_SEND_PROVINCE=true به Proxy فرستاده می‌شود", async () => {
  const req = { destinationCity: "ورامین", destinationProvince: "تهران", items: sampleItems, productRows: sampleProductRows };
  let mock = installMockFetch((url, opts) => { globalThis.__body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    await quoteViaTapin(baseEnv(), req);
    assert.equal("destination_province" in globalThis.__body, false);
    await quoteViaTapin({ ...baseEnv(), TAPIN_PROXY_SEND_PROVINCE: "true" }, req);
    assert.equal(globalThis.__body.destination_province, "تهران");
  } finally { mock.restore(); }
});

await test("Secret (PROXY_API_KEY) در نتیجه برگشتی نشت نمی‌کند", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true, entries: { total_send_price: 150000 } }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(REAL_PROXY_KEY), "PROXY_API_KEY نباید در نتیجه ظاهر شود");
  } finally {
    mock.restore();
  }
});

await test("آدرس/مسیر Proxy با env.INTEGRATION_PROXY_BASE_URL/QUOTE_PATH قابل‌تنظیم است", async () => {
  const mock = installMockFetch((url) => {
    assert.equal(url, "https://custom-proxy.example.com/custom/quote-path");
    return jsonResponse({ ok: true, entries: { total_send_price: 10000 } });
  });
  try {
    await quoteViaTapin(
      baseEnv({
        INTEGRATION_PROXY_BASE_URL: "https://custom-proxy.example.com",
        INTEGRATION_PROXY_TAPIN_QUOTE_PATH: "/custom/quote-path",
      }),
      { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows }
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
    const config = {
      product_type_id: 1,
      packing_type_id: 2,
      payment_type: 10,
      delivery_type: 10,
      pickup_type: 20,
      origin_city: "اصفهان",
    };
    dbRaw.exec(`
      CREATE TABLE shipping_providers (id INTEGER PRIMARY KEY, code TEXT UNIQUE, status TEXT, mode TEXT, fallback_provider_code TEXT, config_json TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE site_settings (id INTEGER PRIMARY KEY, shipping_calculation_mode TEXT);
      INSERT INTO shipping_providers (code, status, mode, fallback_provider_code, config_json, sort_order) VALUES
        ('internal','active','quote',NULL,NULL,10),
        ('tapin','active','quote','internal', '${JSON.stringify(config).replace(/'/g, "''")}', 20);
      INSERT INTO site_settings (id, shipping_calculation_mode) VALUES (1, 'online_fallback_internal');
    `);
    const wrappedEnv = { PROXY_API_KEY: REAL_PROXY_KEY, DB: wrapD1(dbRaw) };

    const engineResult = await getShippingOptionsViaEngine(wrappedEnv, {
      cartItems: sampleItems,
      city: "تهران",
      internalOptionsFn,
      productRows: sampleProductRows,
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
