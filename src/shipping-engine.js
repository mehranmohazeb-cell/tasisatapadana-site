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
// وضعیت این مرحله (صادقانه، طبق دستور «هماهنگ‌سازی کامل با Tapin/Tipax»):
//   - رجیستری Provider، نسخه‌بندی/Import تعرفه، تاریخچه Quote: کامل پیاده و تست‌شده (مراحل قبل).
//   - Tapin Adapter (quoteViaTapin) اکنون طبق قرارداد رسمی مستندشده در
//     follow-tapin-tipax-1.pdf پیاده شده است، نه فرض نسخه قبلی: نام دقیق
//     فیلدهای products[] (discount_per_count/amount_per_count/weight_per_count/
//     count) و بدنه اصلی (length/width/height/package_weight/pickup_type)
//     اصلاح شد؛ ابعاد/وزن واقعی بسته دیگر همیشه ۵×۵×۵ نیست — از D1 واقعی
//     (Override بسته‌بندی محصول یا برآورد لایه packaging-estimation.js با
//     تلرانس) خوانده می‌شود؛ service_type دیگر یک عدد ثابت در config نیست،
//     بلکه بر اساس شهر مبدأ (config.origin_city) در برابر شهر مقصد به‌صورت
//     پویا محاسبه می‌شود (بخش ۸ دستور).
//   - محدودیت صادقانه و آگاهانه این مرحله (بخش ۱۶ دستور): چون Endpoint
//     check-price فقط یک بسته (نه آرایه‌ای از بسته‌ها) می‌پذیرد، quoteViaTapin
//     فقط برای سبدی با دقیقاً یک قلم کالای متفاوت کار می‌کند؛ در غیر این
//     صورت خطای صریح TAPIN_MULTI_PACKAGE_UNSUPPORTED برمی‌گرداند (نه تبدیل
//     زورکی چند کالا به یک بسته). داده ابعاد/وزن ناقص هم TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE
//     برمی‌گرداند، نه یک تخمین محافظه‌کارانهٔ بی‌صدا.
//   - ثبت سفارش/لغو/حذف/Label/Tracking همچنان پیاده نشده‌اند (خارج از محدوده
//     همین مرحله، طبق دستور صریح: «Register آماده ولی Disabled»).
//   - این Adapter بدون Credential واقعی (که طبق تصمیم مرحله قبل، دیگر روی
//     Worker نیست و فقط روی VPS/integrations/tapin.py نگه‌داری می‌شود) و
//     بدون تنظیمات کسب‌وکار Tapin (در config_json پنل Providers) قابل تست
//     زنده نیست؛ خطای صریح TAPIN_CONFIG_INCOMPLETE برگردانده می‌شود.
//   - این Sandbox هیچ دسترسی شبکه/SSH به VPS واقعی یا به api.tapin.ir ندارد؛
//     بنابراین Test A تا G سند («تست اجباری») با پاسخ واقعی Tapin در همین
//     محیط قابل اجرا نیستند. آنچه واقعاً انجام شده: تست واحد/Contract روی
//     منطق ساخت Request (فیلدها/ابعاد/service_type) با Proxy Mock — نه یک
//     Round-trip واقعی. این محدودیت باید در گزارش نهایی هم تکرار شود.
//   - اتصال زنده مشتری (مرحله «اصلاح نهایی Quote/Tapin»): Estimate صفحه محصول،
//     Cart و Checkout (هم Preview روش‌ها، هم ثبت نهایی سفارش) اکنون همگی از
//     resolveCustomerShipping در همین فایل می‌گذرند؛ موتور داخلی
//     (resolveShippingOptionsForCart) همچنان دست‌نخورده و به‌عنوان
//     internalOptionsFn/Fallback تزریق می‌شود. Register سفارش Tapin همچنان Disabled است.
//   - shipping_calculation_mode: تست مستقیم روی D1 واقعی نشان داد ستون
//     "site_settings.shipping_calculation_mode" یک CHECK constraint واقعی
//     دارد که فقط مقادیر 'table_rate' و 'engine' را مجاز می‌دانست (خطای
//     واقعی مشاهده‌شده: «CHECK constraint failed: shipping_calculation_mode
//     IN (table_rate, 'engine)»)؛ یعنی نه 'internal' (پیش‌فرض قدیمی همین
//     فایل) و نه 'online' هیچ‌کدام در D1 واقعی مجاز نبودند — دقیقاً همان
//     چیزی که باعث شکست Save در پنل می‌شد. چون SQLite/D1 اجازه تغییر مستقیم
//     CHECK یک ستون موجود را نمی‌دهد، جدول site_settings با migration جدید
//     database/shipping-calculation-mode-v2.sql (الگوی همان بازسازی جدول
//     استاندارد پروژه: ساخت جدول جدید → کپی داده → حذف قدیمی → تغییرنام،
//     دقیقاً مثل technical-format-rules-v2.sql) بازسازی شد تا CHECK جدید
//     'table_rate' و 'engine' قدیمی را حفظ کند و 'online' و
//     'online_fallback_internal' جدید را هم اضافه کند — هیچ مقدار مجاز
//     قبلی حذف نشده. واژگان سطح کد/UI («internal»، «online»،
//     «online_fallback_internal») عمداً تغییر نکرده تا هیچ بخش دیگری
//     (UI، تست‌های قبلی، ستون calculation_mode در shipping_quote_history)
//     لمس نشود؛ ترجمه بین واژگان کد و مقدار واقعی ستون فقط در همین دو تابع
//     (toStoredCalculationMode/fromStoredCalculationMode) انجام می‌شود:
//     «internal» ↔ در D1 به‌صورت 'engine' نوشته می‌شود (مقدار مدرن)؛ مقدار
//     قدیمی 'table_rate' که از قبل در D1 واقعی وجود دارد هم موقع خواندن
//     دقیقاً به همان معنای «internal» تعبیر می‌شود (Fail-Safe قبلی که فقط
//     تصادفاً درست کار می‌کرد، حالا صریح و آگاهانه است) — یعنی داده/رفتار
//     قدیمی هرگز عوض نشده، فقط دیگر به یک «مقدار ناشناخته» شبیه نیست.
//     «online»/«online_fallback_internal» چون هیچ معادل قدیمی در Production
//     نداشتند، بدون تغییر نام مستقیماً به همان مقدار مجاز جدید در CHECK
//     نگاشت می‌شوند.
// =========================================================================


