// =========================================================================
// تأسیسات آپادانا — سیستم هوشمند تخمین بسته‌بندی + تلرانس حمل
// =========================================================================
// این ماژول جایگزین resolveShippingOptionsForCart موجود در src/index.js
// نیست و آن را بازنویسی نمی‌کند. فقط یک لایه قبل از آن اضافه می‌کند:
//
//   Product Data → Packaging Estimation (همین فایل) → Chargeable Weight
//   → resolveShippingOptionsForCart موجود → Shipping Quote
//
// همه‌ی توابع محاسباتی این فایل عمداً «خالص» (بدون دسترسی مستقیم به DB)
// نوشته شده‌اند تا مستقل قابل تست باشند (بخش ۲۷ دستور). توابعی که به D1
// نیاز دارند (resolveProfileForProduct/loadPackagingContext) در انتهای
// فایل و کاملاً جدا از منطق محاسباتی قرار دارند.
// =========================================================================

// -------------------------------------------------------------------------
// Profile عمومی Fallback — فقط وقتی هیچ ردیفی در جدول packaging_profiles
// وجود ندارد (مثلاً Migration هنوز اجرا نشده) استفاده می‌شود، تا سیستم
// هرگز به‌خاطر نبود تنظیمات از کار نیفتد (بخش ۱۴ دستور: هیچ‌وقت صفر را
// اطلاعات معتبر حمل تلقی نکن). این اعداد فقط یک کف محافظه‌کارانه‌اند، نه
// حقیقت تجاری قطعی.
// -------------------------------------------------------------------------
export const BUILTIN_FALLBACK_PROFILE = Object.freeze({
  id: null,
  code: "BUILTIN_FALLBACK",
  name: "Fallback داخلی (بدون تنظیمات پنل)",
  length_tolerance_cm: 3,
  width_tolerance_cm: 3,
  height_tolerance_cm: 3,
  weight_tolerance_grams: 300,
  weight_tolerance_percent: 5,
  min_package_length_cm: 15,
  min_package_width_cm: 12,
  min_package_height_cm: 8,
  min_shipping_weight_grams: 300,
  protection_level: "standard",
  packaging_group: null,
  allow_combine_with_other_items: 1,
  require_separate_shipment: 0,
});

// ضریب وزن حجمی پیش‌فرض وقتی روش ارسال مقدار خودش را تنظیم نکرده — رایج‌ترین
// عدد بازار پستی/باربری داخلی ایران (cm³ به ازای هر کیلوگرم). این یک
// پیش‌فرض محافظه‌کارانه است، نه عدد قطعی هر سرویس حمل؛ از پنل «روش‌های
// ارسال» به‌ازای هر روش قابل بازنویسی است (بخش ۹ دستور).
export const DEFAULT_VOLUMETRIC_DIVISOR = 5000;

