// =========================================================================
// تأسیسات آپادانا — Shipping Engine / Provider Abstraction
// =========================================================================
// این ماژول جدید، *جایگزین* موتور داخلی فعلی (resolveShippingOptionsForCart
// در src/index.js) نیست و آن تابع دست‌نخورده باقی می‌ماند. این فایل فقط یک
// لایه اضافه می‌کند: مدیریت Providerها، نسخه‌بندی/Import تعرفه، تاریخچه
// استعلام آنلاین، و یک تابع orchestration که در آینده Cart/Checkout را به
// چند Provider (نه فقط موتور داخلی) وصل می‌کند.
//
// اصل معماری (طبق دستور توسعه):
//   Store / Cart / Checkout → Shipping Engine → { Internal Provider | Online Provider } → Standard Result
//
// وضعیت این مرحله (صادقانه، طبق قانون بخش ۴۳ / گزارش دوم Tapin):
//   - رجیستری Provider، نسخه‌بندی/Import تعرفه، تاریخچه Quote: کامل پیاده و تست‌شده (مرحله قبل).
//   - Tapin Adapter: «استعلام قیمت» (quoteViaTapin) اکنون یک پیاده‌سازی واقعی
//     است که مطابق راهنمای رسمی PDF تیپاکس (follow-tapin-tipax-1.pdf) به
//     Endpointهای واقعی api.tapin.ir متصل می‌شود — نه Skeleton قبلی.
//     ثبت سفارش/لغو/حذف/Label/Tracking همچنان پیاده نشده‌اند (خارج از محدوده
//     همین مرحله، طبق دستور صریح کاربر).
//   - این Adapter بدون Credential واقعی (TAPIN_TOKEN/TAPIN_SHOP_ID) و بدون
//     تنظیمات کسب‌وکار Tapin (در config_json پنل Providers) قابل تست زنده
//     نیست؛ به‌جای حدس‌زدن این مقادیر، خطای صریح TAPIN_CREDENTIALS_MISSING /
//     TAPIN_CONFIG_INCOMPLETE برگردانده می‌شود.
//   - اتصال زنده Cart/Checkout مشتری به این Engine: همچنان انجام نشده (طبق
//     دستور صریح — فعلاً فقط از Endpoint Admin «shipping-engine-preview»
//     قابل تست است). resolveShippingOptionsForCart و shipping_table_rates
//     به‌عنوان موتور داخلی واقعی سایت، کاملاً دست‌نخورده مانده‌اند.
//   - shipping_calculation_mode در D1 واقعی مقدار قدیمی «table_rate» را دارد؛
//     چون این مقدار در SHIPPING_CALCULATION_MODES نیست، getShippingCalculationMode
//     به‌صورت Fail-Safe مقدار «internal» را برمی‌گرداند — یعنی رفتار امروز
//     (فقط موتور داخلی) دقیقاً حفظ می‌شود. طبق دستور، این مغایرت در همین
//     مرحله عمداً reconcile نشده.
// =========================================================================


export const SHIPPING_CALCULATION_MODES = ["internal", "online", "online_fallback_internal"];

export const TARIFF_SOURCES = ["manual", "tapin", "post", "tipax", "other"];

// -------------------------------------------------------------------------
// حالت محاسبه ارسال — روی همان رکورد تک site_settings (id=1) پروژه
// -------------------------------------------------------------------------

export async function getShippingCalculationMode(env) {
  try {
    const row = await env.DB
      .prepare("SELECT shipping_calculation_mode FROM site_settings WHERE id = 1 LIMIT 1")
      .first();
    const mode = row?.shipping_calculation_mode;
    return SHIPPING_CALCULATION_MODES.includes(mode) ? mode : "internal";
  } catch (error) {
    // Fail-Safe: اگر Migration جدید هنوز اجرا نشده، رفتار فعلی (فقط داخلی) حفظ می‌شود.
    return "internal";
  }
}

export async function setShippingCalculationMode(env, mode) {
  if (!SHIPPING_CALCULATION_MODES.includes(mode)) {
    return { ok: false, error: "INVALID_MODE", message: "حالت محاسبه ارسال نامعتبر است." };
  }
  await env.DB
    .prepare("INSERT INTO site_settings (id, store_status, services_status) VALUES (1, 'open', 'open') ON CONFLICT(id) DO NOTHING")
    .run();
  await env.DB
    .prepare("UPDATE site_settings SET shipping_calculation_mode = ? WHERE id = 1")
    .bind(mode)
    .run();
  return { ok: true, mode };
}