import {
  estimateProductPackage,
  resolveEffectiveProfile,
  loadPackagingProfiles,
} from "./packaging-estimation.js";

export const SHIPPING_CALCULATION_MODES = ["internal", "online", "online_fallback_internal"];

export const TARIFF_SOURCES = ["manual", "tapin", "post", "tipax", "other"];

// -------------------------------------------------------------------------
// حالت محاسبه ارسال — روی همان رکورد تک site_settings (id=1) پروژه.
//
// نگاشت بین واژگان سطح کد/UI (SHIPPING_CALCULATION_MODES بالا) و مقدار
// واقعی ذخیره‌شده در ستون site_settings.shipping_calculation_mode که
// CHECK constraint واقعی‌اش امروز فقط 'table_rate'/'engine'/'online'/
// 'online_fallback_internal' را می‌پذیرد (بعد از
// database/shipping-calculation-mode-v2.sql). این نگاشت تنها همین‌جا
// انجام می‌شود؛ بقیه پروژه (UI، calculation_mode در shipping_quote_history،
// getShippingOptionsViaEngine) همچنان از واژگان «internal»/«online»/
// «online_fallback_internal» استفاده می‌کند و از این تفاوت بی‌خبر می‌ماند.
function toStoredCalculationMode(mode) {
  // «internal» همیشه با مقدار مدرن 'engine' نوشته می‌شود؛ هرگز 'table_rate'
  // (که فقط یک مقدار قدیمی/Legacy برای خواندن سازگار به‌عقب است، نه چیزی
  // که کد از این پس بنویسد).
  return mode === "internal" ? "engine" : mode;
}

function fromStoredCalculationMode(stored) {
  if (stored === "engine" || stored === "table_rate") return "internal";
  if (SHIPPING_CALCULATION_MODES.includes(stored)) return stored;
  return null; // مقدار ناشناخته → دنبال از Fail-Safe در getShippingCalculationMode
}