// -------------------------------------------------------------------------
// تخمین ابعاد/وزن «بسته‌بندی» یک ردیف محصول، بر اساس Profile انتخاب‌شده.
// -------------------------------------------------------------------------
//   product: { weight_grams, length_cm, width_cm, height_cm,
//              package_length_cm, package_width_cm, package_height_cm,
//              package_weight_grams, packaging_confidence }
//   profile: یکی از ردیف‌های packaging_profiles یا BUILTIN_FALLBACK_PROFILE
//
// خروجی: { lengthCm, widthCm, heightCm, weightGrams, source, incomplete }
//   source: 'REAL' | 'ESTIMATED' | 'CONSERVATIVE'  (بخش ۱۳ دستور)
//   incomplete: true اگر داده محصول ناقص بود و از کف محافظه‌کارانه استفاده شد
export function estimateProductPackage(product, profile) {
  const p = profile || BUILTIN_FALLBACK_PROFILE;

  // اولویت ۱: Override واقعی محصول — اگر مدیر بعداً ابعاد/وزن واقعی
  // بسته‌بندی را پیدا کرد، همان بر تخمین عمومی اولویت دارد (بخش ۱۲ دستور).
  const hasFullOverride =
    isPositiveNumber(product?.package_length_cm) &&
    isPositiveNumber(product?.package_width_cm) &&
    isPositiveNumber(product?.package_height_cm) &&
    isPositiveNumber(product?.package_weight_grams);

  if (hasFullOverride) {
    return {
      lengthCm: Number(product.package_length_cm),
      widthCm: Number(product.package_width_cm),
      heightCm: Number(product.package_height_cm),
      weightGrams: Math.round(Number(product.package_weight_grams)),
      source: product.packaging_confidence || "REAL",
      incomplete: false,
    };
  }

  const hasWeight = isPositiveNumber(product?.weight_grams);
  const hasDims =
    isPositiveNumber(product?.length_cm) &&
    isPositiveNumber(product?.width_cm) &&
    isPositiveNumber(product?.height_cm);

  if (hasWeight && hasDims) {
    // اعمال تلرانس (نه یک مقدار ثابت سراسری) + کنترل حداقل ابعاد بسته
    // (بخش ۶ و ۷ دستور): بسته کوچک‌تر از حداقل مجاز سرویس حمل نشود، اما
    // برای کالای بزرگ ابعاد واقعی+تلرانس حفظ شود (بزرگ‌تر از حداقل است).
    const lengthCm = Math.max(Number(product.length_cm) + p.length_tolerance_cm, p.min_package_length_cm);
    const widthCm = Math.max(Number(product.width_cm) + p.width_tolerance_cm, p.min_package_width_cm);
    const heightCm = Math.max(Number(product.height_cm) + p.height_tolerance_cm, p.min_package_height_cm);

    const weightWithTolerance =
      Number(product.weight_grams) + p.weight_tolerance_grams + (Number(product.weight_grams) * p.weight_tolerance_percent) / 100;
    const weightGrams = Math.max(Math.round(weightWithTolerance), p.min_shipping_weight_grams);

    return {
      lengthCm,
      widthCm,
      heightCm,
      weightGrams,
      source: "ESTIMATED",
      incomplete: false,
    };
  }

  // بخش ۱۴ دستور: اطلاعات ناقص → هرگز صفر؛ از حداقل ابعاد/وزن Profile
  // (یا وزن واقعی محصول در صورت وجود، هرکدام بزرگ‌تر بود) استفاده کن و
  // به مدیر اعلام کن که این عدد تخمینی محافظه‌کارانه است، نه دقیق.
  const conservativeWeight = Math.max(
    hasWeight ? Math.round(Number(product.weight_grams) + p.weight_tolerance_grams) : 0,
    p.min_shipping_weight_grams
  );

  return {
    lengthCm: p.min_package_length_cm,
    widthCm: p.min_package_width_cm,
    heightCm: p.min_package_height_cm,
    weightGrams: conservativeWeight,
    source: "CONSERVATIVE",
    incomplete: true,
  };
}

// وزن حجمی — استاندارد صنعت: (طول × عرض × ارتفاع بر سانتی‌متر) ÷ ضریب.
export function computeVolumetricWeightGrams(lengthCm, widthCm, heightCm, divisor) {
  const safeDivisor = isPositiveNumber(divisor) ? Number(divisor) : DEFAULT_VOLUMETRIC_DIVISOR;
  const volumeCm3 = Math.max(Number(lengthCm) || 0, 0) * Math.max(Number(widthCm) || 0, 0) * Math.max(Number(heightCm) || 0, 0);
  return Math.round((volumeCm3 / safeDivisor) * 1000);
}

// وزن قابل‌محاسبه = بزرگ‌تر از وزن واقعی/تخمینی و وزن حجمی (بخش ۹ دستور).
export function computeChargeableWeightGrams(actualOrEstimatedWeightGrams, volumetricWeightGrams) {
  return Math.max(Math.round(Number(actualOrEstimatedWeightGrams) || 0), Math.round(Number(volumetricWeightGrams) || 0));
}

