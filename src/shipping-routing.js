// =========================================================================
// لایه Routing قطعی ارسال (مرحله ۲) — «صلاحیت و مسیر» قبل از هر Provider
// =========================================================================
// منبع تصمیم‌ها: «سند جمع‌بندی جلسه — تصمیمات نهایی معماری سیستم ارسال».
//
//   Product / Cart → Packaging & Shipping Data → Shipping Eligibility
//        → Destination / City Rule → Shipping Route
//
// خروجی این لایه فقط یکی از سه مسیر است:
//   isfahan_courier : مقصد = محدودهٔ رسمی شهر اصفهان → هر سبد/هر کالا → پیک موتوری رایگان
//   freight         : خارج اصفهان + سبد غیرعادی → باربری + پس‌کرایه (هرگز Tapin)
//   normal          : خارج اصفهان + سبد عادی → مسیر عادی (Tapin / موتور داخلی طبق mode)
//
// اصول:
//  ۱) تشخیص «غیرعادی» فقط از «داده» می‌آید (Shipping Class + Override مدیریتی)،
//     هرگز از موفقیت/شکست Provider و هرگز از نام محصول.
//  ۲) هیچ آستانهٔ عددی (وزن/ابعاد/قیمت) در این فایل وجود ندارد. در پروژه هم
//     چنین آستانه‌ای تصویب نشده است؛ مدیر با Shipping Class یا Override صریح
//     تعیین می‌کند. داده‌های مشکوک فقط «Flag» می‌شوند، نه Routing.
//  ۳) این ماژول به شبکه/Provider وابسته نیست (فقط خواندن D1) و Tapin را صدا نمی‌زند.
// =========================================================================

export const ROUTE_ISFAHAN_COURIER = "isfahan_courier";
export const ROUTE_FREIGHT = "freight";
export const ROUTE_NORMAL = "normal";

// شناسهٔ گزینه‌های مجازی (مثل "tapin"): ردیف shipping_methods نیستند.
export const ISFAHAN_COURIER_OPTION_ID = "isfahan_courier";
export const FREIGHT_OPTION_ID = "freight";

// ثابت‌های مصوب سند جلسه (نه آستانهٔ عددی جدید):
//   - فقط محدودهٔ رسمی شهر اصفهان مشمول پیک رایگان است؛
//   - حداکثر ۳ روز از تحویل سفارش به فروشگاه تا ارسال، برای همهٔ روش‌ها.
export const ROUTING_RULES = Object.freeze({
  official_city: "اصفهان",
  official_province: "اصفهان",
  max_dispatch_days: 3,
});

export const ROUTE_OVERRIDE_VALUES = Object.freeze(["normal", "freight"]);
export const ROUTE_POLICY_VALUES = Object.freeze(["normal", "freight"]);

export const MSG_MAX_DISPATCH = "سفارش شما حداکثر تا ۳ روز از فروشگاه ارسال می‌شود.";
export const CUSTOMER_MESSAGES = Object.freeze({
  isfahan_courier: `ارسال با پیک موتوری و رایگان است. ${MSG_MAX_DISPATCH}`,
  // پیام مصوب Freight (دقیقاً همین متن؛ بدون جملهٔ اضافه). سقف ۳ روز همچنان در فیلد max_dispatch_days گزینه می‌آید.
  freight: "این محصول به دلیل ابعاد یا وزن، توسط باربری و به‌صورت پس‌کرایه ارسال می‌شود.",
  normal: MSG_MAX_DISPATCH,
});