// -------------------------------------------------------------------------
// رجیستری Provider — هرگز Secret/API Key اینجا خوانده یا نوشته نمی‌شود.
// -------------------------------------------------------------------------

export async function listShippingProviders(env) {
  const result = await env.DB
    .prepare("SELECT * FROM shipping_providers ORDER BY sort_order ASC, id ASC")
    .all();
  return (result.results || []).map((row) => ({
    ...row,
    config: safeParseJson(row.config_json),
  }));
}

export async function updateShippingProvider(env, code, patch) {
  if (!code) return { ok: false, error: "INVALID_DATA", message: "کد Provider الزامی است." };

  const existing = await env.DB.prepare("SELECT * FROM shipping_providers WHERE code = ?").bind(code).first();
  if (!existing) {
    return { ok: false, error: "NOT_FOUND", message: "Provider پیدا نشد." };
  }

  // قانون معماری (بخش ۴۱ دستور): Provider داخلی هرگز از این مسیر غیرفعال
  // نمی‌شود، چون Fallback نهایی سیستم است و نباید بتوان به‌طور تصادفی از
  // پنل کل ارسال را خاموش کرد.
  if (code === "internal" && patch.status === "disabled") {
    return {
      ok: false,
      error: "INTERNAL_PROVIDER_CANNOT_BE_DISABLED",
      message: "موتور داخلی نمی‌تواند غیرفعال شود؛ این Provider همیشه به‌عنوان Fallback نهایی فعال می‌ماند.",
    };
  }

  const status = patch.status === "active" || patch.status === "disabled" ? patch.status : existing.status;
  const mode = patch.mode === "quote" || patch.mode === "disabled" ? patch.mode : existing.mode;
  const fallbackProviderCode = patch.fallback_provider_code !== undefined
    ? (patch.fallback_provider_code || null)
    : existing.fallback_provider_code;
  const configJson = patch.config !== undefined
    ? JSON.stringify(patch.config || {})
    : existing.config_json;

  await env.DB
    .prepare(
      "UPDATE shipping_providers SET status = ?, mode = ?, fallback_provider_code = ?, config_json = ?, updated_at = ? WHERE code = ?"
    )
    .bind(status, mode, fallbackProviderCode, configJson, new Date().toISOString(), code)
    .run();

  return { ok: true, message: "Provider به‌روزرسانی شد." };
}

function safeParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

// -------------------------------------------------------------------------
// Tapin/Tipax Adapter — استعلام قیمت واقعی، طبق راهنمای رسمی PDF.
// -------------------------------------------------------------------------

const TAPIN_API_BASE = "https://api.tapin.ir/api/v4";

// واحد پول: طبق PDF، مقادیر ارزش کالا در Request صراحتاً «به ریال» هستند.
// پروژه داخلاً بر مبنای «تومان» کار می‌کند (تأیید‌شده از public/store/*.js).
// تبدیل فقط همین‌جا (در Adapter) انجام می‌شود، نه جای دیگر.
const RIAL_PER_TOMAN = 10;

// فیلدهای تنظیمات کسب‌وکار Tapin که PDF آن‌ها را به‌صورت enum مستند کرده اما
// مقدار مناسب هرکدام برای این فروشگاه، تصمیمی تجاری/حساب‌کاربری است که در
// سند مشخص نشده. عمداً حدس زده نمی‌شوند — باید از پنل «Providers» برای
// Provider با code='tapin' در ستون config (JSON) تنظیم شوند.
const TAPIN_REQUIRED_CONFIG_FIELDS = [
  "product_type_id", // نوع کالا: ۱=بسته/عمومی، ۲=اوراق و اسناد بانکی(پاکت)/نامه، ۳=عمومی/نامه، ۴=مایعات-شکستنی/بسته
  "packing_type_id", // نوع بسته‌بندی (pk از جدول type_pack مستندشده در PDF — مثلاً ۲="نیاز به بسته‌بندی ندارد" برای کارتن)
  "payment_type", // طبق جدول enum سند: ۱۰=آنلاین، ۲۰=پس‌کرایه (توجه: متن توضیحی سند این دو را «نقدی»/«پس‌کرایه» نامیده — ناهماهنگی داخل خود سند؛ در گزارش نهایی تکرار شده)
  "service_type", // ۲=اکسپرس ویژه بین‌شهری، ۷=اکسپرس درون‌شهری
  "delivery_type", // ۱۰=تحویل در محل مشتری، ۲۰=تحویل در محل نمایندگی
  "type_pickup", // ۱۰=جمع‌آوری در محل مشتری، ۲۰=جمع‌آوری در نمایندگی
];

