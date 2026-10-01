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
// Assertion داخل handler موک‌شدهٔ fetch توسط try/catch خود Adapter بلعیده می‌شد
// (تست اشتباهاً سبز). اینجا هر استثنای handler ثبت می‌شود و پس از پایان تست
// دوباره پرتاب می‌شود تا هرگز نتیجهٔ سبز کاذب ندهد.
const handlerErrors = [];
function test(name, fn) {
  handlerErrors.length = 0;
  return fn()
    .then(() => {
      if (handlerErrors.length > 0) throw handlerErrors[0];
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
    pay_type: 1,
    // order_type عمداً تنظیم نشده: Worker نباید مقدار پیش‌فرض (۰) بسازد.
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
    try {
      return handler(url, options, calls.length);
    } catch (error) {
      handlerErrors.push(error);
      throw error;
    }
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

await test("بدنه Worker→VPS: قرارداد Post v2 (products[]: count/discount/price/title/weight — product_id همیشه هست و بدون mapping واقعی null است)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, `Bearer ${REAL_PROXY_KEY}`);
    assert.equal(body.destination_city, "تهران");
    assert.equal(body.pay_type, 1);
    // بدون تنظیم صریح Worker/D1 → order_type اصلاً ارسال نمی‌شود (VPS از TAPIN_ORDER_TYPE خودش می‌خواند).
    assert.equal("order_type" in body, false);
    // ابعاد واقعی بسته (Override) — فقط برای انتخاب box_id سمت VPS:
    assert.equal(body.length, 80);
    assert.equal(body.width, 45);
    assert.equal(body.height, 35);
    assert.equal(body.package_weight, 1500);
    const product = body.products[0];
    assert.equal(product.discount, 0);
    assert.equal(product.price, 1_120_000_000); // ۱۱۲,۰۰۰,۰۰۰ تومان × ۱۰ (فقط یک‌بار، فقط در Worker)
    assert.equal(product.weight, 32000); // وزن کالا (گرم)، مستقل از وزن بسته‌بندی
    assert.equal(product.count, 1);
    assert.equal(product.title, "پکیج آدنا ۲۴");
    // product_id در قرارداد Tapin شناسهٔ کاتالوگ خود Tapin است؛ بدون mapping واقعی → کلید هست و null است.
    assert.ok("product_id" in product);
    assert.strictEqual(product.product_id, null);
    assert.notEqual(product.product_id, sampleItems[0].productId); // شناسهٔ D1 نباید جایگزین شود
    assert.deepEqual(Object.keys(product).sort(), ["count", "discount", "price", "product_id", "title", "weight"]);
    assert.ok(product.price > 0 && product.title && product.weight > 0); // با product_id=null هر سه حفظ می‌شوند
    // packet_type بدون تنظیم واقعی هرگز توسط Worker ساخته نمی‌شود.
    assert.equal(body.packet_type, undefined);
    assert.equal(body.shop_id, undefined);
    return jsonResponse({ ok: true, entries: { total_send_price: 150000 } });
  });
  try {
    await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
  } finally {
    mock.restore();
  }
});

await test("packet_type: فقط در صورت تنظیم واقعی ارسال می‌شود (config_json > env Worker)، بدون پیش‌فرض", async () => {
  let body;
  const mock = installMockFetch((url, opts) => { body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  const req = { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows };
  try {
    await quoteViaTapin(baseEnv(), req);
    assert.equal("packet_type" in body, false);
    await quoteViaTapin(baseEnv({ TAPIN_PACKET_TYPE: "5" }), req);
    assert.equal(body.packet_type, 5);
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ packet_type: 7 }), TAPIN_PACKET_TYPE: "5" }), req);
    assert.equal(body.packet_type, 7);
  } finally {
    mock.restore();
  }
});

await test("pay_type پیش‌فرض ۱؛ order_type بدون پیش‌فرض؛ اولویت config_json > env Worker", async () => {
  let body;
  const mock = installMockFetch((url, opts) => { body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  const req = { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows };
  try {
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ pay_type: undefined, order_type: undefined }) }), req);
    assert.equal(body.pay_type, 1);
    assert.equal("order_type" in body, false); // نه ۰، نه ۱: Worker چیزی تحمیل نمی‌کند
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ pay_type: undefined, order_type: undefined }), TAPIN_PAY_TYPE: "3", TAPIN_ORDER_TYPE: "2" }), req);
    assert.deepEqual([body.pay_type, body.order_type], [3, 2]);
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ pay_type: 5, order_type: 4 }), TAPIN_PAY_TYPE: "3" }), req);
    assert.deepEqual([body.pay_type, body.order_type], [5, 4]);
  } finally { mock.restore(); }
});