// --------------------------------------------------------------------------
// نرمال‌سازی متن فارسی (ي/ك عربی، نیم‌فاصله، فاصلهٔ اضافه)
// --------------------------------------------------------------------------
export function normalizeRoutingText(value) {
  return String(value ?? "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// «اصفهان» فقط یعنی خود شهر اصفهان. بهارستان/شاهین‌شهر/خمینی‌شهر/... اصفهان
// نیستند چون تطبیق «برابری دقیق نام شهر» است، نه شامل‌بودن یا هم‌استانی.
// اگر استان هم آمده باشد باید «اصفهان» باشد (برآورد صفحه محصول ممکن است
// فقط شهر بفرستد؛ نام شهر «اصفهان» در هیچ استان دیگری وجود ندارد).
export function isOfficialIsfahan(city, province) {
  if (normalizeRoutingText(city) !== ROUTING_RULES.official_city) return false;
  const p = normalizeRoutingText(province);
  return p === "" || p === ROUTING_RULES.official_province;
}

// --------------------------------------------------------------------------
// طبقه‌بندی یک محصول: عادی / غیرعادی (Deterministic، بدون آستانهٔ عددی)
//   اولویت: Override مدیریتی محصول > route_policy کلاس حمل > پیش‌فرض عادی
// --------------------------------------------------------------------------
export function classifyProduct(product, shippingClass) {
  if (!product) return { abnormal: false, reason: "PRODUCT_NOT_FOUND" };

  const override = product.shipping_route_override;
  if (override === "freight") return { abnormal: true, reason: "PRODUCT_OVERRIDE_FREIGHT" };
  if (override === "normal") return { abnormal: false, reason: "PRODUCT_OVERRIDE_NORMAL" };

  if (shippingClass && shippingClass.route_policy === "freight") {
    return { abnormal: true, reason: "CLASS_FREIGHT" };
  }
  return { abnormal: false, reason: shippingClass ? "CLASS_NORMAL" : "NO_CLASS_DEFAULT_NORMAL" };
}

// --------------------------------------------------------------------------
// تصمیم مسیر برای کل سبد (Basket-level؛ بدون Split Shipment)
//   محصول غیرعادی = کل سبد غیرعادی. داخل اصفهان همه چیز پیک رایگان است.
// --------------------------------------------------------------------------
export function decideRoute({ city, province, productIds, productMap, classMap }) {
  const items = (productIds || []).map((id) => {
    const product = productMap.get(Number(id));
    const klass = product?.shipping_class_id != null ? classMap.get(Number(product.shipping_class_id)) : null;
    return { product_id: Number(id), ...classifyProduct(product, klass) };
  });
  const abnormalItems = items.filter((i) => i.abnormal);
  const abnormalBasket = abnormalItems.length > 0;

  if (isOfficialIsfahan(city, province)) {
    // داخل محدوده رسمی: مستقل از وزن/حجم/قیمت/کلاس → پیک رایگان.
    return { route: ROUTE_ISFAHAN_COURIER, basket_abnormal: abnormalBasket, items, reason: "OFFICIAL_ISFAHAN" };
  }
  if (abnormalBasket) {
    return { route: ROUTE_FREIGHT, basket_abnormal: true, items, reason: abnormalItems[0].reason };
  }
  return { route: ROUTE_NORMAL, basket_abnormal: false, items, reason: "NORMAL_BASKET" };
}

// --------------------------------------------------------------------------
// گزینه‌های مجازی (ساختار هم‌شکل گزینه‌های موجود + فیلدهای تفکیک پرداخت)
//   payment_mode: free | prepaid | receiver_pays  — «رایگان» با «پس‌کرایه»
//   فقط با cost=0 از هم تفکیک نمی‌شوند.
// --------------------------------------------------------------------------
export function buildIsfahanCourierOption() {
  return {
    id: ISFAHAN_COURIER_OPTION_ID,
    name: "پیک موتوری",
    cost: 0,
    cost_type: "prepaid",
    payment_mode: "free",
    cost_known: true,
    scope: "route",
    source: "routing",
    route: ROUTE_ISFAHAN_COURIER,
    max_dispatch_days: ROUTING_RULES.max_dispatch_days,
    customer_message: CUSTOMER_MESSAGES.isfahan_courier,
  };
}

export function buildFreightOption() {
  return {
    id: FREIGHT_OPTION_ID,
    name: "باربری (پس‌کرایه)",
    cost: 0, // «نامشخص/پرداخت هنگام تحویل» است، نه «رایگان»؛ تفکیک با payment_mode + cost_type.
    cost_type: "cod",
    payment_mode: "receiver_pays",
    cost_known: false,
    scope: "route",
    source: "routing",
    route: ROUTE_FREIGHT,
    max_dispatch_days: ROUTING_RULES.max_dispatch_days,
    customer_message: CUSTOMER_MESSAGES.freight,
  };
}

// گزینه‌های مسیر عادی (Tapin/موتور داخلی) هم همان قاعده‌ٔ ۳ روز و تفکیک پرداخت را می‌گیرند.
export function decorateNormalOption(option) {
  const isCod = option.cost_type === "cod";
  return {
    ...option,
    payment_mode: isCod ? "receiver_pays" : "prepaid",
    cost_known: option.cost_known !== false,
    route: ROUTE_NORMAL,
    max_dispatch_days: ROUTING_RULES.max_dispatch_days,
    customer_message: CUSTOMER_MESSAGES.normal,
  };
}

export const ROUTED_OPTION_IDS = Object.freeze([ISFAHAN_COURIER_OPTION_ID, FREIGHT_OPTION_ID]);

// --------------------------------------------------------------------------
// بارگذاری دادهٔ Routing از D1 (مستقل از productRows ورودی؛ Fail-Safe)
//   اگر Migration هنوز اجرا نشده باشد، ستون‌های جدید وجود ندارند: همه چیز
//   «عادی» می‌شود (رفتار قبلی) و routing_data_available=false گزارش می‌شود.
// --------------------------------------------------------------------------
export async function loadRoutingData(env, productIds) {
  const ids = [...new Set((productIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = { productMap: new Map(), classMap: new Map(), available: true };
  if (ids.length === 0) return out;

  const placeholders = ids.map(() => "?").join(",");
  try {
    const result = await env.DB
      .prepare(`SELECT id, shipping_class_id, shipping_route_override FROM products WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all();
    for (const row of result.results || []) out.productMap.set(Number(row.id), row);
  } catch (error) {
    out.available = false;
    try {
      const legacy = await env.DB
        .prepare(`SELECT id, shipping_class_id FROM products WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all();
      for (const row of legacy.results || []) out.productMap.set(Number(row.id), row);
    } catch (legacyError) {
      // محصولات خوانده نشد → همه «عادی» (PRODUCT_NOT_FOUND)
    }
  }

  try {
    const classes = await env.DB.prepare("SELECT id, name, route_policy FROM shipping_classes").all();
    for (const row of classes.results || []) out.classMap.set(Number(row.id), row);
  } catch (error) {
    out.available = false;
  }
  return out;
}

export async function resolveShippingRoute(env, { cartItems, city, province }) {
  const productIds = (cartItems || [])
    .map((item) => Number(typeof item === "object" && item !== null ? item.productId ?? item.id : item))
    .filter((n) => Number.isInteger(n) && n > 0);
  const data = await loadRoutingData(env, productIds);
  const decision = decideRoute({ city, province, productIds: [...new Set(productIds)], productMap: data.productMap, classMap: data.classMap });
  return { ...decision, routing_data_available: data.available };
}

// --------------------------------------------------------------------------
// Flag داده‌های مشکوک برای بررسی مدیر — هیچ‌وقت Routing را تغییر نمی‌دهد.
// فقط مقایسهٔ منطقیِ داده‌ها با هم (بدون عدد ثابت):
// --------------------------------------------------------------------------
const positive = (v) => v != null && v !== "" && Number(v) > 0;

export function detectShippingDataSuspicions(product, { shippingClass = null, effectiveProfile = null, route = null } = {}) {
  const flags = [];
  const p = product || {};

  if (p.shipping_class_id == null) flags.push("NO_SHIPPING_CLASS");
  if (!positive(p.weight_grams)) flags.push("MISSING_WEIGHT");
  const dims = [p.length_cm, p.width_cm, p.height_cm];
  if (!dims.every(positive)) flags.push("MISSING_DIMENSIONS");

  const pkgDims = [p.package_length_cm, p.package_width_cm, p.package_height_cm];
  const pkgPresent = pkgDims.filter(positive).length;
  if (pkgPresent > 0 && pkgPresent < 3) flags.push("PACKAGE_DIMENSIONS_INCOMPLETE");

  if (positive(p.weight_grams) && positive(p.package_weight_grams) && Number(p.package_weight_grams) < Number(p.weight_grams)) {
    flags.push("PACKAGE_WEIGHT_BELOW_PRODUCT_WEIGHT");
  }
  if (dims.every(positive) && pkgDims.every(positive)) {
    const a = dims.map(Number).sort((x, y) => x - y);
    const b = pkgDims.map(Number).sort((x, y) => x - y);
    if (b.some((v, i) => v < a[i])) flags.push("PACKAGE_SMALLER_THAN_PRODUCT");
  }

  // پروفایل بسته‌بندی «ارسال جداگانه/گروه bulky» دارد ولی مسیر عادی است → ناسازگاری.
  const onNormalRoute = route == null || route === ROUTE_NORMAL;
  if (
    onNormalRoute &&
    effectiveProfile &&
    (Number(effectiveProfile.require_separate_shipment) === 1 || effectiveProfile.packaging_group) &&
    !(shippingClass && shippingClass.route_policy === "freight") &&
    p.shipping_route_override !== "freight"
  ) {
    flags.push("PROFILE_SUGGESTS_BULKY_BUT_ROUTE_NORMAL");
  }
  return flags;
}

export const SUSPICION_LABELS_FA = Object.freeze({
  NO_SHIPPING_CLASS: "Shipping Class ندارد",
  MISSING_WEIGHT: "وزن ثبت نشده",
  MISSING_DIMENSIONS: "ابعاد کامل ثبت نشده",
  PACKAGE_DIMENSIONS_INCOMPLETE: "ابعاد بسته‌بندی ناقص است",
  PACKAGE_WEIGHT_BELOW_PRODUCT_WEIGHT: "وزن بسته‌بندی کمتر از وزن محصول است",
  PACKAGE_SMALLER_THAN_PRODUCT: "ابعاد بسته‌بندی کوچک‌تر از ابعاد محصول است",
  PROFILE_SUGGESTS_BULKY_BUT_ROUTE_NORMAL: "Packaging Profile حجیم/ارسال جداگانه دارد ولی مسیر «عادی» است",
});

export const ROUTE_REASON_LABELS_FA = Object.freeze({
  OFFICIAL_ISFAHAN: "مقصد داخل محدودهٔ رسمی شهر اصفهان",
  PRODUCT_OVERRIDE_FREIGHT: "Override مدیریتی محصول: باربری",
  PRODUCT_OVERRIDE_NORMAL: "Override مدیریتی محصول: عادی",
  CLASS_FREIGHT: "Shipping Class محصول: باربری/حجیم",
  CLASS_NORMAL: "Shipping Class محصول: عادی",
  NO_CLASS_DEFAULT_NORMAL: "بدون Shipping Class — پیش‌فرض عادی",
  PRODUCT_NOT_FOUND: "محصول پیدا نشد",
  NORMAL_BASKET: "سبد عادی",
});