export async function getShippingCalculationMode(env) {
  try {
    const row = await env.DB
      .prepare("SELECT shipping_calculation_mode FROM site_settings WHERE id = 1 LIMIT 1")
      .first();
    const mode = fromStoredCalculationMode(row?.shipping_calculation_mode);
    return mode || "internal";
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
    .bind(toStoredCalculationMode(mode))
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

// destination_province جزو قرارداد شناخته‌شدهٔ Worker → VPS نیست و کد VPS در
// اختیار ما نیست؛ اگر Proxy فیلد اضافه را رد کند (Pydantic extra=forbid → 422)
// هر Quote می‌شکند. بنابراین فقط وقتی ارسال می‌شود که پس از اصلاح واقعی VPS،
// Worker Variable با نام TAPIN_PROXY_SEND_PROVINCE=true صریحاً تنظیم شده باشد.
function isProvinceForwardingEnabled(env) {
  return String(env?.TAPIN_PROXY_SEND_PROVINCE || "").trim().toLowerCase() === "true";
}

function getProxyCredentials(env) {
  // trim: Secret که با Copy/Paste در داشبورد ذخیره شود ممکن است \n یا فاصلهٔ
  // انتهایی داشته باشد؛ در این حالت هدر نامعتبر می‌شود یا با کلید .env روی VPS
  // نمی‌خواند (401) در حالی که «همان کلید» به نظر می‌رسد.
  const apiKey = typeof env.PROXY_API_KEY === "string" ? env.PROXY_API_KEY.trim() : env.PROXY_API_KEY;
  return { apiKey, ok: !!apiKey, missing: apiKey ? [] : ["PROXY_API_KEY"] };
}

// -------------------------------------------------------------------------
// پاک‌سازی Secret از هر چیزی که وارد Audit/Log می‌شود (بخش «محدودیت‌های مهم»:
// PROXY_API_KEY و Token تیپاکس نباید در log یا response دیده شوند).
// -------------------------------------------------------------------------
function redactSecrets(value, env) {
  if (value == null) return value;
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch (error) {
    return null;
  }
  if (typeof text !== "string") return null;
  const key = typeof env?.PROXY_API_KEY === "string" ? env.PROXY_API_KEY.trim() : "";
  if (key.length >= 6) text = text.split(key).join("[REDACTED]");
  text = text.replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, "$1 [REDACTED]");
  if (typeof value === "string") return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

// علت واقعی خطای Proxy (FastAPI: detail | Proxy ما: message/error) را کوتاه و
// بدون Secret استخراج می‌کند تا در shipping_quote_history.error_message ثبت شود.
function describeProxyFailure(data, rawText, env) {
  let detail = null;
  if (data && typeof data === "object") {
    detail = data.message ?? data.detail ?? data.error ?? null;
    if (detail && typeof detail === "object") {
      try { detail = JSON.stringify(detail); } catch (error) { detail = null; }
    }
  }
  if (!detail && typeof rawText === "string" && rawText.trim()) detail = rawText.trim();
  if (!detail) return null;
  return String(redactSecrets(String(detail), env)).slice(0, 500);
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
// این فیلدها مستقیماً طبق راهنمای رسمی PDF تیپاکس (follow-tapin-tipax-1.pdf)
// مستندشده‌اند؛ هر enum دیگری که در نسخه قبلی این فایل حدس زده شده بود
// (مثلاً product_type_id=2/3/4) حذف شد — طبق اصل «هیچ enum را حدس نزن».
// service_type از این فهرست عمداً حذف شده: دیگر یک مقدار ثابت پیکربندی‌شده
// نیست، بلکه پویا و بر اساس مبدأ/مقصد محاسبه می‌شود (پایین‌تر، getTapinServiceType).
const TAPIN_REQUIRED_CONFIG_FIELDS = [
  "product_type_id", // ۱ = عمومی (تنها مقدار مستندشده در این مرحله)
  "packing_type_id", // ۲ = نیاز به بسته‌بندی ندارد (تنها مقدار مستندشده در این مرحله)
  "payment_type", // ۱۰ = سمت فرستنده/نقدی، ۲۰ = پس‌کرایه (بخش ۹ دستور: ۲۰ فعلاً نباید فعال شود مگر مسیر COD واقعی تکمیل شود)
  "delivery_type", // ۱۰ = تحویل در محل مشتری، ۲۰ = تحویل در محل نمایندگی
  "pickup_type", // ۱۰ = جمع‌آوری در محل مشتری، ۲۰ = جمع‌آوری در نمایندگی (نام قبلی نادرست «type_pickup» بود؛ این‌جا اصلاح شد)
];

async function getTapinBusinessConfig(env) {
  const row = await env.DB.prepare("SELECT config_json FROM shipping_providers WHERE code = 'tapin'").first();
  const config = safeParseJson(row?.config_json) || {};
  const missing = TAPIN_REQUIRED_CONFIG_FIELDS.filter((f) => config[f] === undefined || config[f] === null);
  return { config, missing };
}

// service_type پویا (بخش ۸ دستور): ۷=اکسپرس درون‌شهری اگر مبدأ (شهر
// فروشگاه، از config.origin_city) با شهر مقصد یکی باشد؛ در غیر این صورت
// ۲=اکسپرس ویژه بین‌شهری. هر دو عدد و همچنین شهر مبدأ از پنل Providers قابل
// تنظیم‌اند (config.service_type_local / service_type_domestic / origin_city)
// — مقادیر ۷/۲ پیش‌فرض‌های مستندشده PDF هستند، نه چیزی که این تابع اختراع کند.
// اگر شهر مبدأ در config تنظیم نشده باشد یا مقصد خالی باشد، به‌صورت محافظه‌کارانه
// حالت بین‌شهری فرض می‌شود (چون فرض اشتباهِ «درون‌شهری» ریسک SLA/قیمت نادرست
// بیشتری دارد).
function getTapinServiceType(config, destinationCity) {
  const localType = Number(config.service_type_local) || 7;
  const domesticType = Number(config.service_type_domestic) || 2;
  const origin = normalizePersianText(config.origin_city || "");
  const destination = normalizePersianText(destinationCity || "");
  if (!origin || !destination) return domesticType;
  return origin === destination ? localType : domesticType;
}

function isPositiveNumber(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
}

// -------------------------------------------------------------------------
// تعیین بسته واقعی Quote (بخش ۴/۵/۱۶/۱۷ دستور).
//
// محدودیت مستندشده و صادقانه: Endpoint استعلام قیمت Tapin فقط یک مجموعه
// length/width/height/package_weight برای کل درخواست می‌پذیرد (نه یک آرایه
// از بسته‌ها). به همین دلیل، تا وقتی قرارداد چندبسته‌ای Tapin به‌طور قطعی
// مستند نشده (بخش ۱۶ دستور)، این تابع فقط سبدی را پشتیبانی می‌کند که دقیقاً
// یک قلم کالای متفاوت داشته باشد (با هر تعداد از همان یک کالا) — و به‌جای
// تبدیل زورکی چند کالای متفاوت به یک بسته، خطای صریح TAPIN_MULTI_PACKAGE_UNSUPPORTED
// برمی‌گرداند.
// -------------------------------------------------------------------------
async function resolveTapinPackageSpec(env, { cartItems, productRows }) {
  const productMap = new Map((productRows || []).map((p) => [p.id, p]));
  const uniqueProductIds = [...new Set((cartItems || []).map((i) => i.productId))];

  if (uniqueProductIds.length !== 1) {
    return {
      ok: false,
      error: "TAPIN_MULTI_PACKAGE_UNSUPPORTED",
      message:
        "استعلام آنلاین Tapin در این مرحله فقط برای سبدی با یک قلم کالای متفاوت پشتیبانی می‌شود؛ Endpoint رسمی check-price تیپاکس فقط یک مجموعه ابعاد/وزن بسته می‌پذیرد و قرارداد چندبسته‌ای هنوز مستند نشده — طبق دستور، بدون حدس زدن غیرفعال ماند.",
    };
  }

  const productId = uniqueProductIds[0];
  const product = productMap.get(productId);
  if (!product) {
    return { ok: false, error: "PRODUCT_NOT_FOUND", message: "اطلاعات محصول برای استعلام Tapin در سیستم پیدا نشد." };
  }

  let classDefaultProfileId = null;
  try {
    if (product.shipping_class_id != null) {
      const row = await env.DB
        .prepare("SELECT default_packaging_profile_id FROM shipping_classes WHERE id = ?")
        .bind(product.shipping_class_id)
        .first();
      classDefaultProfileId = row?.default_packaging_profile_id ?? null;
    }
  } catch (error) {
    classDefaultProfileId = null;
  }

  const { byId: profilesById } = await loadPackagingProfiles(env);
  const profile = resolveEffectiveProfile(product, profilesById, classDefaultProfileId);
  const estimate = estimateProductPackage(product, profile);

  // بخش ۱۷ دستور: داده ناقص → به‌جای حدس بی‌صدا (که تخمین Conservative داخلی
  // برای موتور داخلی مجاز است)، برای Tapin به‌صراحت غیرفعال می‌شود.
  if (estimate.incomplete) {
    return {
      ok: false,
      error: "TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE",
      message:
        "ابعاد و وزن واقعی بسته این محصول در سیستم ثبت نشده (نه Override بسته‌بندی و نه ابعاد/وزن پایه محصول کامل است)؛ Tapin بدون این اطلاعات واقعی استعلام نمی‌گیرد.",
    };
  }

  // بخش ۵ دستور: weight_per_count = وزن خود کالا و package_weight = وزن
  // بسته‌بندی؛ این دو هرگز با هم قاطی نمی‌شوند.
  //   - وزن کالا فقط از product.weight_grams (داده واقعی) می‌آید. اگر ثبت
  //     نشده باشد، وزن جعلی/جایگزین (مثلاً وزن بسته) ساخته نمی‌شود.
  //   - وزن بسته‌بندی: اگر Override واقعی بسته‌بندی محصول موجود است
  //     (source ≠ ESTIMATED) همان package_weight_grams است؛ اگر برآورد با
  //     تلرانس بوده، فقط «سهم بسته‌بندی/تلرانس» = وزن برآوردی − وزن کالا،
  //     تا وزن کالا دوبار شمرده نشود.
  if (!isPositiveNumber(product.weight_grams)) {
    return {
      ok: false,
      error: "TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE",
      message: "وزن واقعی کالا (weight_grams) برای این محصول ثبت نشده؛ Tapin بدون وزن واقعی کالا استعلام نمی‌گیرد و وزن جایگزین ساخته نمی‌شود.",
    };
  }
  const weightPerCountGrams = Math.round(Number(product.weight_grams));
  const packagingWeightGrams =
    estimate.source === "ESTIMATED"
      ? Math.max(Math.round(estimate.weightGrams) - weightPerCountGrams, 0)
      : Math.round(estimate.weightGrams);

  return {
    ok: true,
    productId,
    weightPerCountGrams,
    package: {
      lengthCm: Math.round(estimate.lengthCm),
      widthCm: Math.round(estimate.widthCm),
      heightCm: Math.round(estimate.heightCm),
      weightGrams: packagingWeightGrams,
      source: estimate.source,
    },
  };
}

// تک تماس Worker→Proxy برای کل Quote — نه تماس‌های جداگانه برای هر
// Endpoint خام Tapin (طبق معماری جدید بخش ۴/۷/۱۴ دستور). Proxy مسئول انجام
// کامل چرخه (حل‌وفصل شهر + check-price واقعی نزد Tapin) است و یک نتیجه
// نهایی/نرمال‌شده برمی‌گرداند.
const PROXY_TIMEOUT_MS = 15000;

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

  // Timeout صریح: بدون آن، اگر VPS پاسخ ندهد Worker منتظر می‌ماند، هیچ
  // نتیجه/Audit ثبت نمی‌شود و مشتری خطای مبهم می‌بیند.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS) : null;

  let response;
  try {
    response = await fetch(`${proxyBaseUrl}${proxyPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxy.apiKey}`,
      },
      body: JSON.stringify(quotePayload),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (timer) clearTimeout(timer);
    const aborted = error?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "PROXY_TIMEOUT" : "PROXY_NETWORK_ERROR",
      message: aborted
        ? `Integration Proxy تا ${PROXY_TIMEOUT_MS / 1000} ثانیه پاسخ نداد.`
        : String(redactSecrets(error?.message || "fetch failed", env)).slice(0, 300),
    };
  }

  // بدنه را یک‌بار می‌خوانیم؛ اگر JSON نبود، متن خام (کوتاه‌شده) علت واقعی است
  // (مثلاً صفحهٔ HTML خطای Cloudflare/nginx).
  let data = null;
  let rawText = null;
  try {
    if (typeof response.text === "function") {
      rawText = await response.text();
      try { data = JSON.parse(rawText); } catch (error) { data = null; }
    } else {
      data = await response.json();
    }
  } catch (error) {
    data = null;
  }
  if (timer) clearTimeout(timer);

  if (data === null) {
    return {
      ok: false,
      error: "PROXY_INVALID_RESPONSE",
      status: response.status,
      message:
        `HTTP ${response.status}: پاسخ Integration Proxy JSON قابل‌خواندن نبود` +
        (rawText ? ` — ${describeProxyFailure(null, rawText.slice(0, 200), env)}` : "."),
    };
  }

  // خطای سطح HTTP/Proxy (نه خطای منطقی Tapin/City که Proxy با ok:false و یک
  // کد مشخص گزارش می‌کند — آن حالت را quoteViaTapin پایین‌تر مدیریت می‌کند).
  if (!response.ok) {
    const reason = describeProxyFailure(data, null, env);
    return {
      ok: false,
      error: "PROXY_HTTP_ERROR",
      status: response.status,
      message: `HTTP ${response.status}${reason ? `: ${reason}` : ""}`,
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

  const cartItems = (quoteRequest.items || []).map((item) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    price: Number(item.price) || 0,
    discount: Number(item.discount) || 0,
  }));

  // بخش ۴/۱۶/۱۷ دستور: اطلاعات واقعی بسته/وزن از D1 (productRows، از پیش
  // توسط فراخواننده واکشی‌شده — طبق الگوی بدون منبع موازی همین پروژه)،
  // نه هیچ مقدار حدسی/ثابت.
  const packageSpec = await resolveTapinPackageSpec(env, {
    cartItems,
    productRows: quoteRequest.productRows || [],
  });
  if (!packageSpec.ok) {
    return { ok: false, provider: "tapin", error: packageSpec.error, message: packageSpec.message, available: false };
  }

  const item = cartItems.find((i) => i.productId === packageSpec.productId);

  // بخش ۶ دستور: تبدیل تومان→ریال فقط همین یک‌بار، فقط این‌جا.
  const products = [
    {
      discount_per_count: Math.round(item.discount * RIAL_PER_TOMAN),
      amount_per_count: Math.round(item.price * RIAL_PER_TOMAN),
      weight_per_count: packageSpec.weightPerCountGrams,
      count: item.quantity,
    },
  ];

  const serviceType = getTapinServiceType(config, quoteRequest.destinationCity);

  // بدنه Quote — دقیقاً با نام فیلدهای رسمی Tapin (بخش ۳ دستور). شهر مقصد
  // به‌صورت نام خام ارسال می‌شود؛ حل‌وفصل province/city سمت VPS/Proxy انجام
  // می‌شود (Worker لیست/Endpoint شهر Tapin را مستقیماً صدا نمی‌زند).
  const quotePayload = {
    destination_city: quoteRequest.destinationCity,
    ...(quoteRequest.destinationProvince && isProvinceForwardingEnabled(env)
      ? { destination_province: quoteRequest.destinationProvince }
      : {}),
    product_type_id: config.product_type_id,
    packing_type_id: config.packing_type_id,
    payment_type: config.payment_type,
    service_type: serviceType,
    delivery_type: config.delivery_type,
    pickup_type: config.pickup_type,
    products,
    length: packageSpec.package.lengthCm,
    width: packageSpec.package.widthCm,
    height: packageSpec.package.heightCm,
    package_weight: packageSpec.package.weightGrams,
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

  // فقط فیلد مستندشدهٔ Tapin پذیرفته می‌شود: entries.total_send_price (ریال).
  // فیلدهای حدسی (مثل cost که واحدش معلوم نیست) عمداً پذیرفته نمی‌شوند تا
  // تبدیل واحد دوباره/اشتباه رخ ندهد؛ تبدیل ریال→تومان فقط همین یک‌بار است.
  const entries = responseData.entries || null;
  const totalSendPriceRial = entries?.total_send_price;
  let costToman = null;
  if (totalSendPriceRial != null && totalSendPriceRial !== "") {
    costToman = Math.round(Number(totalSendPriceRial) / RIAL_PER_TOMAN);
  }
  // Fail-Safe (بخش ۲۵ دستور): پاسخ بدون مبلغ قابل‌اتکا هرگز «ارسال رایگان»
  // یا موفقیت نمایش داده نمی‌شود.
  if (!Number.isFinite(costToman) || costToman <= 0) {
    return {
      ok: false,
      provider: "tapin",
      error: "TAPIN_RESPONSE_UNRECOGNIZED",
      message: "پاسخ Tapin مبلغ معتبر ارسال نداشت (entries.total_send_price).",
      available: false,
    };
  }

  const estimatedDelivery =
    serviceType === Number(config.service_type_local) || (serviceType === 7 && config.service_type_local == null)
      ? "۱ تا ۲ روز کاری (SLA مستندشده سرویس اکسپرس درون‌شهری تیپاکس)"
      : "۲ تا ۳ روز کاری (SLA مستندشده سرویس اکسپرس ویژه بین‌شهری تیپاکس)";

  return {
    ok: true,
    provider: "tapin",
    carrier: "tipax",
    service: serviceType === 7 ? "اکسپرس درون‌شهری" : "اکسپرس ویژه بین‌شهری",
    cost: costToman,
    currency: "IRT",
    estimated_delivery: estimatedDelivery,
    available: true,
    tracking: responseData.tracking ?? null,
    quote_id: responseData.quote_id ?? null,
    metadata: {
      raw_response: responseData,
      matched_city: responseData.matched_city || null,
      package: packageSpec.package,
      service_type: serviceType,
    },
  };
}


// -------------------------------------------------------------------------
// تاریخچه استعلام آنلاین (Audit/Cache) — هرگز خودکار به Table Rate تبدیل نمی‌شود.
// -------------------------------------------------------------------------

export async function recordShippingQuote(env, quote) {
  try {
    // Schema واقعی shipping_quote_history در D1 فقط این ستون‌ها را دارد:
    // id, provider_code, calculation_mode, request_json, response_json,
    // status, error_code, error_message, created_at (auto). هیچ ستون
    // جداگانه‌ای برای carrier/service/origin/destination_city/weight_grams/
    // cart_value/quoted_cost/quote_id/ttl_seconds/quoted_at وجود ندارد؛ این
    // داده‌ها (در صورت نیاز به Audit) داخل request_json/response_json
    // نگهداری می‌شوند، نه به‌عنوان ستون فیزیکی جدید.
    const requestPayload = {
      destination_city: quote.destination_city ?? null,
      destination_province: quote.destination_province ?? null,
      weight_grams: quote.weight_grams ?? null,
      cart_value: quote.cart_value ?? null,
      ...(quote.request_extra || {}),
    };
    // پاسخ خام Provider (raw) همان چیزی است که قبلاً داخل metadata.raw
    // نگه‌داری می‌شد؛ همان ساختار موجود بدون تغییر در response_json ذخیره
    // می‌شود. هر Secret احتمالی قبل از ثبت پاک می‌شود.
    const responsePayload = redactSecrets(quote.metadata?.raw ?? quote.metadata ?? null, env);

    const isAvailable = quote.available !== false;
    const errorCode = !isAvailable ? responsePayload?.error ?? null : null;
    const rawErrorMessage = !isAvailable ? responsePayload?.message ?? null : null;
    const errorMessage = rawErrorMessage != null ? String(rawErrorMessage).slice(0, 500) : null;

    await env.DB
      .prepare(
        "INSERT INTO shipping_quote_history " +
        "(provider_code, calculation_mode, request_json, response_json, status, error_code, error_message) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        quote.provider_code || null,
        quote.calculation_mode || null,
        JSON.stringify(requestPayload),
        responsePayload != null ? JSON.stringify(responsePayload) : null,
        isAvailable ? "success" : "error",
        errorCode,
        errorMessage
      )
      .run();
    return { ok: true };
  } catch (error) {
    // Fail-Safe: ثبت تاریخچه هرگز نباید مسیر اصلی برآورد/Checkout را بشکند.
    // اما دیگر «بی‌صدا» هم نیست: علت واقعی شکست INSERT (مثلاً CHECK constraint
    // پنهان در Schema واقعی Production) در Log ثبت می‌شود و به فراخواننده
    // برمی‌گردد (فقط Admin Preview آن را می‌بیند، نه پاسخ عمومی مشتری).
    // Schema واقعی جدول (شامل CHECKها) هم برای تشخیص خوانده و لاگ می‌شود.
    let tableSql = null;
    try {
      const row = await env.DB
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shipping_quote_history'")
        .first();
      tableSql = row?.sql || null;
    } catch (schemaError) {
      tableSql = null;
    }
    const message = String(redactSecrets(error?.message || "unknown error", env)).slice(0, 500);
    console.error("[shipping_quote_history] INSERT failed:", message, tableSql ? `| table DDL: ${tableSql}` : "");
    return { ok: false, error: message };
  }
}

export async function listShippingQuoteHistory(env, { limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  const result = await env.DB
    .prepare(`SELECT *, created_at AS quoted_at FROM shipping_quote_history ORDER BY created_at DESC, id DESC LIMIT ${safeLimit}`)
    .all();
  return (result.results || []).map((row) => ({ ...row, metadata: safeParseJson(row.metadata_json) }));
}

// -------------------------------------------------------------------------
// مسیر مشترک Quote مشتری (Shared Shipping Quote) — بخش ۶/۲۸ دستور.
//
//   Estimate صفحه محصول / Cart / Checkout (Preview و ثبت نهایی سفارش) /
//   پیش‌نمایش Admin → همه فقط از همین یک تابع می‌گذرند:
//
//     resolveCustomerShipping → { internal | Tapin (via VPS Proxy) }
//
// رفتار حالت‌ها:
//   internal (engine/table_rate در D1) → فقط موتور داخلی (internalOptionsFn).
//   online                              → فقط Tapin؛ اگر شکست/غیرفعال بود
//                                         هیچ Fallback بی‌صدایی وجود ندارد
//                                         (shipping_methods=[] + unavailable).
//   online_fallback_internal            → Tapin؛ فقط در صورت شکست، موتور
//                                         داخلی با fell_back=true و
//                                         source='internal' (هیچ‌وقت به اسم Tapin).
//
// قیمت/وزن/ابعاد همیشه از D1 خوانده می‌شود (نه ورودی مرورگر) تا Estimate و
// Checkout برای شرایط یکسان دقیقاً یک Quote یکسان بسازند.
// internalOptionsFn باید دقیقاً resolveShippingOptionsForCart موجود باشد.
// -------------------------------------------------------------------------

export const TAPIN_OPTION_ID = "tapin";

const ONLINE_UNAVAILABLE_MESSAGES = {
  TAPIN_MULTI_PACKAGE_UNSUPPORTED:
    "برآورد آنلاین ارسال برای سبد شامل چند کالای متفاوت فعلاً ممکن نیست. لطفاً با پشتیبانی تماس بگیرید.",
  TAPIN_PACKAGE_DIMENSIONS_INCOMPLETE:
    "اطلاعات ابعاد/وزن بسته این کالا برای برآورد آنلاین کامل نیست. لطفاً با پشتیبانی تماس بگیرید.",
  TAPIN_CONFIG_INCOMPLETE: "امکان برآورد آنلاین ارسال در حال حاضر وجود ندارد.",
  TAPIN_PROVIDER_INACTIVE: "امکان برآورد آنلاین ارسال در حال حاضر وجود ندارد.",
  AMBIGUOUS_CITY_NAME: "شهر انتخاب‌شده برای ارسال آنلاین مبهم است؛ لطفاً استان و شهر را دقیق‌تر انتخاب کنید.",
  CITY_NOT_FOUND: "برای این شهر امکان ارسال آنلاین پیدا نشد. لطفاً با پشتیبانی تماس بگیرید.",
};
const ONLINE_UNAVAILABLE_DEFAULT_MESSAGE =
  "امکان برآورد آنلاین هزینه ارسال در حال حاضر وجود ندارد. لطفاً کمی بعد دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.";

const PRODUCT_SHIPPING_COLUMNS =
  "id, name, price, weight_grams, shipping_class_id, length_cm, width_cm, height_cm, " +
  "packaging_profile_id, package_length_cm, package_width_cm, package_height_cm, " +
  "package_weight_grams, packaging_confidence";

export function normalizeShippingCartItems(cartItems) {
  const merged = new Map();
  for (const item of cartItems || []) {
    const productId = Number(typeof item === "object" && item !== null ? item.productId ?? item.id : item);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    const quantity = typeof item === "object" && item !== null && Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

async function loadShippingProductRows(env, productIds) {
  if (!productIds.length) return [];
  const placeholders = productIds.map(() => "?").join(",");
  const result = await env.DB
    .prepare(`SELECT ${PRODUCT_SHIPPING_COLUMNS} FROM products WHERE id IN (${placeholders})`)
    .bind(...productIds)
    .all();
  return result.results || [];
}

export async function resolveCustomerShipping(env, { cartItems, city, province, internalOptionsFn, productRows } = {}) {
  const mode = await getShippingCalculationMode(env);
  const normalized = normalizeShippingCartItems(cartItems);

  // قیمت و مشخصات واقعی از D1 (هرگز از مرورگر).
  let rows = productRows;
  if (!rows) {
    try {
      rows = await loadShippingProductRows(env, normalized.map((i) => i.productId));
    } catch (error) {
      rows = [];
    }
  }
  const rowMap = new Map((rows || []).map((r) => [Number(r.id), r]));
  const items = normalized.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    price: Number(rowMap.get(item.productId)?.price) || 0,
    discount: 0,
  }));

  const asInternal = (methods) =>
    (methods || []).map((m) => ({ ...m, cost: Number(m.cost) || 0, source: "internal" }));

  if (mode === "internal") {
    const internal = await internalOptionsFn(env, items, city);
    return { mode, source: "internal", shipping_methods: asInternal(internal), fell_back: false, unavailable: null };
  }

  // mode === 'online' | 'online_fallback_internal'
  let onlineResult;
  let tapinProvider = null;
  try {
    const providers = await listShippingProviders(env);
    tapinProvider = providers.find((p) => p.code === "tapin") || null;
  } catch (error) {
    tapinProvider = null;
  }

  if (!tapinProvider || tapinProvider.status !== "active" || tapinProvider.mode !== "quote") {
    onlineResult = {
      ok: false,
      provider: "tapin",
      available: false,
      error: "TAPIN_PROVIDER_INACTIVE",
      message: "Provider تیپاکس فعال نیست یا در حالت quote نیست.",
    };
  } else {
    // هر استثنای غیرمنتظره داخل Adapter به یک نتیجهٔ ناموفق «با علت واقعی»
    // تبدیل می‌شود، نه خطای ۵۰۰ که پیش از ثبت Audit مسیر را می‌شکند.
    try {
      onlineResult = await quoteViaTapin(env, {
        destinationCity: city,
        destinationProvince: province || null,
        items,
        productRows: rows || [],
      });
    } catch (error) {
      onlineResult = {
        ok: false,
        provider: "tapin",
        available: false,
        error: "TAPIN_ADAPTER_EXCEPTION",
        message: String(redactSecrets(error?.message || "unknown error", env)).slice(0, 300),
      };
    }
  }

  // Audit برای هر استعلام آنلاین (موفق یا ناموفق) — طبق معماری فعلی:
  // فقط گزارش/Cache است و هیچ‌وقت به Table Rate تبدیل نمی‌شود.
  const totalWeight = items.reduce(
    (sum, i) => sum + (Number(rowMap.get(i.productId)?.weight_grams) || 0) * i.quantity,
    0
  );
  const totalValue = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const audit = await recordShippingQuote(env, {
    provider_code: "tapin",
    calculation_mode: mode,
    destination_city: city || null,
    destination_province: province || onlineResult?.metadata?.matched_city?.provinceTitle || null,
    weight_grams: totalWeight,
    cart_value: totalValue,
    quoted_cost: onlineResult?.cost ?? null,
    available: !!onlineResult?.ok,
    request_extra: {
      items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity, price_toman: i.price })),
      service_type: onlineResult?.metadata?.service_type ?? null,
      package: onlineResult?.metadata?.package ?? null,
      quoted_cost_toman: onlineResult?.cost ?? null,
      http_status: onlineResult?.status ?? null,
    },
    metadata: { raw: onlineResult },
  });

  if (onlineResult?.ok) {
    return {
      mode,
      source: "tapin",
      fell_back: false,
      unavailable: null,
      audit,
      shipping_methods: [
        {
          id: TAPIN_OPTION_ID,
          name: "ارسال با تیپاکس",
          cost: onlineResult.cost,
          cost_type: "prepaid",
          scope: "online",
          source: "tapin",
          carrier: onlineResult.carrier || "tipax",
          service: onlineResult.service || null,
          estimated_delivery: onlineResult.estimated_delivery || null,
          quote_id: onlineResult.quote_id || null,
        },
      ],
    };
  }

  if (mode === "online_fallback_internal") {
    const internal = await internalOptionsFn(env, items, city);
    return {
      mode,
      source: "internal",
      shipping_methods: asInternal(internal),
      fell_back: true,
      unavailable: null,
      online_error: onlineResult?.error || "TAPIN_UNAVAILABLE",
      audit,
    };
  }

  // mode === 'online' (فقط آنلاین): شکست = «در دسترس نیست»، نه Fallback بی‌صدا.
  const code = onlineResult?.error || "TAPIN_UNAVAILABLE";
  return {
    mode,
    source: "tapin",
    shipping_methods: [],
    fell_back: false,
    unavailable: { code, message: ONLINE_UNAVAILABLE_MESSAGES[code] || ONLINE_UNAVAILABLE_DEFAULT_MESSAGE },
    audit,
  };
}

// سازگاری عقب‌گرد Endpoint پیش‌نمایش Admin: همان مسیر مشترک، با قالب خروجی قبلی.
export async function getShippingOptionsViaEngine(env, { cartItems, city, province, internalOptionsFn, productRows }) {
  const shared = await resolveCustomerShipping(env, { cartItems, city, province, internalOptionsFn, productRows });
  const results = shared.shipping_methods.map((m) =>
    m.source === "tapin"
      ? {
          provider: "tapin",
          carrier: m.carrier,
          service: m.service,
          cost: m.cost,
          currency: "IRT",
          estimated_delivery: m.estimated_delivery,
          available: true,
          tracking: null,
          quote_id: m.quote_id,
          metadata: { option_id: m.id },
        }
      : {
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
        }
  );
  const out = { mode: shared.mode, results, fell_back: shared.fell_back };
  if (shared.unavailable) out.unavailable = shared.unavailable;
  if (shared.audit) out.audit = shared.audit; // فقط Admin Preview: نتیجهٔ ثبت Audit (موفق/علت شکست)
  return out;
}
