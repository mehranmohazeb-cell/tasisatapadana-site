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
// Tapin/Tipax Adapter — طبق ساختار واقعی VPS که در این مرحله توسط کاربر
// توصیف شده (routers/tapin.py + integrations/tapin.py، prefix /api/v1/tapin،
// Endpoint موجود POST /api/v1/tapin/quote).
// -------------------------------------------------------------------------
//
// ⚠️ توجه صادقانه (باید در گزارش نهایی هم تکرار شود): در همین پیام، کاربر
// ادعا کرده «ZIP پروژه پیوست است» ولی هیچ فایل جدیدی در این Sandbox آپلود
// نشده — فقط همان ZIP قبلی از قبل این‌جا بود. هم‌چنین، کد واقعی VPS
// (routers/tapin.py, integrations/tapin.py, main.py) هرگز در اختیار من قرار
// نگرفته — نه در این مرحله و نه مرحله قبل. بنابراین قرارداد دقیق Request/
// Response با POST /api/v1/tapin/quote در ادامه یک قرارداد *مستند و صریحاً
// فرضی* است (نه چیزی که از کد واقعی VPS خوانده باشم)، دقیقاً روی همان الگویی
// که خود دستور در بخش‌های ۸ تا ۱۱ توصیف کرده. تا وقتی محتوای واقعی آن دو
// فایل Python در اختیارم نیست، امکان تولید یک Patch دقیق/غیر-حدسی برای
// integrations/tapin.py وجود ندارد — این بخش در گزارش نهایی («کارهای
// باقی‌مانده») صریحاً اعلام شده.
//
// تغییر معماری کلیدی نسبت به نسخه قبلی این فایل:
//   ۱. Endpoint واقعی Proxy طبق ساختار موجود VPS همان مسیر ثابت و از‌پیش‌
//      ثبت‌شده «/api/v1/tapin/quote» است — نه «/tapin/request» (که در تلاش
//      قبلی، بدون دیدن کد واقعی VPS، به‌عنوان پیشنهاد فرضی ساخته شده بود و
//      طبق این دستور صریحاً باید کنار گذاشته شود).
//   ۲. طبق بخش ۱۵ دستور: «هیچ TAPIN_TOKEN نباید در Worker قرار بگیرد» —
//      یعنی Credential واقعی Tapin (Token/Shop ID) دیگر در Cloudflare
//      Secrets نیست؛ این دو روی خود VPS (.env) نگه‌داری و توسط
//      integrations/tapin.py استفاده می‌شوند. Worker فقط با PROXY_API_KEY به
//      Proxy احراز هویت می‌شود.
//   ۳. طبق بخش ۷ دستور: «Worker نباید مستقیماً [هیچ‌کدام از ۳ Endpoint Tapin
//      از جمله location] را فراخوانی کند» — یعنی Passthrough عمومی
//      (path دلخواه) هم دیگر مجاز نیست (این خودش یک الگوی Generic Proxy/SSRF
//      بود که بخش ۱۴ همین دستور صراحتاً منع کرده). بنابراین حل‌وفصل
//      Province/City حالا باید سمت VPS (داخل integrations/tapin.py، هنگام
//      get_quote) انجام شود؛ Worker فقط نام شهر مقصد را در بدنه Quote
//      می‌فرستد، نه شناسه‌های از‌پیش‌حل‌شده.
//   ۴. توابع fetchTapinLocations (که مستقیماً location endpoint های Tapin را
//      از طریق Proxy صدا می‌زد) به همین دلیل حذف شدند — دیگر مسیر امنی برای
//      اجرای آن‌ها وجود ندارد. توابع خالص findTapinCityMatch/normalizePersianText
//      (که فقط منطق تطبیق را پیاده می‌کنند، نه تماس شبکه) به‌عنوان مرجع/Reuse
//      احتمالی نگه داشته شده‌اند (بخش ۹ دستور: «منطق موجود Worker برای
//      Province/City/City Mapping حفظ شود») — اما دیگر توسط quoteViaTapin
//      صدا زده نمی‌شوند، چون آن منطق باید سمت VPS (به زبان Python، در
//      integrations/tapin.py) بازتولید شود، نه سمت Worker.