// -------------------------------------------------------------------------
// بسته‌بندی سفارش چندقلمی (Shipment Packaging Estimate) — بخش ۱۰ دستور.
//
//   items: [{ productId, quantity, product, profile }]
//     - product: ردیف محصول (شامل ستون‌های وزن/ابعاد/Override بالا)
//     - profile: Packaging Profile مؤثر همان محصول (از پیش Resolve شده)
//   volumetricDivisor: ضریب وزن حجمی روش ارسال در حال بررسی
//
// خروجی: { packages: [...], totalChargeableWeightGrams, hasIncompleteData }
//   هر package: { kind: 'combined' | 'separate', productIds, weightGrams,
//                 volumetricWeightGrams, chargeableWeightGrams, sources }
//
// منطق: اقلامی که Profile‌شان allow_combine_with_other_items=1 دارد و
// require_separate_shipment=0 است، در «یک» بسته مشترک فرض می‌شوند (نه یک
// بسته مستقل به‌ازای هرکدام) — وزن‌ها جمع می‌شوند و حجم‌ها هم جمع می‌شوند
// (مثل قرار گرفتن چند قطعه کوچک در یک کارتن مشترک). اقلامی که ترکیب برایشان
// مجاز نیست یا Packaging Group مستقل/ارسال جداگانه دارند، هرکدام بسته
// مستقل خودشان را می‌گیرند. معماری این تابع طوری است که در آینده یک
// الگوریتم Packing دقیق‌تر (مثلاً بر اساس حجم واقعی کارتن) جای منطق جمع
// ساده را بگیرد، بدون تغییر در قرارداد ورودی/خروجی تابع (بخش ۱۰ دستور).
// -------------------------------------------------------------------------
// توجه معماری: این تابع عمداً از ضریب وزن حجمی (divisor) مستقل است — حجم
// خام (سانتی‌متر مکعب) هر بسته را برمی‌گرداند، نه وزن حجمی نهایی. چون ضریب
// وزن حجمی به هر روش ارسال وابسته است (بخش ۹ دستور) و چند روش ارسال ممکن
// است هم‌زمان برای یک سبد بررسی شوند، تخمین ابعاد/تلرانس (گران‌ترین بخش
// محاسبه) فقط یک‌بار انجام می‌شود؛ سپس chargeableWeightForDivisor برای هر
// روش ارسال به‌صورت ارزان وزن قابل‌محاسبه را با ضریب همان روش می‌سازد.
export function buildShipmentPackages(items) {
  const combinable = [];
  const separate = [];

  for (const entry of items || []) {
    const qty = Number(entry.quantity) > 0 ? Number(entry.quantity) : 1;
    const estimate = estimateProductPackage(entry.product, entry.profile);
    const profile = entry.profile || BUILTIN_FALLBACK_PROFILE;
    const lineWeightGrams = estimate.weightGrams * qty;
    const lineVolumeCm3 = Math.max(estimate.lengthCm, 0) * Math.max(estimate.widthCm, 0) * Math.max(estimate.heightCm, 0) * qty;

    const line = {
      productId: entry.productId,
      quantity: qty,
      weightGrams: lineWeightGrams,
      volumeCm3: lineVolumeCm3,
      source: estimate.source,
      incomplete: estimate.incomplete,
      separateShipment: !!Number(profile.require_separate_shipment),
    };

    const canCombine = !!Number(profile.allow_combine_with_other_items) && !Number(profile.require_separate_shipment);
    if (canCombine) {
      combinable.push(line);
    } else {
      separate.push(line);
    }
  }

  const packages = [];
  let hasIncompleteData = false;

  if (combinable.length > 0) {
    const weightGrams = combinable.reduce((sum, l) => sum + l.weightGrams, 0);
    const volumeCm3 = combinable.reduce((sum, l) => sum + l.volumeCm3, 0);
    hasIncompleteData = hasIncompleteData || combinable.some((l) => l.incomplete);
    packages.push({
      kind: "combined",
      productIds: combinable.map((l) => l.productId),
      weightGrams,
      volumeCm3,
      sources: combinable.map((l) => l.source),
    });
  }

  for (const line of separate) {
    hasIncompleteData = hasIncompleteData || line.incomplete;

    // اگر Profile صراحتاً ارسال جداگانه را الزام کرده باشد، هر واحد کالا
    // باید یک بسته مستقل داشته باشد. quantity نباید در یک بسته واحد تجمیع
    // شود؛ در غیر این صورت require_separate_shipment برای سفارش‌های چندعددی
    // عملاً نقض می‌شود. برای اقلامی که فقط غیرقابل‌تجمیع هستند اما
    // require_separate_shipment ندارند، رفتار قبلی حفظ می‌شود.
    if (line.separateShipment) {
      for (let unit = 0; unit < line.quantity; unit++) {
        packages.push({
          kind: "separate",
          productIds: [line.productId],
          weightGrams: line.weightGrams / line.quantity,
          volumeCm3: line.volumeCm3 / line.quantity,
          sources: [line.source],
          separateShipment: true,
        });
      }
      continue;
    }

    packages.push({
      kind: "separate",
      productIds: [line.productId],
      weightGrams: line.weightGrams,
      volumeCm3: line.volumeCm3,
      sources: [line.source],
      separateShipment: false,
    });
  }

  return { packages, hasIncompleteData };
}

