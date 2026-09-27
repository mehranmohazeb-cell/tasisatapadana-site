// =========================================================================
// تست‌های واقعی اتصال Worker → Integration Proxy → Tapin
// =========================================================================
// این فایل، لایه جدید Proxy را در tapinRequest (src/shipping-engine.js) با
// Mock کردن global.fetch تست می‌کند — نه شبکه واقعی (طبق محدودیت مستندشده:
// این Sandbox به اینترنت دسترسی ندارد). تمرکز تست‌ها دقیقاً همان مواردی است
// که در دستور توسعه خواسته شده:
//   - Worker مستقیماً api.tapin.ir را صدا نمی‌زند؛ فقط Proxy را صدا می‌زند.
//   - Secret (PROXY_API_KEY/TAPIN_TOKEN) در نتیجه برگشتی نشت نمی‌کند.
//   - بدنه درخواست به Proxy درست ساخته می‌شود (path/body/authorization).
//   - خطاهای Proxy و Tapin هر دو کنترل‌شده مدیریت می‌شوند.
//   - City Mapping و تبدیل قیمت (÷۱۰) دست‌نخورده مانده‌اند.
//   - Fallback موتور داخلی Shipping Engine سالم می‌ماند.
//
// اجرا:  node test/tapin-proxy.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  quoteViaTapin,
  fetchTapinLocations,
  findTapinCityMatch,
  getShippingOptionsViaEngine,
} from "../src/shipping-engine.js";

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

// -------------------------------------------------------------------------
// آداپتور حداقلی D1 روی node:sqlite — فقط همان متدهایی که shipping-engine.js
// واقعاً استفاده می‌کند (prepare().first() بدون bind، برای config_json).
// -------------------------------------------------------------------------
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

const REAL_TAPIN_TOKEN = "sk-real-tapin-secret-value-should-never-leak";
const REAL_PROXY_KEY = "proxy-secret-key-should-never-leak";

function baseEnv(overrides = {}) {
  return {
    DB: makeDbWithTapinConfig(),
    TAPIN_TOKEN: REAL_TAPIN_TOKEN,
    TAPIN_SHOP_ID: "shop-123",
    PROXY_API_KEY: REAL_PROXY_KEY,
    ...overrides,
  };
}

// پاسخ خام واقعی Tapin برای province/city filter (بر اساس ساختار مستندشده
// در کد موجود: entries.provinces / entries.cities با pk/title/province_pk).
const PROVINCE_CITY_RESPONSE = {
  returns: { status: 20 },
  entries: {
    cities: [
      { pk: 111, title: "اصفهان", province_pk: 10, province_title: "اصفهان" },
      { pk: 222, title: "تهران", province_pk: 20, province_title: "تهران" },
    ],
  },
};

function checkPriceResponse(priceSendTotal) {
  return {
    returns: { status: 20 },
    entries: { price_send_total: priceSendTotal },
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
  return {
    ok,
    status,
    json: async () => body,
  };
}

await test("Worker Proxy را صدا می‌زند، نه مستقیماً api.tapin.ir را", async () => {
  const mock = installMockFetch((url, options) => {
    if (String(url).includes("api.tapin.ir")) {
      throw new Error("تماس مستقیم و ممنوع با api.tapin.ir انجام شد");
    }
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) return jsonResponse(checkPriceResponse(150000));
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, true, "Quote باید موفق باشد");
    assert.ok(
      mock.calls.every((c) => !String(c.url).includes("api.tapin.ir")),
      "هیچ تماسی نباید مستقیماً به api.tapin.ir برود"
    );
    assert.ok(
      mock.calls.some((c) => c.url === "https://proxy.tasisatapadanaesfahan.ir/tapin/request"),
      "باید به آدرس پیش‌فرض Proxy درخواست بفرستد"
    );
  } finally {
    mock.restore();
  }
});

await test("بدنه درخواست به Proxy شامل path/body/authorization صحیح است", async () => {
  const seen = [];
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    seen.push({ url, headers: options.headers, body });
    if (body.path.includes("check-price")) return jsonResponse(checkPriceResponse(150000));
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    // احراز هویت Worker→Proxy باید با PROXY_API_KEY باشد، نه TAPIN_TOKEN.
    for (const call of seen) {
      assert.equal(call.headers.Authorization, `Bearer ${REAL_PROXY_KEY}`);
    }
    const checkPriceCall = seen.find((c) => c.body.path.includes("check-price"));
    assert.ok(checkPriceCall, "باید یک تماس check-price ثبت شده باشد");
    assert.equal(checkPriceCall.body.body.shop_id, "shop-123");
    assert.equal(checkPriceCall.body.authorization, `Bearer ${REAL_TAPIN_TOKEN}`);
    assert.equal(checkPriceCall.body.body.receiver_city_id, 111);
    assert.equal(checkPriceCall.body.body.receiver_province_id, 10);
    assert.equal(checkPriceCall.body.body.length, 5);
    assert.equal(checkPriceCall.body.body.width, 5);
    assert.equal(checkPriceCall.body.body.height, 5);
  } finally {
    mock.restore();
  }
});