await test("هیچ فیلد Tipax/v4 وارد درخواست نمی‌شود (حتی اگر config_json قدیمی آن‌ها را دارد)", async () => {
  let raw;
  const mock = installMockFetch((url, opts) => { raw = opts.body; return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    const legacy = makeDbWithTapinConfig({ product_type_id: 1, packing_type_id: 2, payment_type: 10, delivery_type: 10, pickup_type: 20, origin_city: "اصفهان", service_type_local: 7, service_type_domestic: 2 });
    await quoteViaTapin(baseEnv({ DB: legacy }), { destinationCity: "تهران", destinationProvince: "تهران", items: sampleItems, productRows: sampleProductRows });
    const body = JSON.parse(raw);
    for (const bad of ["product_type_id", "packing_type_id", "payment_type", "delivery_type", "pickup_type", "service_type",
      "receiver_province_id", "receiver_city_id", "weight_package", "type_pickup", "shop_id"]) assert.equal(bad in body, false, bad);
    for (const bad of ["amount_per_count", "discount_per_count", "weight_per_count"]) assert.equal(bad in body.products[0], false, bad);
    assert.ok(!/tipax|\/v4/i.test(raw));
  } finally { mock.restore(); }
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

await test("pay_type نامعتبر در config_json → TAPIN_CONFIG_INCOMPLETE بدون تماس شبکه", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const env = baseEnv({ DB: makeDbWithTapinConfig({ pay_type: "abc" }) });
    const result = await quoteViaTapin(env, { destinationCity: "اصفهان", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_CONFIG_INCOMPLETE");
    assert.ok(result.message.includes("pay_type"));
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("پاسخ منطقی ناموفق Proxy (CITY_AMBIGUOUS با کلید error_code) همراه candidates حفظ می‌شود", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({ ok: false, error_code: "CITY_AMBIGUOUS", message: "چند شهر", candidates: [{ city_code: 1 }, { city_code: 2 }] })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "ری", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, false);
    assert.equal(result.error, "CITY_AMBIGUOUS");
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

await test("destination_province همیشه (در صورت وجود) به VPS فرستاده می‌شود و بدون آن حذف می‌شود", async () => {
  const req = { destinationCity: "ورامین", destinationProvince: "تهران", items: sampleItems, productRows: sampleProductRows };
  const mock = installMockFetch((url, opts) => { globalThis.__body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    await quoteViaTapin(baseEnv(), req);
    assert.equal(globalThis.__body.destination_province, "تهران");
    await quoteViaTapin(baseEnv(), { ...req, destinationProvince: null });
    assert.equal("destination_province" in globalThis.__body, false);
  } finally { mock.restore(); }
});

await test("VPS با HTTP غیر ۲xx و بدنهٔ کنترل‌شده → کد دقیق (TAPIN_CONTRACT_INCOMPLETE / TAPIN_BAD_REQUEST) حفظ می‌شود", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: false, error_code: "TAPIN_CONTRACT_INCOMPLETE", message: "missing", missing_fields: ["address"] }, { ok: false, status: 400 }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_CONTRACT_INCOMPLETE");
    assert.equal(result.status, 400);
  } finally { mock.restore(); }
});

await test("کدهای VPS (CITY_NOT_FOUND / TAPIN_HTTP_400 / TAPIN_TIMEOUT / TAPIN_AUTH_ERROR) بدون تغییر منتقل می‌شوند", async () => {
  for (const code of ["CITY_NOT_FOUND", "TAPIN_HTTP_400", "TAPIN_TIMEOUT", "TAPIN_AUTH_ERROR", "TAPIN_PRICE_NOT_FOUND"]) {
    const mock = installMockFetch(() => jsonResponse({ ok: false, error_code: code, message: "x" }));
    try {
      const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
      assert.equal(result.error, code);
      assert.equal(result.available, false);
    } finally { mock.restore(); }
  }
});

await test("قیمت صفر/منفی/غیرعددی هرگز ارسال رایگان یا موفقیت نمی‌شود", async () => {
  for (const price of [0, -5, "abc", null]) {
    const mock = installMockFetch(() => jsonResponse({ ok: true, entries: { total_send_price: price } }));
    try {
      const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
      assert.equal(result.ok, false, String(price));
      assert.equal(result.error, "TAPIN_RESPONSE_UNRECOGNIZED");
    } finally { mock.restore(); }
  }
});

await test("total_weight / box_id پاسخ VPS در metadata برای مقایسهٔ Live Test نگه‌داشته می‌شود", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true, entries: { total_send_price: 150000, total_weight: 33500 }, sent: { box_id: 7, package_weight: 1500 } }));
  try {
    const result = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.equal(result.ok, true);
    assert.equal(result.cost, 15000);
    assert.equal(result.metadata.total_weight, 33500);
    assert.equal(result.metadata.box_id, 7);
    assert.equal(result.carrier, "post");
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
    const config = { pay_type: 1 };
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

// ---------------------------------------------------------------------------
// تست‌های مرحلهٔ «اصلاح order_type / product_id / قرارداد Worker→VPS / حذف Tipax-v4»
// ---------------------------------------------------------------------------
await test("order_type: مقدار صریح D1 یا env ارسال می‌شود؛ ۰ هرگز به‌صورت پیش‌فرض ساخته نمی‌شود", async () => {
  let body; let calls = 0;
  const mock = installMockFetch((url, opts) => { calls++; body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  const req = { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows };
  try {
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ order_type: 1 }) }), req);
    assert.strictEqual(body.order_type, 1); // D1 صریح
    await quoteViaTapin(baseEnv({ TAPIN_ORDER_TYPE: "1" }), req);
    assert.strictEqual(body.order_type, 1); // env صریح
    await quoteViaTapin(baseEnv({ DB: makeDbWithTapinConfig({ order_type: 2 }), TAPIN_ORDER_TYPE: "1" }), req);
    assert.strictEqual(body.order_type, 2); // D1 بر env اولویت دارد
    await quoteViaTapin(baseEnv({ TAPIN_ORDER_TYPE: "" }), req);
    assert.equal("order_type" in body, false); // env خالی = بدون تنظیم
    await quoteViaTapin(baseEnv(), req);
    assert.equal("order_type" in body, false);
    assert.ok(!/"order_type"\s*:\s*0/.test(JSON.stringify(body)));
  } finally { mock.restore(); }
});