const INTEGRATION_PROXY_DEFAULT_BASE_URL = "https://proxy.tasisatapadanaesfahan.ir";
// مسیر واقعی موجود روی VPS طبق بخش ۲ دستور (routers/tapin.py با prefix
// /api/v1/tapin) — قابل بازنویسی با env.INTEGRATION_PROXY_TAPIN_QUOTE_PATH
// فقط برای مواقع اضطراری/تغییر آینده، نه چیزی که معمولاً باید عوض شود.
const INTEGRATION_PROXY_DEFAULT_QUOTE_PATH = "/api/v1/tapin/quote";

function getProxyCredentials(env) {
  const apiKey = env.PROXY_API_KEY;
  return { apiKey, ok: !!apiKey, missing: apiKey ? [] : ["PROXY_API_KEY"] };
}

// واحد پول: طبق PDF، مقادیر ارزش کالا در Request صراحتاً «به ریال» هستند.
// پروژه داخلاً بر مبنای «تومان» کار می‌کند (تأیید‌شده از public/store/*.js).
// تبدیل فقط همین‌جا (در Adapter) انجام می‌شود، نه جای دیگر.
const RIAL_PER_TOMAN = 10;

// فیلدهای تنظیمات کسب‌وکار Tapin که PDF آن‌ها را به‌صورت enum مستند کرده اما
// مقدار مناسب هرکدام برای این فروشگاه، تصمیمی تجاری/حساب‌کاربری است که در
// سند مشخص نشده. عمداً حدس زده نمی‌شوند — باید از پنل «Providers» برای
// Provider با code='tapin' در ستون config (JSON) تنظیم شوند. این بخش طبق
// بخش ۸ دستور («همان منبع config_json حفظ شود») بدون تغییر مانده.
const TAPIN_REQUIRED_CONFIG_FIELDS = [
  "product_type_id", // نوع کالا: ۱=بسته/عمومی، ۲=اوراق و اسناد بانکی(پاکت)/نامه، ۳=عمومی/نامه، ۴=مایعات-شکستنی/بسته
  "packing_type_id", // نوع بسته‌بندی (pk از جدول type_pack مستندشده در PDF — مثلاً ۲="نیاز به بسته‌بندی ندارد" برای کارتن)
  "payment_type", // طبق جدول enum سند: ۱۰=آنلاین، ۲۰=پس‌کرایه (توجه: متن توضیحی سند این دو را «نقدی»/«پس‌کرایه» نامیده — ناهماهنگی داخل خود سند؛ در گزارش نهایی تکرار شده)
  "service_type", // ۲=اکسپرس ویژه بین‌شهری، ۷=اکسپرس درون‌شهری
  "delivery_type", // ۱۰=تحویل در محل مشتری، ۲۰=تحویل در محل نمایندگی
  "type_pickup", // ۱۰=جمع‌آوری در محل مشتری، ۲۰=جمع‌آوری در نمایندگی
];

async function getTapinBusinessConfig(env) {
  const row = await env.DB.prepare("SELECT config_json FROM shipping_providers WHERE code = 'tapin'").first();
  const config = safeParseJson(row?.config_json) || {};
  const missing = TAPIN_REQUIRED_CONFIG_FIELDS.filter((f) => config[f] === undefined || config[f] === null);
  return { config, missing };
}

// تک تماس Worker→Proxy برای کل Quote — نه تماس‌های جداگانه برای هر
// Endpoint خام Tapin (طبق معماری جدید بخش ۴/۷/۱۴ دستور). Proxy مسئول انجام
// کامل چرخه (حل‌وفصل شهر + check-price واقعی نزد Tapin) است و یک نتیجه
// نهایی/نرمال‌شده برمی‌گرداند.
async function requestTapinQuoteViaProxy(env, quotePayload) {
  const proxy = getProxyCredentials(env);
  if (!proxy.ok) {
    return {
      ok: false,
      error: "PROXY_CREDENTIALS_MISSING",
      message: `Credential Integration Proxy تنظیم نشده در Worker Secrets: ${proxy.missing.join(", ")}`,
      missing: proxy.missing,
    };
  }

  const proxyBaseUrl = env.INTEGRATION_PROXY_BASE_URL || INTEGRATION_PROXY_DEFAULT_BASE_URL;
  const proxyPath = env.INTEGRATION_PROXY_TAPIN_QUOTE_PATH || INTEGRATION_PROXY_DEFAULT_QUOTE_PATH;

  let response;
  try {
    response = await fetch(`${proxyBaseUrl}${proxyPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxy.apiKey}`,
      },
      body: JSON.stringify(quotePayload),
    });
  } catch (error) {
    return { ok: false, error: "PROXY_NETWORK_ERROR", message: error.message };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return {
      ok: false,
      error: "PROXY_INVALID_RESPONSE",
      status: response.status,
      message: "پاسخ Integration Proxy به‌صورت JSON قابل‌خواندن نبود.",
    };
  }

  // خطای سطح HTTP/Proxy (نه خطای منطقی Tapin/City که Proxy با ok:false و یک
  // کد مشخص گزارش می‌کند — آن حالت را quoteViaTapin پایین‌تر مدیریت می‌کند).
  if (!response.ok) {
    return {
      ok: false,
      error: "PROXY_HTTP_ERROR",
      status: response.status,
      message: data?.message || null,
    };
  }

  return { ok: true, status: response.status, data };
}