await test("بدون PROXY_API_KEY هرگز fetch اجرا نمی‌شود و خطای مشخص برمی‌گردد", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const result = await quoteViaTapin(baseEnv({ PROXY_API_KEY: undefined }), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_CREDENTIALS_MISSING");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("بدون TAPIN_TOKEN همچنان TAPIN_CREDENTIALS_MISSING برمی‌گردد (رفتار قبلی حفظ شده)", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch نباید صدا زده شود");
  });
  try {
    const result = await quoteViaTapin(baseEnv({ TAPIN_TOKEN: undefined }), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_CREDENTIALS_MISSING");
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

await test("خطای سطح Proxy (proxy_error) به‌صورت PROXY_ERROR کنترل‌شده برمی‌گردد", async () => {
  const mock = installMockFetch(() =>
    jsonResponse({ proxy_error: true, message: "مسیر خارج از Allowlist" }, { ok: false, status: 403 })
  );
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_ERROR");
    assert.equal(result.status, 403);
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
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_NETWORK_ERROR");
  } finally {
    global.fetch = original;
  }
});

await test("پاسخ خام غیرقابل‌Parse از Proxy → PROXY_INVALID_RESPONSE", async () => {
  const mock = installMockFetch(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("bad json");
    },
  }));
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "PROXY_INVALID_RESPONSE");
  } finally {
    mock.restore();
  }
});

await test("وقتی Proxy موفق پاسخ می‌دهد ولی خود Tapin status ناموفق دارد → TAPIN_API_ERROR (منطق قبلی حفظ شده)", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) {
      return jsonResponse({ returns: { status: 99125, message: "خطای فرضی Tapin" } });
    }
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "TAPIN_API_ERROR");
    assert.equal(result.tapin_status, 99125);
  } finally {
    mock.restore();
  }
});

await test("تبدیل قیمت (تومان×۱۰ در Request، ÷۱۰ در Response) دست‌نخورده مانده", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) {
      assert.equal(body.body.products[0].count_per_amount, 1_000_000); // 100000 تومان × ۱۰
      return jsonResponse(checkPriceResponse(150000)); // ریال فرضی
    }
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.cost, 15000); // 150000 ÷ ۱۰
  } finally {
    mock.restore();
  }
});

await test("City Mapping واقعی (از Tapin API، نه فهرست دستی) دست‌نخورده مانده", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) {
      assert.equal(body.body.receiver_city_id, 222);
      assert.equal(body.body.receiver_province_id, 20);
      return jsonResponse(checkPriceResponse(90000));
    }
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "تهران",
      items: [{ price: 50000, weightGrams: 200, quantity: 1 }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.metadata.matched_city.cityId, 222);
  } finally {
    mock.restore();
  }
});

await test("شهر پیدا نشد → همان CITY_NOT_FOUND قبلی، بدون تماس check-price", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) throw new Error("نباید برای شهر پیدانشده check-price زده شود");
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "شهر خیالی",
      items: [{ price: 50000, weightGrams: 200, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "CITY_NOT_FOUND");
  } finally {
    mock.restore();
  }
});

await test("Secret (PROXY_API_KEY/TAPIN_TOKEN) در نتیجه برگشتی به‌هیچ‌وجه نشت نمی‌کند", async () => {
  const mock = installMockFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.path.includes("check-price")) return jsonResponse(checkPriceResponse(150000));
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    const result = await quoteViaTapin(baseEnv(), {
      destinationCity: "اصفهان",
      items: [{ price: 100000, weightGrams: 500, quantity: 1 }],
    });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(REAL_TAPIN_TOKEN), "TAPIN_TOKEN نباید در نتیجه ظاهر شود");
    assert.ok(!serialized.includes(REAL_PROXY_KEY), "PROXY_API_KEY نباید در نتیجه ظاهر شود");
  } finally {
    mock.restore();
  }
});

await test("مقصد Proxy با env.INTEGRATION_PROXY_BASE_URL/PATH قابل‌تنظیم است ولی هیچ‌وقت از ورودی کاربر نمی‌آید", async () => {
  const mock = installMockFetch((url) => {
    assert.equal(url, "https://custom-proxy.example.com/custom/path");
    return jsonResponse(PROVINCE_CITY_RESPONSE);
  });
  try {
    await fetchTapinLocations(
      baseEnv({
        INTEGRATION_PROXY_BASE_URL: "https://custom-proxy.example.com",
        INTEGRATION_PROXY_TAPIN_PATH: "/custom/path",
      }),
      { forceRefresh: true }
    );
  } finally {
    mock.restore();
  }
});

await test("Fallback موتور داخلی Shipping Engine وقتی Proxy/Tapin شکست بخورد سالم است", async () => {
  const mock = installMockFetch(() => jsonResponse({ proxy_error: true, message: "قطع VPS" }, { ok: false, status: 502 }));
  try {
    const internalOptionsFn = async () => [{ id: 1, name: "پست پیشتاز", cost: 45000, cost_type: "flat", scope: "global" }];
    const env = baseEnv();
    // mode باید 'online_fallback_internal' باشد تا مسیر Fallback واقعاً تست شود؛
    // برای همین یک DB سبک جداگانه با site_settings حاوی همین حالت می‌سازیم.
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
    const wrappedEnv = { ...env, DB: wrapD1(dbRaw) };

    const engineResult = await getShippingOptionsViaEngine(wrappedEnv, {
      cartItems: [{ price: 100000, weightGrams: 500, quantity: 1 }],
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