await test("order_type نامعتبر (غیرعدد) → TAPIN_CONFIG_INCOMPLETE و هیچ تماسی به VPS نمی‌رود", async () => {
  let calls = 0;
  const mock = installMockFetch(() => { calls++; return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    const r = await quoteViaTapin(baseEnv({ TAPIN_ORDER_TYPE: "abc" }), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.equal(r.ok, false);
    assert.equal(r.error, "TAPIN_CONFIG_INCOMPLETE");
    assert.equal(calls, 0);
  } finally { mock.restore(); }
});

await test("product_id: کلید همیشه هست، null است و هرگز ID داخلی D1/SKU/slug نمی‌شود؛ price/title/weight/count/discount حفظ می‌شوند", async () => {
  let body;
  const mock = installMockFetch((url, opts) => { body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    const rows = sampleProductRows.map((r) => ({ ...r, sku: "SKU-123", slug: "adena-24", tapin_product_id: 987 }));
    await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: rows });
    for (const pr of body.products) {
      assert.ok(Object.prototype.hasOwnProperty.call(pr, "product_id"));
      assert.strictEqual(pr.product_id, null);
      for (const k of ["count", "discount", "price", "title", "weight"]) assert.ok(k in pr, k);
      assert.ok(pr.price > 0 && pr.weight > 0 && pr.title.length > 0 && pr.count >= 1);
    }
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes("SKU-123") && !raw.includes("adena-24") && !raw.includes("987"));
  } finally { mock.restore(); }
});

await test("قرارداد نهایی Worker→VPS: دقیقاً همین کلیدها، package_weight هست و weight_package نیست، فقط /api/v1/tapin/quote", async () => {
  let body; let url0;
  const mock = installMockFetch((url, opts) => { url0 = url; body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 150000 } }); });
  try {
    await quoteViaTapin(baseEnv(), { destinationCity: "تهران", destinationProvince: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.ok(url0.endsWith("/api/v1/tapin/quote"));
    assert.ok(!url0.includes("api.tapin.ir"));
    assert.deepEqual(Object.keys(body).sort(),
      ["destination_city", "destination_province", "height", "length", "package_weight", "pay_type", "products", "width"]);
    assert.ok("package_weight" in body);
    assert.equal("weight_package" in body, false);
    assert.equal(body.pay_type, 1);
  } finally { mock.restore(); }
});

await test("تبدیل پول: تومان→ریال فقط یک‌بار (Worker)، ریال→تومان فقط یک‌بار (پاسخ)", async () => {
  let body;
  const mock = installMockFetch((url, opts) => { body = JSON.parse(opts.body); return jsonResponse({ ok: true, entries: { total_send_price: 1_234_560 } }); });
  try {
    const r = await quoteViaTapin(baseEnv(), { destinationCity: "تهران", items: sampleItems, productRows: sampleProductRows });
    assert.equal(body.products[0].price, sampleItems[0].price * 10); // ×۱۰ یک‌بار
    assert.equal(r.cost, 123_456); // ÷۱۰ یک‌بار
  } finally { mock.restore(); }
});

await test("اسکن ایستا: هیچ فیلد/Endpoint Tipax-v4 در کد اجرایی Worker (بدون کامنت) نیست", async () => {
  const fs = await import("node:fs");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:])\/\/.*$/gm, "$1");
  const banned = ["product_type_id", "packing_type_id", "payment_type", "service_type", "delivery_type", "pickup_type",
    "receiver_province_id", "receiver_city_id", "weight_package", "TAPIN_DEFAULT_ORDER_TYPE"];
  for (const f of ["src/shipping-engine.js", "src/index.js", "src/packaging-estimation.js"]) {
    const code = strip(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
    for (const b of banned) assert.equal(code.includes(b), false, `${f}: ${b}`);
    assert.equal(/api\.tapin\.ir/.test(code), false, `${f}: api.tapin.ir`);
    assert.equal(/\/api\/v4|tipax\.ir/i.test(code), false, `${f}: v4/tipax endpoint`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