// -------------------------------------------------------------------------
// City Mapping — توابع خالص (بدون تماس شبکه) که طبق بخش ۹ دستور به‌عنوان
// مرجع/Reuse نگه داشته شده‌اند. دیگر توسط quoteViaTapin صدا زده نمی‌شوند
// (حل‌وفصل شهر اکنون سمت VPS/integrations/tapin.py انجام می‌شود)، اما همان
// الگوریتم normalize/تطبیق قبلی اینجا حفظ شده تا هنگام بازتولید این منطق به
// Python، مرجع دقیقی موجود باشد.
// -------------------------------------------------------------------------
export function normalizePersianText(value) {
  return String(value || "")
    .replace(/\u200c/g, " ") // نیم‌فاصله → فاصله ساده، برای مقایسه پایدارتر
    .replace(/ك/g, "ک")
    .replace(/ي/g, "ی")
    .trim()
    .toLowerCase();
}

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

  const items = quoteRequest.items || [];
  const products = items.map((item) => ({
    count_per_discount: 0,
    count_per_amount: Math.round((Number(item.price) || 0) * RIAL_PER_TOMAN),
    weight_per_count: Number(item.weightGrams) || 0,
    count: Number(item.quantity) || 1,
  }));

  const packagingWeightGrams = Number(config.default_packaging_weight_grams) || 0;

  // بدنه Quote — طبق بخش ۸ دستور، شامل نام شهر مقصد (نه شناسه از‌پیش‌حل‌شده؛
  // حل‌وفصل شهر اکنون سمت VPS انجام می‌شود) به‌همراه تنظیمات کسب‌وکار از
  // shipping_providers.config_json و اطلاعات واقعی محصول/بسته:
  const quotePayload = {
    destination_city: quoteRequest.destinationCity,
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

  const result = await requestTapinQuoteViaProxy(env, quotePayload);
  if (!result.ok) {
    return { ok: false, provider: "tapin", ...result, available: false };
  }

  const responseData = result.data || {};

  // اگر Proxy سطح HTTP موفق بوده ولی خود Quote منطقاً ناموفق است (مثلاً شهر
  // پیدا نشد/مبهم بود یا Tapin خطا داده) — این‌جا Proxy طبق قرارداد فرضی
  // { ok: false, error, message, candidates? } را برمی‌گرداند و Worker فقط
  // آن را بدون تفسیر اضافه Passthrough می‌کند (منطق تفسیر خطا اکنون سمت VPS
  // است، نه اینجا).
  if (responseData.ok === false) {
    return {
      ok: false,
      provider: "tapin",
      error: responseData.error || "TAPIN_API_ERROR",
      message: responseData.message || null,
      candidates: responseData.candidates || null,
      available: false,
    };
  }

  // واحد پول (صادقانه): همان ابهام قبلی هنوز حل‌نشده مانده — این مرحله هم
  // بدون یک Real Quote واقعی اجرا نشده، پس این تبدیل هنوز یک استنباط
  // مستندات‌محور است، نه چیزی که با پاسخ واقعی Tapin تأیید شده باشد.
  const costToman =
    responseData.cost != null
      ? Math.round(Number(responseData.cost))
      : Math.round((Number(responseData.price_send_total) || 0) / RIAL_PER_TOMAN);

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
    tracking: responseData.tracking ?? null,
    quote_id: responseData.quote_id ?? null,
    metadata: {
      raw_response: responseData,
      matched_city: responseData.matched_city || null,
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
