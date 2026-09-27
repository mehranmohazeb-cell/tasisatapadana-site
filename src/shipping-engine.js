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
//   - اتصال زنده Cart/Checkout مشتری به این Engine: همچنان انجام نشده (طبق
//     دستور صریح بخش ۲۱ — فعلاً فقط از Endpoint Admin «shipping-engine-preview»
//     قابل تست است). resolveShippingOptionsForCart و shipping_table_rates
//     به‌عنوان موتور داخلی واقعی سایت، کاملاً دست‌نخورده مانده‌اند.
//   - shipping_calculation_mode در D1 واقعی مقدار قدیمی «table_rate» را دارد؛
//     چون این مقدار در SHIPPING_CALCULATION_MODES نیست، getShippingCalculationMode
//     به‌صورت Fail-Safe مقدار «internal» را برمی‌گرداند — یعنی رفتار امروز
//     (فقط موتور داخلی) دقیقاً حفظ می‌شود. طبق دستور، این مغایرت در همین
//     مرحله عمداً reconcile نشده.
// =========================================================================


import {
  estimateProductPackage,
  resolveEffectiveProfile,
  loadPackagingProfiles,
} from "./packaging-estimation.js";

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

  // weight_per_count = وزن خود کالا (بخش ۵ دستور)، مستقل از وزن بسته‌بندی.
  // اگر وزن پایه محصول ثبت نشده ولی Override کامل بسته‌بندی موجود است، از
  // وزن تخمینی بسته به‌عنوان Fallback صریح (نه صفر) استفاده می‌شود — این
  // مورد در متادیتای Quote (source) قابل ردیابی است.
  const weightPerCountGrams = isPositiveNumber(product.weight_grams)
    ? Math.round(Number(product.weight_grams))
    : Math.round(estimate.weightGrams);

  return {
    ok: true,
    productId,
    weightPerCountGrams,
    package: {
      lengthCm: Math.round(estimate.lengthCm),
      widthCm: Math.round(estimate.widthCm),
      heightCm: Math.round(estimate.heightCm),
      weightGrams: Math.round(estimate.weightGrams),
      source: estimate.source,
    },
  };
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

  // بدنه Quote — طبق بخش ۳ دستور، دقیقاً با نام فیلدهای رسمی Tapin (نه
  // نام‌های نادرست نسخه قبلی این فایل: count_per_discount/count_per_amount/
  // weight_package/type_pickup). شهر مقصد به‌صورت نام خام ارسال می‌شود؛
  // حل‌وفصل province/city همچنان سمت VPS/Proxy انجام می‌شود (بخش ۱۲ دستور:
  // Worker لیست/Endpoint شهر Tapin را مستقیماً صدا نمی‌زند).
  const quotePayload = {
    destination_city: quoteRequest.destinationCity,
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

  // بخش ۷/۲۷ دستور: مسیر اصلی Parse همان entries.total_send_price مستندشده
  // است. مسیرهای دیگر (cost/price_send_total) فقط Fallback عقب‌گرد برای
  // سازگاری با پاسخ فرضی نسخه قبلی این فایل‌اند و هرگز با یک Response واقعی
  // Tapin تأیید نشده‌اند — این هنوز هم صادقانه باید در گزارش تکرار شود، چون
  // این Sandbox امکان تماس شبکه واقعی با Proxy/Tapin را ندارد.
  const entries = responseData.entries || responseData;
  const totalSendPriceRial = entries?.total_send_price;
  const costToman =
    totalSendPriceRial != null
      ? Math.round(Number(totalSendPriceRial) / RIAL_PER_TOMAN)
      : responseData.cost != null
      ? Math.round(Number(responseData.cost))
      : Math.round((Number(responseData.price_send_total) || 0) / RIAL_PER_TOMAN);

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

export async function getShippingOptionsViaEngine(env, { cartItems, city, internalOptionsFn, productRows }) {
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
    const productMap = new Map((productRows || []).map((p) => [p.id, p]));
    const totalWeight = (cartItems || []).reduce((sum, item) => {
      const fromRow = productMap.get(item.productId)?.weight_grams;
      const weight = fromRow != null ? Number(fromRow) : Number(item.weightGrams) || 0;
      return sum + weight * (Number(item.quantity) || 1);
    }, 0);
    const totalValue = (cartItems || []).reduce(
      (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
      0
    );
    onlineResult = await quoteViaTapin(env, {
      destinationCity: city,
      items: cartItems || [],
      productRows: productRows || [],
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