// وزن قابل‌محاسبه کل سبد برای یک ضریب وزن حجمی مشخص (مثلاً ضریب یک روش
// ارسال خاص). هر بسته جداگانه Chargeable Weight خودش را می‌گیرد و در پایان
// جمع زده می‌شود — نه اینکه وزن‌های خام کل سبد یک‌جا با وزن حجمی کل سبد
// مقایسه شود (بسته‌های Separate نباید وزن حجمی بسته‌های دیگر را «قرض» بگیرند).
export function chargeableWeightForDivisor(packages, divisor) {
  return (packages || []).reduce((sum, pkg) => {
    const volumetricWeightGrams = Math.round((pkg.volumeCm3 / (isPositiveNumber(divisor) ? Number(divisor) : DEFAULT_VOLUMETRIC_DIVISOR)) * 1000);
    return sum + computeChargeableWeightGrams(pkg.weightGrams, volumetricWeightGrams);
  }, 0);
}

// -------------------------------------------------------------------------
// انتخاب خودکار Packaging Profile مؤثر یک محصول — بدون دخالت دستی مدیر
// (بخش ۲۳ دستور): اولویت ۱) Override دستی روی خود محصول، ۲) پیش‌فرض
// Shipping Class محصول، ۳) Profile عمومی سیستم (is_default=1 در D1)،
// ۴) BUILTIN_FALLBACK_PROFILE اگر هیچ‌کدام در D1 پیدا نشد.
// -------------------------------------------------------------------------
export function resolveEffectiveProfile(product, profilesById, defaultProfileIdOfClass) {
  if (product?.packaging_profile_id != null && profilesById.has(product.packaging_profile_id)) {
    return profilesById.get(product.packaging_profile_id);
  }
  if (defaultProfileIdOfClass != null && profilesById.has(defaultProfileIdOfClass)) {
    return profilesById.get(defaultProfileIdOfClass);
  }
  for (const profile of profilesById.values()) {
    if (Number(profile.is_default) === 1) return profile;
  }
  return BUILTIN_FALLBACK_PROFILE;
}

function isPositiveNumber(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
}

// =========================================================================
// توابع وابسته به D1 — عمداً جدا از منطق محاسباتی بالا (قابل تست مستقل).
// =========================================================================

// بارگذاری همه Profileها + نگاشت id→profile (یک‌بار در هر درخواست).
export async function loadPackagingProfiles(env) {
  try {
    const result = await env.DB
      .prepare("SELECT * FROM packaging_profiles WHERE active = 1 ORDER BY sort_order ASC, id ASC")
      .all();
    const rows = result.results || [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { rows, byId, available: true };
  } catch (error) {
    // Fail-Safe: اگر Migration هنوز اجرا نشده، سیستم به Profile عمومی
    // داخلی سقوط می‌کند (رفتار امروز دقیقاً حفظ می‌شود؛ بخش ۲۶ دستور).
    return { rows: [], byId: new Map(), available: false };
  }
}

// ساخت بسته‌های تخمینی سبد (بدون وابستگی به ضریب وزن حجمی یک روش خاص) —
// برای جایگزینی وزن خام در resolveShippingOptionsForCart. نتیجه با
// chargeableWeightForDivisor(packages, divisor) به وزن قابل‌محاسبه واقعی
// (وابسته به هر روش ارسال) تبدیل می‌شود. productRows باید شامل ستون‌های
// وزن/ابعاد/Override/شناسه Shipping Class و Packaging Profile باشد.
export async function buildCartShipmentPackages(env, { cartItems, productRows }) {
  const { byId: profilesById } = await loadPackagingProfiles(env);

  let classDefaults = new Map();
  try {
    const classIds = [...new Set(productRows.map((p) => p.shipping_class_id).filter((v) => v != null))];
    if (classIds.length > 0) {
      const placeholders = classIds.map(() => "?").join(",");
      const classResult = await env.DB
        .prepare(`SELECT id, default_packaging_profile_id FROM shipping_classes WHERE id IN (${placeholders})`)
        .bind(...classIds)
        .all();
      classDefaults = new Map((classResult.results || []).map((c) => [c.id, c.default_packaging_profile_id]));
    }
  } catch (error) {
    classDefaults = new Map();
  }

  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const items = (cartItems || [])
    .map((item) => {
      const product = productMap.get(item.productId);
      if (!product) return null;
      const defaultProfileId = classDefaults.get(product.shipping_class_id) ?? null;
      const profile = resolveEffectiveProfile(product, profilesById, defaultProfileId);
      return { productId: item.productId, quantity: item.quantity, product, profile };
    })
    .filter(Boolean);

  return buildShipmentPackages(items);
}
