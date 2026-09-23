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
// وضعیت این مرحله (صادقانه، طبق قانون بخش ۴۳):
//   - رجیستری Provider، نسخه‌بندی/Import تعرفه، تاریخچه Quote: کامل پیاده و تست‌شده.
//   - Tapin Adapter: فقط Skeleton/Interface آماده اتصال است. هیچ Endpoint یا
//     Request/Response واقعی پیاده نشده، چون مستندات فنی API واقعی تاپین
//     (Endpoint/Auth/Schema) در این مرحله در دسترس قرار نگرفت — صفحه مستندات
//     وب‌سرویس تاپین اجازه دسترسی خودکار نمی‌دهد و هیچ منبع دیگری با جزئیات
//     فنی واقعی (نه فقط تبلیغاتی) پیدا نشد. طبق دستور صریح («اگر اطلاعات لازم
//     در مستندات موجود نیست، حدس نزن»)، به‌جای Endpoint ساختگی، این تابع
//     همیشه یک خطای صریح PROVIDER_NOT_IMPLEMENTED برمی‌گرداند تا زمانی‌که
//     مستندات واقعی (یا حساب آزمایشی Tapin) در اختیار قرار گیرد.
//   - اتصال زنده Cart/Checkout مشتری به این Engine (به‌جای فراخوانی مستقیم
//     resolveShippingOptionsForCart): در این مرحله انجام نشد — چون تا وقتی
//     Tapin واقعاً کار نمی‌کند، این کار فقط ریسک تغییر رفتار Checkout زنده
//     را اضافه می‌کند بدون فایده واقعی. به‌جایش یک Endpoint مستقل Admin
//     («engine-preview») اضافه شده که همین Orchestration را بدون اثر روی
//     مشتری واقعی قابل تست می‌کند. طبق دستور بخش ۱۷ («اگر پیاده‌سازی کامل
//     UI/اتصال در این مرحله بیش از حد است، حداقل Backend را آماده کن»).
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
// Tapin Adapter — Skeleton آماده اتصال. عمداً هیچ HTTP call واقعی ندارد.
// -------------------------------------------------------------------------

export async function quoteViaTapin(env, quoteRequest) {
  // quoteRequest مورد انتظار (برای وقتی مستندات واقعی در دسترس قرار گرفت):
  //   { origin, destinationProvince, destinationCity, destinationPostalCode,
  //     weightGrams, quantity, cartValue, dimensions?: {length_cm,width_cm,height_cm} }
  //
  // env.TAPIN_API_KEY / env.TAPIN_BASE_URL از Worker Secrets خوانده می‌شوند
  // (هرگز Hard-code یا در D1 ذخیره نمی‌شوند). اگر تنظیم نشده باشند یا
  // مستندات واقعی هنوز پیاده نشده باشد، خروجی همیشه این است:
  return {
    ok: false,
    provider: "tapin",
    error: "PROVIDER_NOT_IMPLEMENTED",
    message: "اتصال واقعی به Tapin هنوز پیاده‌سازی نشده (نیاز به مستندات API واقعی و Credential). فقط Skeleton آماده اتصال است.",
    available: false,
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
    });
    await recordShippingQuote(env, {
      provider_code: "tapin",
      destination_city: city,
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