function getTapinCredentials(env) {
  const token = env.TAPIN_TOKEN;
  const shopId = env.TAPIN_SHOP_ID;
  const missing = [];
  if (!token) missing.push("TAPIN_TOKEN");
  if (!shopId) missing.push("TAPIN_SHOP_ID");
  return { token, shopId, ok: missing.length === 0, missing };
}

async function getTapinBusinessConfig(env) {
  const row = await env.DB.prepare("SELECT config_json FROM shipping_providers WHERE code = 'tapin'").first();
  const config = safeParseJson(row?.config_json) || {};
  const missing = TAPIN_REQUIRED_CONFIG_FIELDS.filter((f) => config[f] === undefined || config[f] === null);
  return { config, missing };
}

// Header Authorization: PDF فقط تنظیم Postman را توضیح داده («Auth Type =
// OAuth 2.0»، «Token = <token>» بدون عبارت Jwt)، نه رشته دقیق Header خام
// HTTP. طبق رفتار پیش‌فرض/استاندارد Postman برای OAuth 2.0 (که مقدار را با
// پیشوند "Bearer" به Header اضافه می‌کند)، این پیش‌فرض گذاشته شده — اما این
// یک استنباط است، نه چیزی که PDF به‌صراحت گفته باشد. با env.TAPIN_AUTH_HEADER_PREFIX
// (اختیاری، در Worker Secrets/Vars) بدون تغییر کد قابل بازنویسی است.
async function tapinRequest(env, path, body) {
  const creds = getTapinCredentials(env);
  if (!creds.ok) {
    return {
      ok: false,
      error: "TAPIN_CREDENTIALS_MISSING",
      message: `Credential تنظیم نشده در Worker Secrets: ${creds.missing.join(", ")}`,
      missing: creds.missing,
    };
  }

  const prefix = env.TAPIN_AUTH_HEADER_PREFIX ?? "Bearer";
  const authHeaderValue = prefix ? `${prefix} ${creds.token}` : creds.token;

  let response;
  try {
    response = await fetch(`${TAPIN_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeaderValue,
      },
      body: JSON.stringify({ shop_id: creds.shopId, ...body }),
    });
  } catch (error) {
    return { ok: false, error: "TAPIN_NETWORK_ERROR", message: error.message };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, error: "TAPIN_INVALID_RESPONSE", status: response.status, message: "پاسخ Tapin به‌صورت JSON قابل‌خواندن نبود." };
  }

  // نکته صادقانه: PDF فقط status=20 ("موفق")، status=21 ("عملیات با موفقیت
  // انجام شد" — برای متدهای changestatus) و یک نمونه خطا (status: "99125")
  // را نشان داده؛ فهرست کامل کدهای خطای Tapin در سند مستند نشده. اینجا هر
  // status غیر از ۲۰/۲۱ به‌عنوان ناموفق در نظر گرفته می‌شود، نه یک enum کامل.
  const tapinStatus = data?.returns?.status;
  if (!response.ok || (tapinStatus !== 20 && tapinStatus !== 21)) {
    return {
      ok: false,
      error: "TAPIN_API_ERROR",
      status: response.status,
      tapin_status: tapinStatus ?? null,
      message: data?.returns?.message || null,
    };
  }

  return { ok: true, data };
}

// -------------------------------------------------------------------------
// Cache لیست استان/شهر Tapin — In-Memory (Module-Scope)، چون در این مرحله
// هیچ KV Binding اختصاصی برای این منظور در پروژه وجود ندارد و طبق دستور،
// Binding جدید/Migration جدید در همین مرحله ایجاد نمی‌شود (VIEWERS_KV موجود
// اختصاصاً برای شمارنده بازدید محصول طراحی شده و برای این منظور «مناسب» نیست).
// محدودیت مهم (باید در تصمیم‌گیری مرحله بعد لحاظ شود): این Cache فقط در طول
// عمر همان Isolate از Cloudflare Worker معتبر است؛ بین Cold Startها یا
// Edge Locationهای مختلف Cloudflare مشترک/پایدار نیست — هر Isolate جدید
// دوباره از Tapin می‌گیرد. برای Cache واقعی و پایدار در Production، افزودن
// یک KV Binding اختصاصی لازم است (تصمیم با کاربر، در گزارش این مرحله اعلام شد).
// -------------------------------------------------------------------------
let _tapinLocationCache = { data: null, fetchedAt: 0 };
const TAPIN_LOCATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // ۶ ساعت — عدد قابل‌تنظیم، نه مستندشده توسط Tapin

export async function fetchTapinLocations(env, { forceRefresh = false } = {}) {
  const isFresh = _tapinLocationCache.data && Date.now() - _tapinLocationCache.fetchedAt < TAPIN_LOCATION_CACHE_TTL_MS;
  if (isFresh && !forceRefresh) {
    return { ok: true, ..._tapinLocationCache.data, fromCache: true };
  }

  const provincesResult = await tapinRequest(env, "/location/public/all/province/filter/", {});
  if (!provincesResult.ok) return provincesResult;

  const citiesResult = await tapinRequest(env, "/location/public/all/city/filter/", {});
  if (!citiesResult.ok) return citiesResult;

  const cities = citiesResult.data?.entries?.cities || [];

  // نکته صادقانه (Gap مستندسازی): PDF فقط ساختار Response برای «شهرها» را با
  // کلید entries.cities نشان داده؛ ساختار Response برای «استان‌ها» به‌صراحت
  // در سند نیامده. اگر entries.provinces در پاسخ واقعی موجود باشد از همان
  // استفاده می‌شود؛ در غیر این صورت فهرست استان‌ها از روی province_pk/
  // province_title موجود در خودِ آرایه cities استخراج می‌شود (چون هر شهر
  // این دو فیلد را دارد) — این یک Fallback مشتق‌شده از داده واقعی است، نه
  // یک حدس درباره Endpoint یا Schema.
  let provinces = provincesResult.data?.entries?.provinces;
  if (!Array.isArray(provinces)) {
    const seen = new Map();
    for (const city of cities) {
      if (city.province_pk != null && !seen.has(city.province_pk)) {
        seen.set(city.province_pk, { pk: city.province_pk, title: city.province_title });
      }
    }
    provinces = [...seen.values()];
  }

  const data = { provinces, cities };
  _tapinLocationCache = { data, fetchedAt: Date.now() };
  return { ok: true, ...data, fromCache: false };
}

function normalizePersianText(value) {
  return String(value || "")
    .replace(/\u200c/g, " ") // نیم‌فاصله → فاصله ساده، برای مقایسه پایدارتر
    .replace(/ك/g, "ک")
    .replace(/ي/g, "ی")
    .trim()
    .toLowerCase();
}

// تطبیق نام شهر مقصد (از سبد/آدرس داخلی پروژه) با فهرست واقعی شهرهای Tapin —
// هیچ فهرست دستی/ناقص شهر ساخته نشده؛ منبع فهرست همیشه خودِ API تاپین است.
export function findTapinCityMatch(cities, cityName) {
  const target = normalizePersianText(cityName);
  if (!target) return { matched: false, reason: "EMPTY_CITY_NAME" };

  const matches = (cities || []).filter((c) => normalizePersianText(c.title) === target);
  if (matches.length === 0) return { matched: false, reason: "CITY_NOT_FOUND" };
  if (matches.length > 1) {
    return {
      matched: false,
      reason: "AMBIGUOUS_CITY_NAME",
      candidates: matches.map((c) => ({ cityId: c.pk, provinceId: c.province_pk, provinceTitle: c.province_title })),
    };
  }

  const c = matches[0];
  return { matched: true, cityId: c.pk, provinceId: c.province_pk, provinceTitle: c.province_title, cityTitle: c.title };
}

export async function quoteViaTapin(env, quoteRequest) {
  const creds = getTapinCredentials(env);
  if (!creds.ok) {
    return {
      ok: false,
      provider: "tapin",
      error: "TAPIN_CREDENTIALS_MISSING",
      message: `Credential واقعی تنظیم نشده (باید در Worker Secrets قرار گیرد، نه در D1): ${creds.missing.join(", ")}`,
      available: false,
    };
  }

  const { config, missing } = await getTapinBusinessConfig(env);
  if (missing.length > 0) {
    return {
      ok: false,
      provider: "tapin",
      error: "TAPIN_CONFIG_INCOMPLETE",
      message:
        `تنظیمات کسب‌وکار Tapin کامل نیست: ${missing.join(", ")}. این مقادیر باید طبق enumهای مستندشده در راهنمای رسمی Tapin، ` +
        `از پنل «Providers» برای Provider با کد tapin (فیلد config) تنظیم شوند — به‌صورت خودکار حدس زده نمی‌شوند.`,
      available: false,
    };
  }

  const locations = await fetchTapinLocations(env);
  if (!locations.ok) {
    return { ok: false, provider: "tapin", ...locations, available: false };
  }

  const cityMatch = findTapinCityMatch(locations.cities, quoteRequest.destinationCity);
  if (!cityMatch.matched) {
    return {
      ok: false,
      provider: "tapin",
      error: cityMatch.reason,
      message:
        cityMatch.reason === "AMBIGUOUS_CITY_NAME"
          ? "بیش از یک شهر با این نام در فهرست واقعی Tapin پیدا شد؛ برای رفع ابهام به استان مقصد نیاز است (در این مرحله پیاده نشده)."
          : cityMatch.reason === "EMPTY_CITY_NAME"
          ? "نام شهر مقصد خالی است."
          : `شهر «${quoteRequest.destinationCity}» در فهرست واقعی شهرهای Tapin پیدا نشد.`,
      candidates: cityMatch.candidates || null,
      available: false,
    };
  }

  const items = quoteRequest.items || [];
  const products = items.map((item) => ({
    count_per_discount: 0,
    count_per_amount: Math.round((Number(item.price) || 0) * RIAL_PER_TOMAN),
    weight_per_count: Number(item.weightGrams) || 0,
    count: Number(item.quantity) || 1,
  }));

  const packagingWeightGrams = Number(config.default_packaging_weight_grams) || 0;

  const requestBody = {
    receiver_province_id: cityMatch.provinceId,
    receiver_city_id: cityMatch.cityId,
    product_type_id: config.product_type_id,
    packing_type_id: config.packing_type_id,
    payment_type: config.payment_type,
    service_type: config.service_type,
    delivery_type: config.delivery_type,
    type_pickup: config.type_pickup,
    products,
    // طبق توافق مستندشده با تیپاکس در PDF («برای ساده‌سازی روند ثبت سفارش،
    // طی توافقات انجام‌شده با تیپاکس، طول و عرض و ارتفاع بسته، عدد پنج وارد
    // شود») — این یک مقدار ثابتِ مستندشده است، نه فرض من:
    length: 5,
    width: 5,
    height: 5,
    weight_package: packagingWeightGrams,
  };

  const result = await tapinRequest(env, "/tipax/public/user/order/check-price/", requestBody);
  if (!result.ok) {
    return { ok: false, provider: "tapin", ...result, available: false };
  }

  const entries = result.data?.entries || {};

  // واحد پول (صادقانه): PDF صراحتاً می‌گوید مقادیر ارزش کالا در Request «به
  // ریال» هستند؛ برای فیلدهای Response (price_send_total و...) واحد به‌صراحت
  // در متن تکرار نشده. چون کل اکوسیستم مستندات و مثال‌های عددی تیپاکس بر
  // مبنای ریال است، همان واحد برای Response هم فرض و به تومان (واحد داخلی
  // پروژه) تبدیل شده — این یک استنباط مستندات‌محور است، نه حدس دلبخواه؛
  // توصیه می‌شود در اولین تماس واقعی، مبلغ با پنل Tapin مقایسه/تأیید شود.
  const costToman = Math.round((Number(entries.price_send_total) || 0) / RIAL_PER_TOMAN);

  const estimatedDelivery =
    config.service_type === 7
      ? "۱ تا ۲ روز کاری (SLA مستندشده سرویس اکسپرس درون‌شهری تیپاکس)"
      : config.service_type === 2
      ? "۲ تا ۳ روز کاری (SLA مستندشده سرویس اکسپرس ویژه بین‌شهری تیپاکس)"
      : null;

  return {
    ok: true,
    provider: "tapin",
    carrier: "tipax",
    service: config.service_type === 7 ? "اکسپرس درون‌شهری" : "اکسپرس ویژه بین‌شهری",
    cost: costToman,
    currency: "IRT",
    estimated_delivery: estimatedDelivery,
    available: true,
    tracking: null, // check-price سفارش ثبت نمی‌کند؛ کد رهگیری فقط بعد از ثبت سفارش واقعی وجود دارد (خارج از محدوده این مرحله)
    quote_id: null, // برخلاف register، متد check-price هیچ uuid/شناسه‌ای برنمی‌گرداند
    metadata: {
      raw_entries: entries,
      matched_city: {
        cityId: cityMatch.cityId,
        provinceId: cityMatch.provinceId,
        provinceTitle: cityMatch.provinceTitle,
        cityTitle: cityMatch.cityTitle,
      },
    },
  };
}


// -------------------------------------------------------------------------
// تاریخچه استعلام آنلاین (Audit/Cache) — هرگز خودکار به Table Rate تبدیل نمی‌شود.
// -------------------------------------------------------------------------

export async function recordShippingQuote(env, quote) {
  try {
    await env.DB
      .prepare(
        "INSERT INTO shipping_quote_history " +
        "(provider_code, carrier, service, origin, destination_city, destination_province, weight_grams, " +
        "cart_value, quoted_cost, currency, available, quote_id, metadata_json, ttl_seconds) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        quote.provider_code || null,
        quote.carrier || null,
        quote.service || null,
        quote.origin || null,
        quote.destination_city || null,
        quote.destination_province || null,
        quote.weight_grams ?? null,
        quote.cart_value ?? null,
        quote.quoted_cost ?? null,
        quote.currency || "IRT",
        quote.available === false ? 0 : 1,
        quote.quote_id || null,
        quote.metadata ? JSON.stringify(quote.metadata) : null,
        Number.isInteger(quote.ttl_seconds) ? quote.ttl_seconds : 900
      )
      .run();
    return { ok: true };
  } catch (error) {
    // Fail-Safe: ثبت تاریخچه هرگز نباید مسیر اصلی برآورد/Checkout را بشکند.
    return { ok: false, error: error.message };
  }
}

export async function listShippingQuoteHistory(env, { limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  const result = await env.DB
    .prepare(`SELECT * FROM shipping_quote_history ORDER BY quoted_at DESC, id DESC LIMIT ${safeLimit}`)
    .all();
  return (result.results || []).map((row) => ({ ...row, metadata: safeParseJson(row.metadata_json) }));
}

// -------------------------------------------------------------------------
// Orchestration — هنوز به Endpoint عمومی Cart/Checkout وصل نشده (بالا
// توضیح داده شد چرا)؛ فقط برای Endpoint پیش‌نمایش Admin استفاده می‌شود.
// internalOptionsFn باید دقیقاً resolveShippingOptionsForCart موجود باشد
// (تزریق‌شده از index.js تا این ماژول به آن تابع خصوصی وابسته/کپی نشود).
// -------------------------------------------------------------------------

export async function getShippingOptionsViaEngine(env, { cartItems, city, internalOptionsFn }) {
  const mode = await getShippingCalculationMode(env);

  const internalToStandard = (methods) =>
    (methods || []).map((m) => ({
      provider: "internal",
      carrier: null,
      service: m.name,
      cost: Number(m.cost) || 0,
      currency: "IRT",
      estimated_delivery: null,
      available: true,
      tracking: null,
      quote_id: null,
      metadata: { shipping_method_id: m.id, cost_type: m.cost_type, scope: m.scope },
    }));

  if (mode === "internal") {
    const internal = await internalOptionsFn(env, cartItems, city);
    return { mode, results: internalToStandard(internal) };
  }

  // mode === 'online' یا 'online_fallback_internal'
  const providers = await listShippingProviders(env);
  const tapin = providers.find((p) => p.code === "tapin");

  let onlineResult = null;
  if (tapin && tapin.status === "active" && tapin.mode === "quote") {
    const totalWeight = (cartItems || []).reduce(
      (sum, item) => sum + (Number(item.weightGrams) || 0) * (Number(item.quantity) || 1),
      0
    );
    const totalValue = (cartItems || []).reduce(
      (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
      0
    );
    onlineResult = await quoteViaTapin(env, {
      destinationCity: city,
      weightGrams: totalWeight,
      cartValue: totalValue,
      items: cartItems || [],
    });
    await recordShippingQuote(env, {
      provider_code: "tapin",
      destination_city: city,
      destination_province: onlineResult?.metadata?.matched_city?.provinceTitle || null,
      weight_grams: totalWeight,
      cart_value: totalValue,
      quoted_cost: onlineResult?.cost ?? null,
      available: !!onlineResult?.ok,
      metadata: { raw: onlineResult },
    });
  }

  if (onlineResult?.ok) {
    return { mode, results: [onlineResult] };
  }

  if (mode === "online_fallback_internal" || !tapin || tapin.status !== "active") {
    const internal = await internalOptionsFn(env, cartItems, city);
    return { mode, results: internalToStandard(internal), fell_back: true };
  }

  // mode === 'online' بدون Fallback و بدون Quote موفق
  return { mode, results: [], fell_back: false };
}
