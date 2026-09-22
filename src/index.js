// =========================================================================
// تأسیسات آپادانا — Worker API
// شامل: محصولات، سفارش واقعی (Checkout)، پیگیری مهمان، حساب مشتری، پنل مدیریت
// =========================================================================

const STATUS_LABELS = {
  pending: "در حال بررسی",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال شده",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
};

const ALLOWED_STATUSES = Object.keys(STATUS_LABELS);

const PAYMENT_STATUS_LABELS = {
  unpaid: "پرداخت‌نشده",
  paid: "پرداخت‌شده",
  failed: "پرداخت ناموفق",
  refunded: "بازگشت وجه",
};

const ALLOWED_PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS);

// =========================================================================
// پیش‌فرض‌های سراسری ارسال — وقتی محصولی مقدار shipping_* خودش را ندارد
// (NULL در D1)، از همین مقادیر استفاده می‌شود. تغییر این‌ها فقط روی
// محصولاتی اثر دارد که خودشان override ندارند.
// =========================================================================
const STORE_DEFAULT_SHIPPING_COST = 0; // پیش‌فرض: ارسال رایگان
const STORE_DEFAULT_SHIPPING_METHOD = "پست پیشتاز";
const STORE_DEFAULT_SHIPPING_TIME = "حداکثر ۳ روز کاری";
const STORE_BASE_URL = "https://tasisatapadanaesfahan.ir";

function resolveShippingInfo(product) {
  return {
    shipping_cost: product.shipping_cost != null ? Number(product.shipping_cost) : STORE_DEFAULT_SHIPPING_COST,
    shipping_method: product.shipping_method || STORE_DEFAULT_SHIPPING_METHOD,
    shipping_time: product.shipping_time || STORE_DEFAULT_SHIPPING_TIME,
  };
}

// =========================================================================
// مدیریت بسیار دقیق تومان/ریال — منبع واحد تبدیل واحد پول در کل پروژه.
// قیمت‌ها همیشه در D1 و در نمایش به مشتری به «تومان» هستند. هر مبلغی که
// قرار است به درگاه پرداخت ارسال شود، باید دقیقاً و فقط یک‌بار از این
// تابع عبور کند. هرگز خروجی این تابع را دوباره به این تابع ندهید
// (جلوگیری از تبدیل دوباره مبلغی که قبلاً به ریال تبدیل شده).
// =========================================================================
const TOMAN_TO_RIAL_MULTIPLIER = 10;

function tomanToRial(tomanAmount) {
  const amount = Number(tomanAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("INVALID_TOMAN_AMOUNT");
  }
  return Math.round(amount) * TOMAN_TO_RIAL_MULTIPLIER;
}

function rialToToman(rialAmount) {
  const amount = Number(rialAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("INVALID_RIAL_AMOUNT");
  }
  return Math.round(amount / TOMAN_TO_RIAL_MULTIPLIER);
}

// =========================================================================
// استانداردسازی دائمی علائم و واحدهای فنی (لایه نمایش، بدون تغییر داده خام)
// =========================================================================
// قوانین از جدول D1 «technical_format_rules» خوانده می‌شوند (کش سبک در
// حافظه هر ایزوله، ۶۰ ثانیه) و هرگز مقدار خام محصول در دیتابیس را تغییر
// نمی‌دهند؛ فقط متنی که در پاسخ API/SSR فرستاده می‌شود را فرمت می‌کنند.
// یک قانون خراب فقط همان قانون را نادیده می‌گیرد، هرگز کل صفحه را خراب نمی‌کند.
let _technicalFormatRulesCache = null;
let _technicalFormatRulesCacheAt = 0;
const TECHNICAL_FORMAT_RULES_CACHE_TTL_MS = 60 * 1000;

async function getTechnicalFormatRules(env) {
  const now = Date.now();
  if (_technicalFormatRulesCache && now - _technicalFormatRulesCacheAt < TECHNICAL_FORMAT_RULES_CACHE_TTL_MS) {
    return _technicalFormatRulesCache;
  }

  try {
    const result = await env.DB
      .prepare(
        "SELECT id, rule_type, match_value, display_value FROM technical_format_rules " +
        "WHERE active = 1 ORDER BY sort_order ASC, id ASC"
      )
      .all();

    _technicalFormatRulesCache = result.results || [];
    _technicalFormatRulesCacheAt = now;
    return _technicalFormatRulesCache;
  } catch (error) {
    // Fail-Safe: اگر جدول هنوز Migrate نشده یا خطای دیگری رخ دهد، هیچ
    // فرمتی اعمال نمی‌شود (متن خام دقیقاً مثل قبل نمایش داده می‌شود)،
    // هرگز کل درخواست را خراب نمی‌کند.
    console.error("[technical-format] خواندن قوانین ممکن نشد:", error.message);
    return [];
  }
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTechnicalText(text, rules) {
  if (text == null || typeof text !== "string" || !Array.isArray(rules) || rules.length === 0) {
    return text;
  }

  let output = text;
  for (const rule of rules) {
    try {
      const escapedValue = escapeRegexLiteral(rule.match_value);
      if (rule.rule_type === "unit") {
        // فقط وقتی عدد بلافاصله قبل از واحد بیاید جایگزین می‌شود (مثال:
        // «60 C» یا «60C» → «60 °C»)؛ هرگز حرف/واحد را جدا از یک عدد
        // جایگزین نمی‌کند تا از تبدیل حدسی/نادرست جلوگیری شود.
        const re = new RegExp("(\\d+(?:[.,]\\d+)?)\\s?" + escapedValue + "\\b", "g");
        output = output.replace(re, (_match, num) => `${num} ${rule.display_value}`);
      } else {
        // token: جایگزینی دقیق یک نماد مستقل با مرز کلمه (مثال: Qn → Qₙ)
        const re = new RegExp("\\b" + escapedValue + "\\b", "g");
        output = output.replace(re, rule.display_value);
      }
    } catch (error) {
      console.error("[technical-format] قانون نادیده گرفته شد:", rule.id, error.message);
    }
  }
  return output;
}

// یک محصول (و مشخصات فنی آن) را طبق قوانین فعلی فرمت می‌کند. ایمن است
// حتی اگر specs وجود نداشته باشد یا rules خالی باشد.
function applyTechnicalFormattingToProduct(product, rules) {
  if (!product || !Array.isArray(rules) || rules.length === 0) return product;

  if (product.description != null) product.description = formatTechnicalText(product.description, rules);
  if (product.brand != null) product.brand = formatTechnicalText(product.brand, rules);
  if (product.model != null) product.model = formatTechnicalText(product.model, rules);

  if (Array.isArray(product.specs)) {
    product.specs = product.specs.map((spec) => ({
      ...spec,
      label: formatTechnicalText(spec.label, rules),
      value: formatTechnicalText(spec.value, rules),
    }));
  }

  return product;
}

// معرفی محصول (description) به‌صورت HTML ساده (تیتر/پاراگراف/بولد/لیست/لینک)
// از پنل مدیریت ذخیره می‌شود. این تابع قبل از INSERT/UPDATE، تگ/ویژگی خطرناک
// را حذف می‌کند تا مقدار ذخیره‌شده در D1 از همان ابتدا امن باشد و صفحه
// محصول عمومی بتواند بدون escape مجدد، مستقیماً آن را رندر کند.
function sanitizeDescriptionHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
}

// این تابع منبع واحد محاسبه وضعیت موجودی/تخفیف/ارسال/گارانتی است — هم
// endpoint عمومی JSON و هم صفحه SSR محصول از همین استفاده می‌کنند تا هیچ‌وقت
// Schema.org با آنچه واقعاً در صفحه دیده می‌شود اختلاف نداشته باشد.
function buildProductViewModel(product) {
  const shipping = resolveShippingInfo(product);
  const price = Number(product.price) || 0;
  const compareAtPrice = product.compare_at_price != null ? Number(product.compare_at_price) : null;
  const discountActive = compareAtPrice != null && compareAtPrice > price;
  const inStock = Number(product.stock) > 0;

  return {
    ...product,
    in_stock: inStock,
    discount_active: discountActive,
    discount_percent: discountActive ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100) : null,
    ...shipping,
    has_warranty: !!(product.warranty_months && Number(product.warranty_months) > 0),
    has_return_policy: !!(product.return_days && Number(product.return_days) > 0),
    canonical_url: `${STORE_BASE_URL}/store/product/${encodeURIComponent(product.slug)}`,
  };
}

const TICKET_STATUS_LABELS = {
  received: "ثبت شده",
  in_review: "در حال بررسی",
  answered: "پاسخ داده شد",
  closed: "بسته شد",
};

const ALLOWED_TICKET_STATUSES = Object.keys(TICKET_STATUS_LABELS);

// =========================================================================
// SMS Template Registry (مرکزی)
// این تنها محل مجاز برای نگهداری Template IDهای SMS.ir در کل پروژه است.
// مقدار null یعنی: این رویداد هنوز در پنل SMS.ir قالب تأییدشده ندارد؛
// Central SMS Service (تابع sendSms) در این حالت هرگز درخواست واقعی به
// SMS.ir نمی‌زند و فقط با status='skipped_no_template' در sms_messages
// ثبت می‌کند. این جلوی ارسال با template ID ساختگی را می‌گیرد.
// =========================================================================
// SMS Template Registry (مرکزی)
// این تنها محل مجاز برای نگهداری Template IDهای SMS.ir در کل پروژه است.
// هر ۲۴ Template زیر واقعی و تأییدشده در پنل SMS.ir هستند (هیچ ID ساختگی
// اضافه نشده). templateId هرگز نباید در جای دیگری از پروژه hard-code شود.
//
// enabled=false در اینجا یعنی: پیش‌فرض کد. مدیر می‌تواند از پنل مدیریت این
// مقدار (و حتی خود templateId) را per-event override کند — آن override در
// جدول D1 «sms_template_settings» ذخیره می‌شود (نه در همین فایل)، تا تغییر
// یک قالب نیازمند ویرایش کد/دیپلوی نباشد. تابع getEffectiveTemplate همیشه
// این Registry پایه را با override موجود در D1 ترکیب می‌کند.
// =========================================================================
const SMS_CATEGORY_LABELS = {
  AUTH: "احراز هویت",
  ORDER: "سفارش‌ها",
  SUPPORT: "پشتیبانی",
  SERVICE: "خدمات فنی",
  REMINDER: "یادآوری‌ها",
};

const SMS_TEMPLATE_REGISTRY = {
  // --- احراز هویت مشتری (فعال و متصل — OTP Engine) ---
  AUTH_VERIFY: {
    templateId: 222638, title: "تأیید شماره / ثبت‌نام", category: "AUTH",
    variables: ["CODE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "کد تأیید شماره موبایل هنگام ثبت‌نام.",
  },
  AUTH_LOGIN_OTP: {
    templateId: 483547, title: "ورود با کد یکبار مصرف", category: "AUTH",
    variables: ["CODE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "کد ورود بدون رمز عبور (OTP Login).",
  },
  AUTH_PASSWORD_RESET: {
    templateId: 916162, title: "بازیابی رمز عبور", category: "AUTH",
    variables: ["CODE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "کد بازیابی رمز عبور فراموش‌شده.",
  },
  AUTH_PHONE_CHANGE: {
    templateId: 208162, title: "تغییر شماره موبایل", category: "AUTH",
    variables: ["CODE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "کد تأیید شماره موبایل جدید هنگام تغییر شماره حساب.",
  },

  // --- سفارش ---
  ORDER_CREATED: {
    templateId: 499473, title: "ثبت سفارش جدید", category: "ORDER",
    variables: ["ORDER_ID", "AMOUNT"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "تأیید ثبت سفارش برای مشتری.",
  },
  ORDER_CONFIRMED: {
    templateId: 918848, title: "تأیید سفارش", category: "ORDER",
    variables: ["ORDER_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش توسط فروشگاه تأیید شد.",
  },
  ORDER_PREPARING: {
    templateId: 845757, title: "آماده‌سازی سفارش", category: "ORDER",
    variables: ["ORDER_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش در حال آماده‌سازی است.",
  },
  ORDER_SHIPPED: {
    templateId: 757424, title: "ارسال سفارش (با کد رهگیری)", category: "ORDER",
    variables: ["ORDER_ID", "CARRIER", "TRACKING_CODE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش ارسال شد و کد رهگیری پستی موجود است.",
  },
  ORDER_SHIPPED_NO_TRACKING: {
    templateId: 785278, title: "ارسال سفارش (بدون کد رهگیری)", category: "ORDER",
    variables: ["ORDER_ID", "CARRIER"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش ارسال شد ولی هنوز کد رهگیری ثبت نشده است.",
  },
  ORDER_DELIVERED: {
    templateId: 163605, title: "تحویل سفارش", category: "ORDER",
    variables: ["ORDER_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش با موفقیت تحویل داده شد.",
  },
  ORDER_CANCELLED: {
    templateId: 127393, title: "لغو سفارش", category: "ORDER",
    variables: ["ORDER_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش لغو شد.",
  },
  ORDER_PROBLEM: {
    templateId: 339384, title: "مشکل در سفارش", category: "ORDER",
    variables: ["ORDER_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "سفارش با مشکل مواجه شده و نیاز به پیگیری دارد.",
  },

  // --- پشتیبانی ---
  SUPPORT_TICKET_CREATED: {
    templateId: 564607, title: "ثبت تیکت پشتیبانی", category: "SUPPORT",
    variables: ["TICKET_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "تیکت پشتیبانی با موفقیت ثبت شد.",
  },
  SUPPORT_TICKET_REPLY: {
    templateId: 814120, title: "پاسخ به تیکت", category: "SUPPORT",
    variables: ["TICKET_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "پاسخ جدیدی به تیکت پشتیبانی داده شد.",
  },
  SUPPORT_TICKET_STATUS: {
    templateId: 164557, title: "تغییر وضعیت تیکت", category: "SUPPORT",
    variables: ["TICKET_ID", "STATUS"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "وضعیت تیکت پشتیبانی تغییر کرد.",
  },
  SUPPORT_TICKET_CLOSED: {
    templateId: 165150, title: "بسته‌شدن تیکت", category: "SUPPORT",
    variables: ["TICKET_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "تیکت پشتیبانی بسته شد.",
  },

  // --- خدمات فنی — Registry آماده است؛ سیستم خدمات فنی هنوز در پروژه
  // پیاده‌سازی نشده، پس هیچ Trigger واقعی به این Templateها وصل نیست. ---
  SERVICE_REQUEST_CREATED: {
    templateId: 896059, title: "ثبت درخواست خدمات", category: "SERVICE",
    variables: ["REQUEST_ID", "SERVICE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "درخواست خدمات فنی ثبت شد.",
  },
  SERVICE_CONFIRMED: {
    templateId: 695783, title: "تأیید درخواست خدمات", category: "SERVICE",
    variables: ["REQUEST_ID", "SERVICE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "درخواست خدمات فنی تأیید شد.",
  },
  SERVICE_APPOINTMENT: {
    templateId: 484246, title: "تعیین زمان مراجعه", category: "SERVICE",
    variables: ["REQUEST_ID", "DATE", "TIME"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "زمان مراجعه تکنسین تعیین شد.",
  },
  SERVICE_REMINDER: {
    templateId: 462311, title: "یادآوری نوبت خدمات", category: "SERVICE",
    variables: ["REQUEST_ID", "DATE", "TIME"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "یادآوری نوبت مراجعه خدمات فنی.",
  },
  SERVICE_TECHNICIAN_DISPATCH: {
    templateId: 497649, title: "اعزام تکنسین", category: "SERVICE",
    variables: ["REQUEST_ID", "SERVICE"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "تکنسین برای انجام خدمات اعزام شد.",
  },
  SERVICE_COMPLETED: {
    templateId: 308815, title: "پایان خدمات", category: "SERVICE",
    variables: ["REQUEST_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "خدمات فنی با موفقیت انجام شد.",
  },
  SERVICE_INVOICE_READY: {
    templateId: 918690, title: "آماده‌شدن فاکتور خدمات", category: "SERVICE",
    variables: ["REQUEST_ID"], enabled: true, allowManualSend: true, allowCampaign: false,
    description: "فاکتور خدمات فنی آماده شد.",
  },

  // --- یادآوری دوره‌ای ---
  BOILER_ANNUAL_SERVICE: {
    templateId: 745468, title: "یادآوری سرویس سالانه پکیج", category: "REMINDER",
    variables: ["NAME"], enabled: true, allowManualSend: true, allowCampaign: true,
    description: "یادآوری سالانه سرویس پکیج؛ NAME از نام مشتری در D1 پر می‌شود.",
  },
};

// انواع purpose مجاز برای OTP Engine (بخش ۱۰ تا ۱۳) و eventType متناظر هرکدام
// در Template Registry — این تنها محل نگاشت purpose → template است.
const OTP_PURPOSES = ["register", "login", "password_reset", "phone_change"];

const OTP_PURPOSE_EVENT_TYPES = {
  register: "AUTH_VERIFY",
  login: "AUTH_LOGIN_OTP",
  password_reset: "AUTH_PASSWORD_RESET",
  phone_change: "AUTH_PHONE_CHANGE",
};

// وضعیت سفارش → Event پیامکی متناظر (بخش ۱۹ دستور). "shipped" جدا مدیریت
// می‌شود چون بسته به وجود کد رهگیری، یکی از دو Template متفاوت را می‌گیرد.
// "pending" عمداً نگاشت ندارد (پیامک ثبت سفارش همان لحظه ایجاد سفارش با
// ORDER_CREATED ارسال می‌شود، نه اینجا).
const ORDER_STATUS_SMS_EVENT_MAP = {
  confirmed: "ORDER_CONFIRMED",
  preparing: "ORDER_PREPARING",
  completed: "ORDER_DELIVERED",
  cancelled: "ORDER_CANCELLED",
};

// این دو purpose نباید فاش کنند شماره موبایل در سیستم وجود دارد یا نه
// (بخش ۷/۱۲ — enumeration protection برای login و forgot-password).
const OTP_ENUMERATION_SAFE_PURPOSES = ["login", "password_reset"];

const OTP_CODE_TTL_SECONDS = 5 * 60; // اعتبار کد: ۵ دقیقه
const OTP_RESEND_COOLDOWN_SECONDS = 90; // حداقل فاصله بین دو ارسال برای همان mobile+purpose
const OTP_MAX_VERIFY_ATTEMPTS = 5; // حداکثر تلاش اشتباه برای یک کد
const OTP_MAX_REQUESTS_PER_HOUR = 5; // حداکثر تعداد درخواست کد در هر ساعت برای همان mobile+purpose

// کد پیگیری: حروف/ارقامی که با هم اشتباه گرفته می‌شوند (0/O، 1/I/L) حذف شده‌اند.
const TRACKING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TRACKING_CODE_LENGTH = 10;

const SESSION_COOKIE_NAME = "apadana_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // ۳۰ روز

async function handleStoreApi(request, env) {
  const url = new URL(request.url);

  // =========================
  // Helpers — Auth
  // =========================

  function isAdmin(request, env) {
    const token = request.headers.get("X-Admin-Token");
    return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
  }

  // =========================
  // Helpers — Data
  // =========================

  async function getProductImages(productId) {
    const result = await env.DB
      .prepare(
        "SELECT id, image, alt, sort_order " +
        "FROM product_images " +
        "WHERE product_id = ? " +
        "ORDER BY sort_order ASC, id ASC"
      )
      .bind(productId)
      .all();

    return result.results || [];
  }

  async function getProductSpecs(productId) {
    const result = await env.DB
      .prepare(
        "SELECT id, label, value, sort_order " +
        "FROM product_specs " +
        "WHERE product_id = ? " +
        "ORDER BY sort_order ASC, id ASC"
      )
      .bind(productId)
      .all();

    return result.results || [];
  }

  // =========================================================================
  // Helpers — دسته‌بندی، روابط محصول، «همراه این محصول خریده‌اند»، پرچم‌های
  // نمایش عمومی. همه به‌صورت additive و مستقل از منطق فعلی محصول/سبد/سفارش.
  // =========================================================================

  async function getCategoriesFlat() {
    const result = await env.DB
      .prepare(
        "SELECT id, name, slug, parent_id, sort_order, active, created_at, updated_at " +
        "FROM categories ORDER BY parent_id IS NOT NULL, parent_id, sort_order, id"
      )
      .all();
    return result.results || [];
  }

  async function getProductRelationsGrouped(productId) {
    const result = await env.DB
      .prepare(
        "SELECT pr.related_product_id AS id, pr.relation_type, pr.sort_order, " +
        "p.name, p.slug, p.price, p.image, p.stock, p.active " +
        "FROM product_relations pr " +
        "JOIN products p ON p.id = pr.related_product_id " +
        "WHERE pr.product_id = ? " +
        "ORDER BY pr.relation_type, pr.sort_order, pr.id"
      )
      .bind(productId)
      .all();

    const rows = result.results || [];
    const grouped = { related: [], similar: [], complementary: [] };
    for (const row of rows) {
      if (!grouped[row.relation_type]) grouped[row.relation_type] = [];
      grouped[row.relation_type].push(row);
    }
    return grouped;
  }

  // بعد از ثبت موفق هر سفارش با بیش از یک قلم، شمارنده «همراه خریداری شده»
  // بین هر جفت محصول داخل همان سفارش، در هر دو جهت، یک واحد اضافه می‌شود.
  // این تابع هرگز نباید ثبت سفارش را متوقف کند — خطای آن فقط لاگ می‌شود.
  async function updateCoPurchases(env, productIds, timestamp) {
    try {
      const uniqueIds = [...new Set(productIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
      if (uniqueIds.length < 2) return;

      for (let i = 0; i < uniqueIds.length; i++) {
        for (let j = 0; j < uniqueIds.length; j++) {
          if (i === j) continue;
          const a = uniqueIds[i];
          const b = uniqueIds[j];
          await env.DB
            .prepare(
              "INSERT INTO product_co_purchases (product_id, co_product_id, times_together, last_purchased_at) " +
              "VALUES (?, ?, 1, ?) " +
              "ON CONFLICT(product_id, co_product_id) DO UPDATE SET " +
              "times_together = times_together + 1, last_purchased_at = excluded.last_purchased_at"
            )
            .bind(a, b, timestamp)
            .run();
        }
      }
    } catch (error) {
      console.error("[co-purchases] به‌روزرسانی شکست خورد (سفارش دست‌نخورده باقی ماند):", error.message);
    }
  }

  async function getCoPurchasedProducts(productId, limit = 6) {
    const result = await env.DB
      .prepare(
        "SELECT p.id, p.name, p.slug, p.price, p.image, p.stock, cp.times_together " +
        "FROM product_co_purchases cp " +
        "JOIN products p ON p.id = cp.co_product_id " +
        "WHERE cp.product_id = ? AND p.active = 1 AND p.stock > 0 " +
        "ORDER BY cp.times_together DESC LIMIT ?"
      )
      .bind(productId, limit)
      .all();
    return result.results || [];
  }

  // پرچم‌های نمایش عمومی — Fail-Safe: هر خطا یا نبود جدول/ستون یعنی همه چیز
  // خاموش (false)، دقیقاً همان اصل «عدم قطعیت = عدم نمایش» که برای
  // site-status هم استفاده شده بود.
  async function getFeatureFlags(env) {
    try {
      const row = await env.DB
        .prepare(
          "SELECT show_categories_public, show_related_products, " +
          "show_similar_products, show_cart_suggestions FROM site_settings WHERE id = 1 LIMIT 1"
        )
        .first();

      if (!row) {
        return {
          show_categories_public: false,
          show_related_products: false,
          show_similar_products: false,
          show_cart_suggestions: false,
        };
      }

      return {
        show_categories_public: Number(row.show_categories_public) === 1,
        show_related_products: Number(row.show_related_products) === 1,
        show_similar_products: Number(row.show_similar_products) === 1,
        show_cart_suggestions: Number(row.show_cart_suggestions) === 1,
      };
    } catch (error) {
      console.error("[feature-flags] خواندن ممکن نشد — Fail-Safe: همه خاموش.", error.message);
      return {
        show_categories_public: false,
        show_related_products: false,
        show_similar_products: false,
        show_cart_suggestions: false,
      };
    }
  }

  // =========================================================================
  // مدیریت بسیار دقیق تومان/ریال برای درگاه پرداخت — بخش ۵ دستور.
  //
  // نکته حیاتی: در نسخه فعلی پروژه هیچ درگاه واقعی متصل نیست. این دو تابع
  // «مسیر امن» آماده هستند تا وقتی یک درگاه واقعی (کلید API آن در
  // env.PAYMENT_GATEWAY_API_KEY تنظیم شود) اضافه می‌شود، دقیقاً از همین
  // مسیر (و همین تبدیل واحد) استفاده شود — نه از یک محاسبه جدید و موازی.
  //
  // مبلغ همیشه از خودِ ردیف سفارش در D1 دوباره خوانده می‌شود (هرگز از
  // ورودی کلاینت)، تا مبلغ ارسالی به درگاه فقط به JavaScript سمت مشتری
  // وابسته نباشد.
  // =========================================================================

  async function initiatePaymentRequest(env, orderId) {
    const order = await env.DB
      .prepare("SELECT id, payable_amount, total, payment_status FROM orders WHERE id = ? LIMIT 1")
      .bind(orderId)
      .first();

    if (!order) {
      return { ok: false, error: "ORDER_NOT_FOUND" };
    }

    // اگر سفارش‌های قدیمی‌تر از این Migration، payable_amount نداشته باشند
    // (NULL)، به‌صورت امن روی total کامل سفارش Fallback می‌شود.
    const amountToman = order.payable_amount != null ? Number(order.payable_amount) : Number(order.total) || 0;
    const amountRial = tomanToRial(amountToman); // تنها جایی که این تبدیل باید انجام شود.

    const timestamp = nowIso();
    const insertResult = await env.DB
      .prepare(
        "INSERT INTO payment_transactions (order_id, amount_toman, amount_rial, gateway, status, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, 'initiated', ?, ?)"
      )
      .bind(orderId, amountToman, amountRial, env.PAYMENT_GATEWAY_NAME || "mock", timestamp, timestamp)
      .run();

    const transactionId = insertResult.meta?.last_row_id ?? null;

    if (!env.PAYMENT_GATEWAY_API_KEY) {
      // هیچ درگاه واقعی تنظیم نشده — هیچ درخواست خارجی‌ای زده نمی‌شود.
      // این حالت طبیعی و فعلی پروژه است (پرداخت دستی/حضوری).
      return {
        ok: false,
        mock: true,
        reason: "GATEWAY_NOT_CONFIGURED",
        transaction_id: transactionId,
        amount_toman: amountToman,
        amount_rial: amountRial,
      };
    }

    // نقطه اتصال درگاه واقعی: وقتی کلید API تنظیم شد، اینجا باید یک
    // fetch به API «درخواست پرداخت» درگاه انجام شود — دقیقاً با amountRial
    // محاسبه‌شده در بالا (هرگز amountToman و هرگز محاسبه مجدد آن).
    return {
      ok: false,
      mock: true,
      reason: "GATEWAY_INTEGRATION_NOT_IMPLEMENTED",
      transaction_id: transactionId,
      amount_toman: amountToman,
      amount_rial: amountRial,
    };
  }

  async function verifyPaymentTransaction(env, transactionId, simulateSuccess) {
    const transaction = await env.DB
      .prepare("SELECT id, order_id, amount_toman, amount_rial, status FROM payment_transactions WHERE id = ? LIMIT 1")
      .bind(transactionId)
      .first();

    if (!transaction) {
      return { ok: false, error: "TRANSACTION_NOT_FOUND" };
    }

    if (transaction.status !== "initiated") {
      return { ok: false, error: "TRANSACTION_ALREADY_FINALIZED", status: transaction.status };
    }

    const timestamp = nowIso();
    const newStatus = simulateSuccess ? "paid" : "failed";

    await env.DB
      .prepare("UPDATE payment_transactions SET status = ?, updated_at = ? WHERE id = ?")
      .bind(newStatus, timestamp, transaction.id)
      .run();

    if (simulateSuccess) {
      await env.DB
        .prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?")
        .bind(timestamp, transaction.order_id)
        .run();
    }

    return {
      ok: true,
      status: newStatus,
      order_id: transaction.order_id,
      amount_toman: transaction.amount_toman,
      amount_rial: transaction.amount_rial,
    };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeDigits(value) {
    return String(value ?? "").replace(/[۰-۹٠-٩]/g, (ch) => {
      const persian = "۰۱۲۳۴۵۶۷۸۹";
      const arabic = "٠١٢٣٤٥٦٧٨٩";
      let index = persian.indexOf(ch);
      if (index === -1) index = arabic.indexOf(ch);
      return index === -1 ? ch : String(index);
    });
  }

  function isValidMobile(value) {
    const normalized = normalizeDigits(value).trim();
    return /^09\d{9}$/.test(normalized);
  }

  function isValidPostalCode(value) {
    const normalized = normalizeDigits(value).trim();
    return /^\d{10}$/.test(normalized);
  }

  // آدرس قابل‌خواندن برای پنل مدیریت؛ برای سفارش‌های قدیمی از فیلد متنی قدیمی
  // (customer_address) و برای سفارش‌های جدید از فیلدهای ساختاریافته استفاده می‌شود.
  function composeAddressText(order) {
    if (order.province || order.city || order.street) {
      const parts = [
        order.province,
        order.city,
        order.street,
        order.sub_street,
        order.alley && `کوچه ${order.alley}`,
        order.plaque && `پلاک ${order.plaque}`,
        order.unit && `واحد ${order.unit}`,
        order.postal_code && `کد پستی ${order.postal_code}`,
        order.address_note,
      ].filter(Boolean);

      return parts.join("، ");
    }

    return order.customer_address || "";
  }

  // =========================
  // Helpers — Tracking Code
  // =========================

  function randomTrackingSuffix() {
    const bytes = new Uint8Array(TRACKING_CODE_LENGTH);
    crypto.getRandomValues(bytes);

    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      out += TRACKING_CODE_ALPHABET[bytes[i] % TRACKING_CODE_ALPHABET.length];
    }
    return out;
  }

  async function generateTrackingCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `AP-${randomTrackingSuffix()}`;

      const existing = await env.DB
        .prepare("SELECT id FROM orders WHERE tracking_code = ? LIMIT 1")
        .bind(code)
        .first();

      if (!existing) return code;
    }

    throw new Error("TRACKING_CODE_GENERATION_FAILED");
  }

  async function generateTicketTrackingCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `TK-${randomTrackingSuffix()}`;

      const existing = await env.DB
        .prepare("SELECT id FROM tickets WHERE tracking_code = ? LIMIT 1")
        .bind(code)
        .first();

      if (!existing) return code;
    }

    throw new Error("TICKET_CODE_GENERATION_FAILED");
  }

  // =========================
  // Helpers — Password Hashing (Web Crypto PBKDF2, بدون وابستگی خارجی)
  // =========================

  function toHex(buffer) {
    return [...new Uint8Array(buffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  async function hashPassword(password) {
    const iterations = 100000;
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );

    return `${toHex(salt)}:${iterations}:${toHex(derivedBits)}`;
  }

  async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== "string" || stored.indexOf(":") === -1) {
      return false;
    }

    const [saltHex, iterationsText, hashHex] = stored.split(":");
    const iterations = Number(iterationsText);
    if (!saltHex || !iterations || !hashHex) return false;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );

    const computedHex = toHex(derivedBits);

    if (computedHex.length !== hashHex.length) return false;

    // مقایسه با زمان ثابت (در برابر حملات زمان‌سنجی)
    let diff = 0;
    for (let i = 0; i < computedHex.length; i++) {
      diff |= computedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
    }
    return diff === 0;
  }

  // =========================
  // Helpers — Customer Sessions (Cookie)
  // =========================

  function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const cookies = {};

    header.split(";").forEach((part) => {
      const index = part.indexOf("=");
      if (index === -1) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
    });

    return cookies;
  }

  function isHttps(request) {
    return new URL(request.url).protocol === "https:";
  }

  function buildSessionCookie(request, token, maxAgeSeconds) {
    const attrs = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (isHttps(request)) attrs.push("Secure");
    return attrs.join("; ");
  }

  function buildClearSessionCookie(request) {
    const attrs = [
      `${SESSION_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (isHttps(request)) attrs.push("Secure");
    return attrs.join("; ");
  }

  async function createCustomerSession(customerId) {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await env.DB
      .prepare(
        "INSERT INTO customer_sessions (customer_id, token, expires_at) " +
        "VALUES (?, ?, ?)"
      )
      .bind(customerId, token, expiresAt)
      .run();

    return token;
  }

  async function getSessionCustomer(request) {
    const cookies = parseCookies(request);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;

    const row = await env.DB
      .prepare(
        "SELECT c.id AS id, c.full_name AS full_name, c.phone AS phone, " +
        "s.expires_at AS expires_at " +
        "FROM customer_sessions s " +
        "JOIN customers c ON c.id = s.customer_id " +
        "WHERE s.token = ? LIMIT 1"
      )
      .bind(token)
      .first();

    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    return { id: row.id, full_name: row.full_name, phone: row.phone, _token: token };
  }

// =========================
// Helpers — Notifications
// =========================
async function queueSms(env, orderId, phone, eventType, message) {
  try {
    await env.DB
      .prepare(
        "INSERT INTO sms_notifications (order_id, phone, event_type, message, status) " +
        "VALUES (?, ?, ?, ?, 'pending')"
      )
      .bind(orderId, phone, eventType, message)
      .run();
  } catch (error) {
    // ارسال/ذخیره پیامک هرگز نباید ثبت سفارش را مختل کند.
    console.error("queueSms failed", error);
  }
}

async function queueTicketSms(env, ticketId, phone, eventType, message) {
  try {
    await env.DB
      .prepare(
        "INSERT INTO sms_notifications (ticket_id, phone, event_type, message, status) " +
        "VALUES (?, ?, ?, ?, 'pending')"
      )
      .bind(ticketId, phone, eventType, message)
      .run();
  } catch (error) {
    // ارسال/ذخیره پیامک هرگز نباید ثبت تیکت را مختل کند.
    console.error("queueTicketSms failed", error);
  }
}
// =========================
// SMS.ir — ارسال پیامک Verify
// =========================
async function sendSmsIrVerify(env, mobile, templateId, parameters) {
  if (!env.SMS_IR_API_KEY) {
    throw new Error("SMS_IR_API_KEY is not configured");
  }

  const response = await fetch("https://api.sms.ir/v1/send/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-API-KEY": env.SMS_IR_API_KEY,
    },
    body: JSON.stringify({
      mobile,
      templateId,
      parameters,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.Message ||
      "SMS.ir API error: " + response.status
    );
  }

  return data;
}

// =========================================================================
// OTP Code Generator — بخش ۸
// کد ۶ رقمی با crypto.getRandomValues (rejection sampling برای حذف bias)
// =========================================================================
function generateOtpCode() {
  const max = 1000000; // 0..999999
  const range = Math.floor(0x100000000 / max) * max;
  let value;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= range);
  return String(value % max).padStart(6, "0");
}

// =========================================================================
// Effective Template Resolver
// Registry پایه (بالا) هرگز از کد حذف نمی‌شود؛ اما مدیر می‌تواند از پنل
// مدیریت، templateId یا enabled هر Event را override کند. آن override در
// جدول sms_template_settings ذخیره می‌شود. این تابع همیشه ترکیب «Registry
// پایه + آخرین override» را برمی‌گرداند. اگر جدول override هنوز روی D1
// اجرا نشده باشد (قبل از migration)، به‌صورت امن فقط از Registry پایه
// استفاده می‌کند (خطا نمی‌دهد).
// =========================================================================
async function getEffectiveTemplate(env, eventType) {
  const base = SMS_TEMPLATE_REGISTRY[eventType];
  if (!base) return null;

  let templateId = base.templateId;
  let enabled = base.enabled && base.templateId != null;

  try {
    const override = await env.DB
      .prepare("SELECT template_id, enabled FROM sms_template_settings WHERE event_type = ?")
      .bind(eventType)
      .first();

    if (override) {
      if (override.template_id != null) templateId = override.template_id;
      enabled = !!override.enabled && templateId != null;
    }
  } catch (dbError) {
    // جدول override هنوز وجود ندارد (قبل از اجرای migration) — به Registry پایه fallback می‌کنیم.
  }

  return { ...base, eventType, templateId, enabled };
}

// =========================================================================
// Central SMS Service — بخش ۶ و ۲۲
// همه پیامک‌های سایت (OTP، سفارش، پشتیبانی، خدمات، ...) باید از همین تابع
// عبور کنند: Business Event → sendSms → Template Registry → sendSmsIrVerify
// (provider) → نتیجه در جدول sms_messages ثبت می‌شود. اگر template غیرفعال
// باشد یا templateId نداشته باشد، هیچ درخواستی به SMS.ir زده نمی‌شود؛ فقط
// یک ردیف skipped_no_template در تاریخچه ثبت می‌شود.
//
// variables: یک object ساده مثل { CODE: "123456" } یا
// { ORDER_ID: "1023", AMOUNT: "250000" } — دقیقاً باید نام متغیرهای همان
// eventType در Registry را پوشش دهد؛ مقدار خام OTP هرگز در sms_messages
// ذخیره نمی‌شود (فقط status/template_id/error_code ثبت می‌شوند).
// =========================================================================
async function sendSms(env, { mobile, eventType, variables = {}, customerId = null, purpose = null }) {
  const template = await getEffectiveTemplate(env, eventType);

  if (!template || !template.enabled || !template.templateId) {
    try {
      await env.DB
        .prepare(
          "INSERT INTO sms_messages (customer_id, mobile, event_type, purpose, template_id, status, provider) " +
          "VALUES (?, ?, ?, ?, NULL, 'skipped_no_template', 'sms.ir')"
        )
        .bind(customerId, mobile, eventType, purpose)
        .run();
    } catch (dbError) {
      console.error("sendSms: failed to log skipped message for", eventType, dbError.message);
    }
    return { ok: false, skipped: true, reason: "TEMPLATE_NOT_CONFIGURED" };
  }

  const parameters = (template.variables || []).map((name) => ({
    name,
    value: String(variables[name] ?? ""),
  }));

  let status = "failed";
  let errorCode = null;
  let providerMessageId = null;

  try {
    const providerResult = await sendSmsIrVerify(env, mobile, template.templateId, parameters);
    status = "sent";
    providerMessageId = providerResult?.data?.messageId
      ? String(providerResult.data.messageId)
      : null;
  } catch (error) {
    status = "failed";
    errorCode = error.message;
  }

  try {
    await env.DB
      .prepare(
        "INSERT INTO sms_messages " +
        "(customer_id, mobile, event_type, purpose, template_id, status, provider, provider_message_id, error_code, sent_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'sms.ir', ?, ?, ?)"
      )
      .bind(
        customerId,
        mobile,
        eventType,
        purpose,
        template.templateId,
        status,
        providerMessageId,
        errorCode,
        status === "sent" ? new Date().toISOString() : null
      )
      .run();
  } catch (dbError) {
    console.error("sendSms: failed to log message for", eventType, dbError.message);
  }

  if (status !== "sent") {
    // پیام خطا هرگز شامل SMS_IR_API_KEY نیست (فقط پیام برگشتی از sendSmsIrVerify).
    throw new Error(errorCode || "SMS_SEND_FAILED");
  }

  return { ok: true };
}

async function queueEmail(env, orderId, ticketId, toEmail, subject, body) {
  if (!toEmail) return;

  let notificationId = null;

  try {
    // ابتدا ایمیل را در D1 ثبت می‌کنیم.
    const insertResult = await env.DB
      .prepare(
        "INSERT INTO email_notifications " +
        "(order_id, ticket_id, to_email, subject, body, status) " +
        "VALUES (?, ?, ?, ?, ?, 'pending')"
      )
      .bind(orderId, ticketId, toEmail, subject, body)
      .run();

    notificationId = insertResult.meta?.last_row_id ?? null;

    // اگر Secret در Cloudflare تنظیم نشده باشد،
    // ارسال واقعی انجام نمی‌شود.
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "تأسیسات آپادانا <support@tasisatapadanaesfahan.ir>",
        to: [toEmail],
        reply_to: "support@tasisatapadanaesfahan.ir",
        subject,
        text: body,
      }),
    });

    const resendData = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      throw new Error(
        resendData?.message ||
        resendData?.error ||
        `Resend API error: ${resendResponse.status}`
      );
    }

    // ایمیل با موفقیت توسط Resend پذیرفته شد.
    if (notificationId) {
      await env.DB
        .prepare(
          "UPDATE email_notifications " +
          "SET status = 'sent', sent_at = CURRENT_TIMESTAMP " +
          "WHERE id = ?"
        )
        .bind(notificationId)
        .run();
    }

    console.log(
      "Email sent successfully:",
      resendData?.id || "no-provider-id"
    );

  } catch (error) {
    // خطای ایمیل نباید ثبت تیکت یا سفارش را مختل کند.
    console.error("queueEmail failed:", error);

    if (notificationId) {
      try {
        await env.DB
          .prepare(
            "UPDATE email_notifications " +
            "SET status = 'failed' " +
            "WHERE id = ?"
          )
          .bind(notificationId)
          .run();
      } catch (dbError) {
        console.error("queueEmail status update failed:", dbError);
      }
    }
  }
} 

  // =========================
  // Store Health
  // =========================

  if (url.pathname === "/api/store/health") {
    return Response.json({
      ok: true,
      service: "tasisat-apadana-store",
      version: "2.1.0",
      sms_architecture_version: "1.0.0",
      database: !!env.DB,
    });
  }

  // =========================
  // Admin Test
  // =========================

  if (url.pathname === "/api/store/admin-test") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    return Response.json({ ok: true, admin: true, message: "Admin authentication is working." });
  }

  // =========================
  // Admin Dashboard — Summary (فقط COUNT، بدون ارسال کل داده‌ها)
  // GET /api/store/admin/summary
  // =========================

  if (url.pathname === "/api/store/admin/summary" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const productsTotalRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM products")
        .first();

      const productsActiveRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM products WHERE active = 1")
        .first();

      const productsTotal = productsTotalRow?.c || 0;
      const productsActive = productsActiveRow?.c || 0;

      const ordersTotalRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM orders")
        .first();

      const ordersByStatusResult = await env.DB
        .prepare("SELECT status, COUNT(*) AS c FROM orders GROUP BY status")
        .all();

      const ordersByStatus = {};
      for (const row of ordersByStatusResult.results || []) {
        ordersByStatus[row.status] = row.c;
      }

      // «سفارش‌های جدید» دیگر صرفاً از روی status='pending' شمارش نمی‌شود؛
      // منبع واقعی یک اعلان خوانده‌نشده در order_notifications است که فقط
      // برای سفارش واقعاً pending هنوز باز است. با تغییر وضعیت (از جمله
      // لغو) یا مشاهده جزئیات سفارش توسط ادمین، اعلان خوانده‌شده علامت
      // می‌خورد و اینجا دیگر شمرده نمی‌شود — بدون نیاز به جدول جدید اگر
      // Migration هنوز اجرا نشده (Fail-Safe: صفر).
      let newOrdersCount = 0;
      try {
        const newOrdersRow = await env.DB
          .prepare(
            "SELECT COUNT(*) AS c FROM order_notifications n " +
            "JOIN orders o ON o.id = n.order_id " +
            "WHERE n.is_read = 0 AND o.status = 'pending'"
          )
          .first();
        newOrdersCount = newOrdersRow?.c || 0;
      } catch (notifError) {
        console.error("[order-notifications] شمارش سفارش‌های جدید ممکن نشد:", notifError.message);
        newOrdersCount = 0;
      }

      const ticketsTotalRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM tickets")
        .first();

      const ticketsByStatusResult = await env.DB
        .prepare("SELECT status, COUNT(*) AS c FROM tickets GROUP BY status")
        .all();

      const ticketsByStatus = {};
      for (const row of ticketsByStatusResult.results || []) {
        ticketsByStatus[row.status] = row.c;
      }

      // تعریف مرکزی «جدید» / گروه‌بندی وضعیت‌ها — طبق مقادیر واقعی backend:
      // orders: pending=جدید, confirmed+preparing=در حال بررسی/آماده‌سازی, shipped, completed
      // tickets: received=جدید, in_review=در حال پیگیری, (received+in_review)=پاسخ‌داده‌نشده
      const orders = {
        total: ordersTotalRow?.c || 0,
        new: newOrdersCount,
        in_review: (ordersByStatus.confirmed || 0) + (ordersByStatus.preparing || 0),
        shipped: ordersByStatus.shipped || 0,
        completed: ordersByStatus.completed || 0,
        cancelled: ordersByStatus.cancelled || 0,
      };

      const tickets = {
        total: ticketsTotalRow?.c || 0,
        new: ticketsByStatus.received || 0,
        in_progress: ticketsByStatus.in_review || 0,
        unanswered: (ticketsByStatus.received || 0) + (ticketsByStatus.in_review || 0),
      };

      return Response.json({
        ok: true,
        products: {
          total: productsTotal,
          active: productsActive,
          inactive: productsTotal - productsActive,
        },
        orders,
        tickets,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // وضعیت عملیاتی سراسری سایت — توقف/فعال‌سازی موقت فروشگاه و خدمات
  // (جدول site_settings — یک رکورد تک، id=1). مستقل از وضعیت محصول
  // (active/inactive) و مستقل از یکدیگر (store_status / services_status).
  //
  // توجه مهم: در نسخه فعلی پروژه هیچ API واقعی برای «ثبت درخواست خدمت»
  // وجود ندارد؛ services_status فقط زیرساخت است و فعلاً هیچ مسیر Backend
  // به آن متکی نیست (به فایل database/site-status.sql مراجعه شود).
  // =========================================================================

  const SITE_STATUS_VALUES = ["open", "paused"];

  // منبع واحد خواندن وضعیت.
  //
  // Fail-Safe واقعی (بخش ۲ اصلاحیه): این تابع هرگز throw نمی‌کند و همیشه یک
  // شیء با کلید صریح "determined" برمی‌گرداند:
  //   - determined: true  → وضعیت واقعاً از D1 خوانده شد؛ store_status/
  //     services_status معتبر و قابل‌اعتماد هستند.
  //   - determined: false → خواندن از D1 به هر دلیلی (جدول وجود ندارد،
  //     رکورد id=1 وجود ندارد، خطای اتصال D1، هر خطای دیگر) ممکن نشد.
  //     در این حالت store_status/services_status را هم به "paused" ست
  //     می‌کنیم، اما مسیرهای حساس (Checkout) باید صریحاً روی "determined"
  //     چک کنند، نه فقط روی مقدار status — یعنی:
  //     "عدم توانایی در تشخیص وضعیت = عدم اجازه ایجاد سفارش"
  //     حتی اگر به هر دلیل مقدار status هم دستکاری/تغییر کند.
  //
  // خطای واقعی همیشه با console.error ثبت می‌شود تا در Cloudflare Logs
  // قابل بررسی باشد (چرا جدول/رکورد در دسترس نبوده).
  async function getSiteStatus(env) {
    try {
      const row = await env.DB
        .prepare(
          "SELECT store_status, services_status, store_updated_at, services_updated_at " +
          "FROM site_settings WHERE id = 1 LIMIT 1"
        )
        .first();

      if (!row) {
        console.error("[site-status] رکورد id=1 در site_settings یافت نشد — Fail-Safe: paused.");
        return {
          store_status: "paused",
          services_status: "paused",
          determined: false,
          reason: "NO_ROW",
        };
      }

      return {
        store_status: row.store_status === "open" ? "open" : "paused",
        services_status: row.services_status === "open" ? "open" : "paused",
        store_updated_at: row.store_updated_at || null,
        services_updated_at: row.services_updated_at || null,
        determined: true,
        reason: null,
      };
    } catch (error) {
      // جدول هنوز Migration نشده یا D1 در دسترس نیست — Fail-Safe: paused.
      console.error("[site-status] خطا در خواندن وضعیت از D1 — Fail-Safe: paused.", error.message);
      const isMissingTable = /no such table/i.test(error.message || "");
      return {
        store_status: "paused",
        services_status: "paused",
        determined: false,
        reason: isMissingTable ? "TABLE_MISSING" : "READ_ERROR",
        rawError: error.message,
      };
    }
  }

  // بررسی مجاز بودن ایجاد سفارش — تنها و تنها زمانی true است که وضعیت واقعاً
  // از D1 خوانده شده باشد (determined=true) و آن وضعیت دقیقاً "open" باشد.
  // هر حالت دیگری (جدول نیست، رکورد نیست، خطای D1، مقدار غیرمنتظره) → false.
  function isOrderCreationAllowed(siteStatus) {
    return siteStatus.determined === true && siteStatus.store_status === "open";
  }

  // =========================
  // GET /api/store/site-status — عمومی، بدون Authentication
  // برای نمایش بنر/پیام در فروشگاه عمومی (در صورت نیاز Frontend) استفاده
  // می‌شود. این endpoint فقط اطلاع‌رسانی است؛ منبع حقیقتِ Order Creation
  // همیشه بررسی مستقیم در همان مسیر Checkout است، نه این endpoint.
  // Cache-Control: no-store — این وضعیت هرگز نباید از Cache قدیمی (مرورگر/
  // CDN) خوانده شود.
  // =========================

  if (url.pathname === "/api/store/site-status" && request.method === "GET") {
    const status = await getSiteStatus(env);
    return Response.json(
      {
        ok: true,
        store_status: status.store_status,
        services_status: status.services_status,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // =========================
  // GET /api/store/admin/site-status — فقط Admin
  // status_unknown=true یعنی: وضعیت واقعی از D1 قابل خواندن نیست (مثلاً
  // Migration هنوز اجرا نشده). در این حالت UI باید صراحتاً «خطا/نامشخص»
  // نشان دهد، نه یک وضعیت جعلی باز/بسته.
  // =========================

  if (url.pathname === "/api/store/admin/site-status" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const status = await getSiteStatus(env);
    return Response.json(
      {
        ok: true,
        store_status: status.store_status,
        services_status: status.services_status,
        store_updated_at: status.store_updated_at || null,
        services_updated_at: status.services_updated_at || null,
        status_unknown: !status.determined,
        status_unknown_reason: status.determined
          ? null
          : status.reason === "TABLE_MISSING"
          ? "جدول site_settings هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/site-status.sql) را روی D1 اجرا کنید."
          : "خواندن وضعیت از پایگاه‌داده ممکن نشد.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // =========================
  // POST /api/store/admin/site-status/store — فقط Admin
  // POST /api/store/admin/site-status/services — فقط Admin
  // بدنه: { "status": "open" | "paused" }
  // این دو مسیر کاملاً مستقل‌اند و هیچ‌کدام دیگری را تغییر نمی‌دهد.
  // =========================

  if (
    (url.pathname === "/api/store/admin/site-status/store" ||
      url.pathname === "/api/store/admin/site-status/services") &&
    request.method === "POST"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const newStatus = String(body.status || "").trim();

      if (!SITE_STATUS_VALUES.includes(newStatus)) {
        return Response.json(
          { ok: false, error: "INVALID_STATUS", message: "وضعیت باید open یا paused باشد." },
          { status: 400 }
        );
      }

      const isStore = url.pathname.endsWith("/store");
      const column = isStore ? "store_status" : "services_status";
      const updatedAtColumn = isStore ? "store_updated_at" : "services_updated_at";
      const timestamp = nowIso();

      // اگر رکورد id=1 هنوز وجود ندارد (مثلاً Migration به‌تازگی اجرا شده)،
      // اول آن را با مقادیر پیش‌فرض می‌سازیم تا UPDATE هرگز بی‌اثر نماند.
      // اگر خود جدول site_settings اصلاً وجود نداشته باشد، همین INSERT با
      // خطای "no such table" شکست می‌خورد و در catch زیر با پیام فارسی
      // مشخص (نه متن خام D1) به مدیر گزارش می‌شود.
      await env.DB
        .prepare(
          "INSERT INTO site_settings (id, store_status, services_status) " +
          "VALUES (1, 'open', 'open') ON CONFLICT(id) DO NOTHING"
        )
        .run();

      await env.DB
        .prepare(
          `UPDATE site_settings SET ${column} = ?, ${updatedAtColumn} = ? WHERE id = 1`
        )
        .bind(newStatus, timestamp)
        .run();

      const status = await getSiteStatus(env);

      if (!status.determined) {
        // UPDATE ظاهراً بدون خطا اجرا شد ولی خواندن مجدد ناموفق بود —
        // این حالت نباید به‌عنوان موفقیت گزارش شود.
        return Response.json(
          {
            ok: false,
            error: "SITE_STATUS_VERIFY_FAILED",
            message: "تغییر ثبت شد اما تأیید وضعیت جدید از پایگاه‌داده ممکن نشد. لطفاً صفحه را رفرش کنید.",
          },
          { status: 500 }
        );
      }

      return Response.json({
        ok: true,
        store_status: status.store_status,
        services_status: status.services_status,
        store_updated_at: status.store_updated_at || null,
        services_updated_at: status.services_updated_at || null,
      });
    } catch (error) {
      console.error("[site-status] خطا در تغییر وضعیت:", error.message);
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "SITE_SETTINGS_TABLE_MISSING" : "SITE_STATUS_UPDATE_ERROR",
          message: isMissingTable
            ? "جدول site_settings هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/site-status.sql) را روی D1 اجرا کنید."
            : "خطا در تغییر وضعیت. لطفاً دوباره تلاش کنید.",
        },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // SMS Admin Panel API — بخش ۵ تا ۲۶ دستور «توسعه پنل مدیریت SMS»
  // همه این endpointها فقط Admin (X-Admin-Token) هستند.
  // =========================================================================

  // --- داشبورد پیامک ---
  // GET /api/store/admin/sms/summary
  if (url.pathname === "/api/store/admin/sms/summary" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const todayRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM sms_messages WHERE date(created_at) = date('now')")
        .first();
      const monthRow = await env.DB
        .prepare(
          "SELECT COUNT(*) AS c FROM sms_messages WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
        )
        .first();

      const statusRows = await env.DB
        .prepare("SELECT status, COUNT(*) AS c FROM sms_messages GROUP BY status")
        .all();

      const statusCounts = { sent: 0, failed: 0, skipped_no_template: 0 };
      for (const row of statusRows.results || []) {
        statusCounts[row.status] = row.c;
      }

      const consentRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM customers WHERE sms_marketing_consent = 1")
        .first();

      const lastMessagesResult = await env.DB
        .prepare(
          "SELECT sm.id, sm.mobile, sm.event_type, sm.status, sm.template_id, sm.created_at, sm.sent_at, " +
          "c.full_name AS customer_name " +
          "FROM sms_messages sm LEFT JOIN customers c ON c.id = sm.customer_id " +
          "ORDER BY sm.id DESC LIMIT 10"
        )
        .all();

      const mostUsedRow = await env.DB
        .prepare(
          "SELECT event_type, COUNT(*) AS c FROM sms_messages GROUP BY event_type ORDER BY c DESC LIMIT 1"
        )
        .first();

      const eventTypes = Object.keys(SMS_TEMPLATE_REGISTRY);
      let activeTemplatesCount = 0;
      for (const eventType of eventTypes) {
        const effective = await getEffectiveTemplate(env, eventType);
        if (effective?.enabled) activeTemplatesCount += 1;
      }

      const totalAttempts = (statusCounts.sent || 0) + (statusCounts.failed || 0);
      const successRate = totalAttempts > 0 ? Math.round((statusCounts.sent / totalAttempts) * 1000) / 10 : null;

      return Response.json({
        ok: true,
        today_count: todayRow?.c || 0,
        month_count: monthRow?.c || 0,
        sent_count: statusCounts.sent || 0,
        failed_count: statusCounts.failed || 0,
        skipped_count: statusCounts.skipped_no_template || 0,
        // این معماری فعلاً ارسال synchronous دارد (صف/Queue واقعی وجود ندارد)،
        // پس هیچ پیامی هیچ‌وقت در وضعیت واقعی «در انتظار» باقی نمی‌ماند.
        pending_count: 0,
        success_rate_percent: successRate,
        active_templates_count: activeTemplatesCount,
        total_templates_count: eventTypes.length,
        customers_with_consent_count: consentRow?.c || 0,
        most_used_template: mostUsedRow?.event_type || null,
        last_messages: lastMessagesResult.results || [],
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- قالب‌ها ---
  // GET /api/store/admin/sms/templates
  if (url.pathname === "/api/store/admin/sms/templates" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const templates = [];

      for (const [eventType, base] of Object.entries(SMS_TEMPLATE_REGISTRY)) {
        const effective = await getEffectiveTemplate(env, eventType);

        const statsRow = await env.DB
          .prepare(
            "SELECT COUNT(*) AS total, " +
            "SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent, " +
            "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, " +
            "MAX(sent_at) AS last_sent_at " +
            "FROM sms_messages WHERE event_type = ?"
          )
          .bind(eventType)
          .first();

        templates.push({
          event_type: eventType,
          title: base.title,
          description: base.description,
          category: base.category,
          category_label: SMS_CATEGORY_LABELS[base.category] || base.category,
          variables: base.variables,
          provider: "sms.ir",
          allow_manual_send: !!base.allowManualSend,
          allow_campaign: !!base.allowCampaign,
          template_id: effective.templateId,
          default_template_id: base.templateId,
          enabled: effective.enabled,
          is_overridden: effective.templateId !== base.templateId || effective.enabled !== base.enabled,
          stats: {
            total: statsRow?.total || 0,
            sent: statsRow?.sent || 0,
            failed: statsRow?.failed || 0,
            last_sent_at: statsRow?.last_sent_at || null,
          },
        });
      }

      return Response.json({ ok: true, templates });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // PUT /api/store/admin/sms/templates/:eventType
  if (
    url.pathname.startsWith("/api/store/admin/sms/templates/") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const eventType = decodeURIComponent(url.pathname.split("/").pop());

    if (!SMS_TEMPLATE_REGISTRY[eventType]) {
      return Response.json(
        { ok: false, error: "UNKNOWN_EVENT_TYPE", message: "این نوع رویداد در Registry وجود ندارد." },
        { status: 404 }
      );
    }

    try {
      const body = await request.json();
      const rawTemplateId = body.template_id;
      const enabled = body.enabled === false ? 0 : 1;

      let templateId = null;
      if (rawTemplateId !== null && rawTemplateId !== undefined && rawTemplateId !== "") {
        templateId = Number(rawTemplateId);
        if (!Number.isInteger(templateId) || templateId <= 0) {
          return Response.json(
            { ok: false, error: "INVALID_TEMPLATE_ID", message: "Template ID باید یک عدد صحیح مثبت باشد." },
            { status: 400 }
          );
        }
      }

      await env.DB
        .prepare(
          "INSERT INTO sms_template_settings (event_type, template_id, enabled, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(event_type) DO UPDATE SET template_id = excluded.template_id, enabled = excluded.enabled, updated_at = excluded.updated_at"
        )
        .bind(eventType, templateId, enabled, nowIso())
        .run();

      const effective = await getEffectiveTemplate(env, eventType);

      return Response.json({
        ok: true,
        message: "تنظیمات قالب بروزرسانی شد.",
        event_type: eventType,
        template_id: effective.templateId,
        enabled: effective.enabled,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "SERVER_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- تاریخچه پیامک ---
  // GET /api/store/admin/sms/history
  if (url.pathname === "/api/store/admin/sms/history" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
      const mobile = (url.searchParams.get("mobile") || "").trim();
      const eventType = (url.searchParams.get("event_type") || "").trim();
      const category = (url.searchParams.get("category") || "").trim();
      const templateId = (url.searchParams.get("template_id") || "").trim();
      const status = (url.searchParams.get("status") || "").trim();
      const dateFrom = (url.searchParams.get("date_from") || "").trim();
      const dateTo = (url.searchParams.get("date_to") || "").trim();

      const conditions = [];
      const params = [];

      if (mobile) {
        conditions.push("sm.mobile LIKE ?");
        params.push(`%${mobile}%`);
      }
      if (eventType) {
        conditions.push("sm.event_type = ?");
        params.push(eventType);
      }
      if (category) {
        const eventTypesInCategory = Object.entries(SMS_TEMPLATE_REGISTRY)
          .filter(([, def]) => def.category === category)
          .map(([key]) => key);
        if (eventTypesInCategory.length > 0) {
          conditions.push(`sm.event_type IN (${eventTypesInCategory.map(() => "?").join(",")})`);
          params.push(...eventTypesInCategory);
        } else {
          conditions.push("1 = 0"); // دسته نامعتبر → نتیجه خالی
        }
      }
      if (templateId) {
        conditions.push("sm.template_id = ?");
        params.push(Number(templateId));
      }
      if (status) {
        conditions.push("sm.status = ?");
        params.push(status);
      }
      if (dateFrom) {
        conditions.push("sm.created_at >= ?");
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push("sm.created_at <= ?");
        params.push(dateTo);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS c FROM sms_messages sm ${whereClause}`)
        .bind(...params)
        .first();

      const total = countRow?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;

      const result = await env.DB
        .prepare(
          "SELECT sm.id, sm.mobile, sm.event_type, sm.purpose, sm.template_id, sm.status, sm.provider, " +
          "sm.provider_message_id, sm.error_code, sm.created_at, sm.sent_at, c.full_name AS customer_name " +
          "FROM sms_messages sm LEFT JOIN customers c ON c.id = sm.customer_id " +
          `${whereClause} ORDER BY sm.id DESC LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all();

      const messages = (result.results || []).map((row) => ({
        ...row,
        title: SMS_TEMPLATE_REGISTRY[row.event_type]?.title || row.event_type,
        category: SMS_TEMPLATE_REGISTRY[row.event_type]?.category || null,
      }));

      return Response.json({ ok: true, messages, page, limit, total, total_pages: totalPages });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // GET /api/store/admin/sms/history/:id
  if (
    url.pathname.startsWith("/api/store/admin/sms/history/") &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const id = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    }

    try {
      const row = await env.DB
        .prepare(
          "SELECT sm.*, c.full_name AS customer_name FROM sms_messages sm " +
          "LEFT JOIN customers c ON c.id = sm.customer_id WHERE sm.id = ? LIMIT 1"
        )
        .bind(id)
        .first();

      if (!row) {
        return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }

      const registryEntry = SMS_TEMPLATE_REGISTRY[row.event_type];

      return Response.json({
        ok: true,
        message: {
          ...row,
          title: registryEntry?.title || row.event_type,
          category: registryEntry?.category || null,
          category_label: registryEntry ? SMS_CATEGORY_LABELS[registryEntry.category] : null,
        },
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- ارسال دستی ---
  // POST /api/store/admin/sms/send
  if (url.pathname === "/api/store/admin/sms/send" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const mobile = normalizeDigits(body.mobile || "").trim();
      const eventType = String(body.event_type || "").trim();
      const variables = body.variables && typeof body.variables === "object" ? body.variables : {};

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      const base = SMS_TEMPLATE_REGISTRY[eventType];
      if (!base) {
        return Response.json(
          { ok: false, error: "UNKNOWN_EVENT_TYPE", message: "قالب انتخاب‌شده معتبر نیست." },
          { status: 400 }
        );
      }

      if (!base.allowManualSend) {
        return Response.json(
          { ok: false, error: "MANUAL_SEND_NOT_ALLOWED", message: "ارسال دستی برای این قالب مجاز نیست." },
          { status: 400 }
        );
      }

      const effective = await getEffectiveTemplate(env, eventType);
      if (!effective.enabled || !effective.templateId) {
        return Response.json(
          { ok: false, error: "TEMPLATE_DISABLED", message: "این قالب غیرفعال است یا Template ID ندارد." },
          { status: 400 }
        );
      }

      const missingVariables = (base.variables || []).filter(
        (name) => !variables[name] || String(variables[name]).trim() === ""
      );

      if (missingVariables.length > 0) {
        return Response.json(
          {
            ok: false,
            error: "MISSING_VARIABLES",
            message: `مقادیر این متغیرها را وارد کنید: ${missingVariables.join(", ")}`,
          },
          { status: 400 }
        );
      }

      const customer = await env.DB
        .prepare("SELECT id FROM customers WHERE phone = ? LIMIT 1")
        .bind(normalizeDigits(mobile).trim())
        .first();

      await sendSms(env, {
        mobile,
        eventType,
        variables,
        customerId: customer?.id || null,
        purpose: "manual_admin",
      });

      return Response.json({ ok: true, message: "پیامک با موفقیت ارسال شد." });
    } catch (error) {
      return Response.json(
        { ok: false, error: "SMS_SEND_FAILED", message: error.message },
        { status: 502 }
      );
    }
  }

  // --- وضعیت اتصال SMS.ir ---
  // GET /api/store/admin/sms/status
  if (url.pathname === "/api/store/admin/sms/status" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const eventTypes = Object.keys(SMS_TEMPLATE_REGISTRY);
      let activeTemplatesCount = 0;
      for (const eventType of eventTypes) {
        const effective = await getEffectiveTemplate(env, eventType);
        if (effective?.enabled) activeTemplatesCount += 1;
      }

      const lastSent = await env.DB
        .prepare("SELECT event_type, mobile, sent_at FROM sms_messages WHERE status = 'sent' ORDER BY id DESC LIMIT 1")
        .first();

      const lastError = await env.DB
        .prepare(
          "SELECT event_type, mobile, error_code, created_at FROM sms_messages WHERE status = 'failed' ORDER BY id DESC LIMIT 1"
        )
        .first();

      return Response.json({
        ok: true,
        provider: "sms.ir",
        // مقدار واقعی Secret هرگز خوانده یا نمایش داده نمی‌شود؛ فقط وجودش بررسی می‌شود.
        secret_configured: !!env.SMS_IR_API_KEY,
        active_templates_count: activeTemplatesCount,
        total_templates_count: eventTypes.length,
        last_sent: lastSent || null,
        last_error: lastError || null,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- پیامک‌های زمان‌بندی‌شده (وضعیت آمادگی، نه ارسال واقعی) ---
  // GET /api/store/admin/sms/scheduled-status
  if (url.pathname === "/api/store/admin/sms/scheduled-status" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const eligibleRow = await env.DB
        .prepare(
          "SELECT COUNT(*) AS c FROM customers WHERE next_service_at IS NOT NULL AND next_service_at <= datetime('now')"
        )
        .first();

      const birthdayRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM customers WHERE birthday IS NOT NULL")
        .first();

      return Response.json({
        ok: true,
        // این پروژه فعلاً هیچ Cloudflare Cron Trigger واقعی ندارد (بدون تغییر wrangler.toml)؛
        // این مقدار صادقانه false است، نه یک وضعیت ساختگی.
        cron_configured: false,
        eligible_boiler_service_count: eligibleRow?.c || 0,
        customers_with_birthday_count: birthdayRow?.c || 0,
        note:
          "زیرساخت داده (next_service_at, birthday) آماده است، اما تا زمانی که یک Cloudflare Cron Trigger واقعی در wrangler.toml و یک scheduled handler در Worker اضافه نشود، هیچ پیامک زمان‌بندی‌شده‌ای به‌صورت خودکار ارسال نمی‌شود.",
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- پیش‌نمایش کمپین (فقط شمارش گیرندگان — ارسال گروهی واقعی هنوز ساخته نشده) ---
  // POST /api/store/admin/sms/campaign/preview
  if (url.pathname === "/api/store/admin/sms/campaign/preview" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const filter = String(body.filter || "consented");

      let countRow;
      if (filter === "verified_and_consented") {
        countRow = await env.DB
          .prepare("SELECT COUNT(*) AS c FROM customers WHERE sms_marketing_consent = 1 AND phone_verified = 1")
          .first();
      } else if (filter === "consented") {
        countRow = await env.DB
          .prepare("SELECT COUNT(*) AS c FROM customers WHERE sms_marketing_consent = 1")
          .first();
      } else {
        return Response.json(
          { ok: false, error: "INVALID_FILTER", message: "فیلتر گیرندگان نامعتبر است." },
          { status: 400 }
        );
      }

      return Response.json({
        ok: true,
        filter,
        recipient_count: countRow?.c || 0,
        // صادقانه: ارسال گروهی واقعی در این نسخه پیاده‌سازی نشده، فقط پیش‌نمایش تعداد گیرنده.
        send_available: false,
        note: "ارسال گروهی واقعی هنوز پیاده‌سازی نشده است؛ این فقط پیش‌نمایش تعداد گیرندگان بالقوه است.",
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // --- رضایت پیامک تبلیغاتی مشتریان ---
  // GET /api/store/admin/customers
  if (url.pathname === "/api/store/admin/customers" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
      const q = (url.searchParams.get("q") || "").trim();
      const consentFilter = url.searchParams.get("consent");
      const activeFilter = url.searchParams.get("active");

      const conditions = [];
      const params = [];

      if (q) {
        conditions.push("(full_name LIKE ? OR phone LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
      if (consentFilter === "1" || consentFilter === "0") {
        conditions.push("sms_marketing_consent = ?");
        params.push(Number(consentFilter));
      }
      if (activeFilter === "1" || activeFilter === "0") {
        conditions.push("is_active = ?");
        params.push(Number(activeFilter));
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS c FROM customers ${whereClause}`)
        .bind(...params)
        .first();

      const total = countRow?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;

      const result = await env.DB
        .prepare(
          "SELECT id, full_name, phone, phone_verified, sms_marketing_consent, birthday, is_active, created_at " +
          `FROM customers ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all();

      return Response.json({
        ok: true,
        customers: result.results || [],
        page,
        limit,
        total,
        total_pages: totalPages,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // مدیریت کاربران — بخش ۱ دستور: فعال/غیرفعال‌کردن حساب مشتری.
  // رمز عبور یا هر اطلاعات حساس دیگری هرگز در هیچ پاسخی برگردانده نمی‌شود.
  // سیستم نقش/سطح دسترسی جدیدی ساخته نشده — فقط یک پرچم ساده روی همان
  // جدول customers موجود.
  // =========================================================================
  if (
    url.pathname.startsWith("/api/store/admin/customers/") &&
    url.pathname.endsWith("/status") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const idMatch = url.pathname.match(/^\/api\/store\/admin\/customers\/(\d+)\/status$/);
    if (!idMatch) {
      return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    }

    try {
      const body = await request.json();
      const isActive = body.is_active ? 1 : 0;
      const customerId = Number(idMatch[1]);

      const result = await env.DB
        .prepare("UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ?")
        .bind(isActive, nowIso(), customerId)
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "NOT_FOUND", message: "کاربر پیدا نشد." }, { status: 404 });
      }

      // غیرفعال‌کردن حساب، نشست‌های فعلی او را هم باطل می‌کند تا بلافاصله
      // اثر کند (نه فقط جلوگیری از ورود بعدی).
      if (!isActive) {
        await env.DB.prepare("DELETE FROM customer_sessions WHERE customer_id = ?").bind(customerId).run();
      }

      return Response.json({
        ok: true,
        message: isActive ? "حساب کاربر فعال شد." : "حساب کاربر غیرفعال شد.",
        is_active: isActive,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "SERVER_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // PUT /api/store/admin/customers/:id/consent
  if (
    url.pathname.startsWith("/api/store/admin/customers/") &&
    url.pathname.endsWith("/consent") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const idMatch = url.pathname.match(/^\/api\/store\/admin\/customers\/(\d+)\/consent$/);
    if (!idMatch) {
      return Response.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    }

    try {
      const body = await request.json();
      const consent = body.sms_marketing_consent ? 1 : 0;

      const result = await env.DB
        .prepare("UPDATE customers SET sms_marketing_consent = ?, updated_at = ? WHERE id = ?")
        .bind(consent, nowIso(), Number(idMatch[1]))
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }

      return Response.json({ ok: true, message: "رضایت پیامکی بروزرسانی شد.", sms_marketing_consent: consent });
    } catch (error) {
      return Response.json(
        { ok: false, error: "SERVER_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Products - Public List
  // =========================


  if (url.pathname === "/api/store/products" && request.method === "GET") {
    const adminRequest = isAdmin(request, env);

    // حالت عمومی (فروشگاه): دقیقاً همان رفتار قبلی، بدون هیچ تغییری.
    if (!adminRequest) {
      try {
        const result = await env.DB
          .prepare(
            "SELECT id, name, slug, description, price, image, stock, active, shipping_cost, brand, category_id " +
            "FROM products WHERE active = 1 ORDER BY id DESC"
          )
          .all();

        const products = result.results || [];
        const formatRules = await getTechnicalFormatRules(env);

        for (const product of products) {
          product.images = await getProductImages(product.id);

          if (product.images.length === 0 && product.image) {
            product.images = [{ id: null, image: product.image, sort_order: 0 }];
          }

          applyTechnicalFormattingToProduct(product, formatRules);
        }

        return Response.json({ ok: true, products });
      } catch (error) {
        return Response.json(
          { ok: false, error: "DATABASE_ERROR", message: error.message },
          { status: 500 }
        );
      }
    }

    // حالت مدیریت: pagination واقعی + جست‌وجو + فیلتر فعال/غیرفعال،
    // تا لیست محصولات هرگز یکجا به مرورگر ارسال نشود.
    try {
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
      const q = (url.searchParams.get("q") || "").trim();
      const activeParam = url.searchParams.get("active"); // "1" | "0" | null (همه)

      const conditions = [];
      const params = [];

      if (activeParam === "1" || activeParam === "0") {
        conditions.push("active = ?");
        params.push(Number(activeParam));
      }

      if (q) {
        conditions.push("(name LIKE ? OR slug LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS c FROM products ${whereClause}`)
        .bind(...params)
        .first();

      const total = countRow?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;

      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock, active, " +
          "brand, model, sku, compare_at_price, shipping_cost, shipping_method, shipping_time, " +
          "warranty_months, warranty_provider, return_days, category_id " +
          `FROM products ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all();

      const products = result.results || [];
      const formatRules = await getTechnicalFormatRules(env);

      for (const product of products) {
        product.images = await getProductImages(product.id);
        product.specs = await getProductSpecs(product.id);

        if (product.images.length === 0 && product.image) {
          product.images = [{ id: null, image: product.image, sort_order: 0 }];
        }

        applyTechnicalFormattingToProduct(product, formatRules);
      }

      return Response.json({
        ok: true,
        products,
        page,
        limit,
        total,
        total_pages: totalPages,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - List
  // پارامترهای اختیاری: ?status=pending  ?q=AP-XXXX یا شماره موبایل یا نام
  // =========================

  if (url.pathname === "/api/store/orders" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const statusFilter = (url.searchParams.get("status") || "").trim();
      const query = (url.searchParams.get("q") || "").trim();
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));

      const conditions = [];
      const params = [];

      if (statusFilter) {
        conditions.push("status = ?");
        params.push(statusFilter);
      }

      if (query) {
        conditions.push(
          "(tracking_code LIKE ? OR customer_phone LIKE ? OR customer_name LIKE ?)"
        );
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS c FROM orders ${whereClause}`)
        .bind(...params)
        .first();

      const total = countRow?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;

      const ordersResult = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
          "customer_address, province, city, street, sub_street, alley, plaque, " +
          "unit, postal_code, address_note, total, shipping_cost, shipping_method_id, " +
          "shipping_method_name, shipping_is_cod, payable_amount, status, payment_status, " +
          "postal_carrier, postal_tracking_code, created_at, updated_at, " +
          "(SELECT COUNT(*) FROM tickets t WHERE t.order_id = orders.id) AS ticket_count, " +
          "(SELECT COUNT(*) FROM tickets t WHERE t.order_id = orders.id AND t.status != 'closed') AS open_ticket_count " +
          "FROM orders " +
          whereClause +
          " ORDER BY id DESC LIMIT ? OFFSET ?"
        )
        .bind(...params, limit, offset)
        .all();

      const orders = ordersResult.results || [];

      for (const order of orders) {
        const itemsResult = await env.DB
          .prepare(
            "SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.price, oi.quantity, " +
            "oi.subtotal, oi.created_at, p.image AS product_image, " +
            "(SELECT pi.image FROM product_images pi WHERE pi.product_id = oi.product_id " +
            "ORDER BY pi.sort_order ASC, pi.id ASC LIMIT 1) AS gallery_image " +
            "FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id " +
            "WHERE oi.order_id = ? ORDER BY oi.id ASC"
          )
          .bind(order.id)
          .all();

        order.items = (itemsResult.results || []).map((item) => {
          const rawImage = item.product_image || item.gallery_image || null;
          const { gallery_image, ...rest } = item;
          return { ...rest, product_image: rawImage ? resolveAbsoluteProductImageUrl(rawImage) : null };
        });
        order.customer_address = composeAddressText(order);
        order.is_guest = !order.customer_id;
      }

      return Response.json({
        ok: true,
        orders,
        page,
        limit,
        total,
        total_pages: totalPages,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - Details
  // =========================

  if (
    url.pathname.startsWith("/api/store/orders/") &&
    !url.pathname.startsWith("/api/store/orders/history/") &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const orderIdText = url.pathname.split("/").pop();
      const orderId = Number(orderIdText);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json(
          { ok: false, error: "INVALID_ORDER_ID", message: "شناسه سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      const order = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
          "customer_address, province, city, street, sub_street, alley, plaque, " +
          "unit, postal_code, address_note, total, shipping_cost, shipping_method_id, " +
          "shipping_method_name, shipping_is_cod, payable_amount, status, payment_status, " +
          "payment_reference, postal_carrier, postal_tracking_code, created_at, updated_at " +
          "FROM orders WHERE id = ? LIMIT 1"
        )
        .bind(orderId)
        .first();

      if (!order) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش پیدا نشد." },
          { status: 404 }
        );
      }

      const itemsResult = await env.DB
        .prepare(
          "SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.price, oi.quantity, " +
          "oi.subtotal, oi.created_at, p.image AS product_image, " +
          "(SELECT pi.image FROM product_images pi WHERE pi.product_id = oi.product_id " +
          "ORDER BY pi.sort_order ASC, pi.id ASC LIMIT 1) AS gallery_image " +
          "FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id " +
          "WHERE oi.order_id = ? ORDER BY oi.id ASC"
        )
        .bind(orderId)
        .all();

      const historyResult = await env.DB
        .prepare(
          "SELECT id, status, note, created_at FROM order_status_history " +
          "WHERE order_id = ? ORDER BY id ASC"
        )
        .bind(orderId)
        .all();

      order.items = (itemsResult.results || []).map((item) => {
        const rawImage = item.product_image || item.gallery_image || null;
        const { gallery_image, ...rest } = item;
        return { ...rest, product_image: rawImage ? resolveAbsoluteProductImageUrl(rawImage) : null };
      });
      order.status_history = historyResult.results || [];
      order.customer_address = composeAddressText(order);
      order.is_guest = !order.customer_id;

      // مشاهده جزئیات سفارش توسط مدیر یعنی «دیده شد» — اعلان مربوطه
      // (در صورت وجود) خوانده‌شده علامت می‌خورد. هرگز نباید کل درخواست را
      // خراب کند (مثلاً وقتی Migration مربوطه هنوز اجرا نشده).
      try {
        await env.DB
          .prepare("UPDATE order_notifications SET is_read = 1, read_at = ? WHERE order_id = ? AND is_read = 0")
          .bind(nowIso(), orderId)
          .run();
      } catch (notifError) {
        console.error("[order-notifications] علامت‌گذاری خوانده‌شده ممکن نشد:", notifError.message);
      }

      return Response.json({ ok: true, order });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Admin Orders - Change Status / Postal Info
  // =========================

  if (
    url.pathname.startsWith("/api/store/orders/") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json(
        { ok: false, error: "UNAUTHORIZED", message: "رمز مدیریت صحیح نیست." },
        { status: 401 }
      );
    }

    try {
      const orderIdText = url.pathname.split("/").pop();
      const orderId = Number(orderIdText);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json(
          { ok: false, error: "INVALID_ORDER_ID", message: "شناسه سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      const body = await request.json();
      const status = String(body.status || "").trim();
      const postalCarrier = body.postal_carrier != null ? String(body.postal_carrier).trim() : null;
      const postalTrackingCode = body.postal_tracking_code != null
        ? String(body.postal_tracking_code).trim()
        : null;
      const paymentStatus = body.payment_status != null ? String(body.payment_status).trim() : null;
      const note = body.note != null ? String(body.note).trim() : null;

      if (!ALLOWED_STATUSES.includes(status)) {
        return Response.json(
          { ok: false, error: "INVALID_STATUS", message: "وضعیت سفارش نامعتبر است." },
          { status: 400 }
        );
      }

      if (paymentStatus && !ALLOWED_PAYMENT_STATUSES.includes(paymentStatus)) {
        return Response.json(
          { ok: false, error: "INVALID_PAYMENT_STATUS", message: "وضعیت پرداخت نامعتبر است." },
          { status: 400 }
        );
      }

      const existingOrder = await env.DB
        .prepare(
          "SELECT id, status, customer_phone, tracking_code, postal_carrier, postal_tracking_code " +
          "FROM orders WHERE id = ? LIMIT 1"
        )
        .bind(orderId)
        .first();

      if (!existingOrder) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE orders SET status = ?, " +
          "postal_carrier = COALESCE(?, postal_carrier), " +
          "postal_tracking_code = COALESCE(?, postal_tracking_code), " +
          "payment_status = COALESCE(?, payment_status), " +
          "updated_at = ? " +
          "WHERE id = ?"
        )
        .bind(
          status,
          postalCarrier || null,
          postalTrackingCode || null,
          paymentStatus || null,
          nowIso(),
          orderId
        )
        .run();

      if (!result.meta?.changes) {
        return Response.json(
          { ok: false, error: "ORDER_NOT_FOUND", message: "سفارش موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      await env.DB
        .prepare(
          "INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)"
        )
        .bind(orderId, status, note || null)
        .run();

      // تغییر وضعیت یعنی مدیر سفارش را دیده و رسیدگی کرده — اعلان مربوطه
      // خوانده‌شده می‌شود (از جمله وقتی سفارش لغو می‌شود، دیگر «جدید»
      // محسوب نمی‌شود، صرف‌نظر از اینکه قبلاً دیده شده بود یا نه).
      try {
        await env.DB
          .prepare("UPDATE order_notifications SET is_read = 1, read_at = ? WHERE order_id = ? AND is_read = 0")
          .bind(nowIso(), orderId)
          .run();
      } catch (notifError) {
        console.error("[order-notifications] علامت‌گذاری خوانده‌شده ممکن نشد:", notifError.message);
      }

      if (status !== existingOrder.status) {
        const label = STATUS_LABELS[status] || status;
        let message = `سفارش ${existingOrder.tracking_code || orderId}: وضعیت به «${label}» تغییر کرد.`;

        if (status === "shipped" && postalTrackingCode) {
          message += ` کد مرسوله پستی: ${postalTrackingCode}`;
        }

        await queueSms(env, orderId, existingOrder.customer_phone, "status_changed", message);

        // --- Central SMS Service (بخش ۱۹) — علاوه بر queueSms قدیمی که
        // دست‌نخورده باقی مانده، اکنون Template واقعی برای این وضعیت‌ها
        // وجود دارد، پس Event واقعی هم به سرویس مرکزی داده می‌شود.
        try {
          let smsEventType = ORDER_STATUS_SMS_EVENT_MAP[status];
          let smsVariables = { ORDER_ID: existingOrder.tracking_code || String(orderId) };

          if (status === "shipped") {
            const effectiveTrackingCode = postalTrackingCode || existingOrder.postal_tracking_code || "";
            const effectiveCarrier = postalCarrier || existingOrder.postal_carrier || "";

            if (effectiveTrackingCode) {
              smsEventType = "ORDER_SHIPPED";
              smsVariables = { ...smsVariables, CARRIER: effectiveCarrier, TRACKING_CODE: effectiveTrackingCode };
            } else {
              smsEventType = "ORDER_SHIPPED_NO_TRACKING";
              smsVariables = { ...smsVariables, CARRIER: effectiveCarrier };
            }
          }

          if (smsEventType && existingOrder.customer_phone) {
            const customerRow = await env.DB
              .prepare("SELECT id FROM customers WHERE phone = ? LIMIT 1")
              .bind(existingOrder.customer_phone)
              .first();

            await sendSms(env, {
              mobile: existingOrder.customer_phone,
              eventType: smsEventType,
              variables: smsVariables,
              customerId: customerRow?.id || null,
              purpose: "order_status",
            });
          }
        } catch (smsError) {
          // ارسال پیامک سفارش هرگز نباید باعث شکست خود درخواست تغییر وضعیت سفارش شود.
          console.error("Order status SMS (central service) failed:", smsError.message);
        }
      }

      return Response.json({
        ok: true,
        message: "وضعیت سفارش با موفقیت تغییر کرد.",
        order_id: orderId,
        status,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Products - Create
  // =========================

  if (url.pathname === "/api/store/products" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();

      const name = String(body.name || "").trim();
      const slug = String(body.slug || "").trim();
      const description = sanitizeDescriptionHtml(String(body.description || "").trim());
      const image = String(body.image || "").trim();
      const price = Number(body.price);
      const stock = Number(body.stock);
      const active = body.active === false ? 0 : 1;

      // فیلدهای جدید — همگی اختیاری (بخش ۱ دستور)
      const brand = body.brand != null ? String(body.brand).trim() : null;
      const model = body.model != null ? String(body.model).trim() : null;
      const sku = body.sku != null ? String(body.sku).trim() : null;
      const compareAtPrice =
        body.compare_at_price != null && body.compare_at_price !== ""
          ? Number(body.compare_at_price)
          : null;
      const shippingCost =
        body.shipping_cost != null && body.shipping_cost !== "" ? Number(body.shipping_cost) : null;
      const shippingMethod = body.shipping_method != null ? String(body.shipping_method).trim() || null : null;
      const shippingTime = body.shipping_time != null ? String(body.shipping_time).trim() || null : null;
      const warrantyMonths =
        body.warranty_months != null && body.warranty_months !== "" ? Number(body.warranty_months) : null;
      const warrantyProvider =
        body.warranty_provider != null ? String(body.warranty_provider).trim() || null : null;
      const returnDays =
        body.return_days != null && body.return_days !== "" ? Number(body.return_days) : null;

      // دسته‌بندی — کاملاً اختیاری (بخش دسته‌بندی محصولات). NULL یعنی
      // «بدون دسته»، دقیقاً همان رفتار محصولات فعلی قبل از این قابلیت.
      const categoryId =
        body.category_id != null && body.category_id !== "" ? Number(body.category_id) : null;

      if (categoryId != null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "دسته انتخاب‌شده نامعتبر است." },
          { status: 400 }
        );
      }

      if (categoryId != null) {
        const categoryRow = await env.DB
          .prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
          .bind(categoryId)
          .first();
        if (!categoryRow) {
          return Response.json(
            { ok: false, error: "CATEGORY_NOT_FOUND", message: "دسته انتخاب‌شده پیدا نشد." },
            { status: 400 }
          );
        }
      }

      if (!name || !slug) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "نام محصول و شناسه محصول الزامی است." },
          { status: 400 }
        );
      }

      if (!Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند." },
          { status: 400 }
        );
      }

      if (compareAtPrice != null && (!Number.isInteger(compareAtPrice) || compareAtPrice < 0)) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت قبل از تخفیف نامعتبر است." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "INSERT INTO products " +
          "(name, slug, description, price, image, stock, active, brand, model, sku, compare_at_price, " +
          "shipping_cost, shipping_method, shipping_time, warranty_months, warranty_provider, return_days, " +
          "category_id) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          name, slug, description, price, image, stock, active,
          brand, model, sku, compareAtPrice,
          shippingCost, shippingMethod, shippingTime, warrantyMonths, warrantyProvider, returnDays,
          categoryId
        )
        .run();

      const productId = result.meta?.last_row_id ?? null;

      const images = Array.isArray(body.images) ? body.images : [];

      for (let i = 0; i < images.length; i++) {
        // هر ردیف می‌تواند یک رشته ساده (سازگاری با فرم فعلی) یا
        // { image, alt } باشد.
        const entry = images[i];
        const imagePath = String((typeof entry === "string" ? entry : entry?.image) || "").trim();
        const alt = typeof entry === "object" && entry?.alt ? String(entry.alt).trim() : null;
        if (!imagePath) continue;

        await env.DB
          .prepare(
            "INSERT INTO product_images (product_id, image, alt, sort_order) VALUES (?, ?, ?, ?)"
          )
          .bind(productId, imagePath, alt, i)
          .run();
      }

      const specs = Array.isArray(body.specs) ? body.specs : [];

      for (let i = 0; i < specs.length; i++) {
        const label = String(specs[i]?.label || "").trim();
        const value = String(specs[i]?.value || "").trim();
        if (!label || !value) continue;

        await env.DB
          .prepare(
            "INSERT INTO product_specs (product_id, label, value, sort_order) VALUES (?, ?, ?, ?)"
          )
          .bind(productId, label, value, i)
          .run();
      }

      return Response.json(
        { ok: true, message: "محصول با موفقیت ثبت شد.", product_id: productId },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // Products - Update
  // =========================

  if (url.pathname === "/api/store/products" && request.method === "PUT") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();

      const id = Number(body.id);
      const name = String(body.name || "").trim();
      const slug = body.slug != null ? String(body.slug).trim() : "";
      const description = sanitizeDescriptionHtml(String(body.description || "").trim());
      const image = String(body.image || "").trim();
      const price = Number(body.price);
      const stock = Number(body.stock);
      const active = body.active === false ? 0 : 1;

      const brand = body.brand != null ? String(body.brand).trim() : null;
      const model = body.model != null ? String(body.model).trim() : null;
      const sku = body.sku != null ? String(body.sku).trim() : null;
      const compareAtPrice =
        body.compare_at_price != null && body.compare_at_price !== ""
          ? Number(body.compare_at_price)
          : null;
      const shippingCost =
        body.shipping_cost != null && body.shipping_cost !== "" ? Number(body.shipping_cost) : null;
      const shippingMethod = body.shipping_method != null ? String(body.shipping_method).trim() || null : null;
      const shippingTime = body.shipping_time != null ? String(body.shipping_time).trim() || null : null;
      const warrantyMonths =
        body.warranty_months != null && body.warranty_months !== "" ? Number(body.warranty_months) : null;
      const warrantyProvider =
        body.warranty_provider != null ? String(body.warranty_provider).trim() || null : null;
      const returnDays =
        body.return_days != null && body.return_days !== "" ? Number(body.return_days) : null;

      const categoryId =
        body.category_id != null && body.category_id !== "" ? Number(body.category_id) : null;

      if (categoryId != null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "دسته انتخاب‌شده نامعتبر است." },
          { status: 400 }
        );
      }

      if (categoryId != null) {
        const categoryRow = await env.DB
          .prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
          .bind(categoryId)
          .first();
        if (!categoryRow) {
          return Response.json(
            { ok: false, error: "CATEGORY_NOT_FOUND", message: "دسته انتخاب‌شده پیدا نشد." },
            { status: 400 }
          );
        }
      }

      if (!Number.isInteger(id) || id <= 0 || !name) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "شناسه و نام محصول الزامی است." },
          { status: 400 }
        );
      }

      if (!Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت و موجودی باید عدد صحیح صفر یا بیشتر باشند." },
          { status: 400 }
        );
      }

      if (compareAtPrice != null && (!Number.isInteger(compareAtPrice) || compareAtPrice < 0)) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "قیمت قبل از تخفیف نامعتبر است." },
          { status: 400 }
        );
      }

      if (slug) {
        const slugOwner = await env.DB
          .prepare("SELECT id FROM products WHERE slug = ? AND id != ? LIMIT 1")
          .bind(slug, id)
          .first();

        if (slugOwner) {
          return Response.json(
            { ok: false, error: "SLUG_TAKEN", message: "این شناسه (Slug) قبلاً برای محصول دیگری استفاده شده است." },
            { status: 400 }
          );
        }
      }

      // اگر slug ارسال نشود (تماس‌های قدیمی)، مقدار فعلی حفظ می‌شود.
      const result = await env.DB
        .prepare(
          "UPDATE products SET name = ?, slug = COALESCE(NULLIF(?, ''), slug), " +
          "description = ?, price = ?, image = ?, stock = ?, active = ?, " +
          "brand = ?, model = ?, sku = ?, compare_at_price = ?, " +
          "shipping_cost = ?, shipping_method = ?, shipping_time = ?, " +
          "warranty_months = ?, warranty_provider = ?, return_days = ?, category_id = ? WHERE id = ?"
        )
        .bind(
          name, slug, description, price, image, stock, active,
          brand, model, sku, compareAtPrice,
          shippingCost, shippingMethod, shippingTime, warrantyMonths, warrantyProvider, returnDays,
          categoryId,
          id
        )
        .run();

      if (!result.meta?.changes) {
        return Response.json(
          { ok: false, error: "PRODUCT_NOT_FOUND", message: "محصول موردنظر پیدا نشد." },
          { status: 404 }
        );
      }

      if (Array.isArray(body.images)) {
        await env.DB
          .prepare("DELETE FROM product_images WHERE product_id = ?")
          .bind(id)
          .run();

        for (let i = 0; i < body.images.length; i++) {
          const entry = body.images[i];
          const imagePath = String((typeof entry === "string" ? entry : entry?.image) || "").trim();
          const alt = typeof entry === "object" && entry?.alt ? String(entry.alt).trim() : null;
          if (!imagePath) continue;

          await env.DB
            .prepare(
              "INSERT INTO product_images (product_id, image, alt, sort_order) VALUES (?, ?, ?, ?)"
            )
            .bind(id, imagePath, alt, i)
            .run();
        }
      }

      if (Array.isArray(body.specs)) {
        await env.DB
          .prepare("DELETE FROM product_specs WHERE product_id = ?")
          .bind(id)
          .run();

        for (let i = 0; i < body.specs.length; i++) {
          const label = String(body.specs[i]?.label || "").trim();
          const value = String(body.specs[i]?.value || "").trim();
          if (!label || !value) continue;

          await env.DB
            .prepare(
              "INSERT INTO product_specs (product_id, label, value, sort_order) VALUES (?, ?, ?, ?)"
            )
            .bind(id, label, value, i)
            .run();
        }
      }

      return Response.json({ ok: true, message: "محصول با موفقیت ویرایش شد.", product_id: id });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // دسته‌بندی محصولات — مدیریت (فقط Admin). زیرساخت آماده و قابل توسعه؛
  // نمایش عمومی آن با پرچم show_categories_public کنترل می‌شود (فعلاً خاموش).
  // =========================================================================

  // GET /api/store/admin/categories — لیست کامل (تخت) + تعداد محصول هر دسته
  if (url.pathname === "/api/store/admin/categories" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const categories = await getCategoriesFlat();

      const countsResult = await env.DB
        .prepare("SELECT category_id, COUNT(*) AS c FROM products WHERE category_id IS NOT NULL GROUP BY category_id")
        .all();
      const countsByCategory = new Map((countsResult.results || []).map((row) => [Number(row.category_id), row.c]));

      for (const category of categories) {
        category.product_count = countsByCategory.get(Number(category.id)) || 0;
      }

      return Response.json({ ok: true, categories });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "CATEGORIES_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول دسته‌بندی هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/categories-and-relations.sql) را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // POST /api/store/admin/categories — ایجاد دسته/زیردسته جدید
  if (url.pathname === "/api/store/admin/categories" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const name = String(body.name || "").trim();
      let slug = String(body.slug || "").trim();
      const parentId = body.parent_id != null && body.parent_id !== "" ? Number(body.parent_id) : null;
      const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
      const active = body.active === false ? 0 : 1;

      if (!name) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "نام دسته الزامی است." }, { status: 400 });
      }

      if (!slug) {
        slug = name
          .trim()
          .replace(/\s+/g, "-");
      }

      if (parentId != null) {
        const parentRow = await env.DB.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1").bind(parentId).first();
        if (!parentRow) {
          return Response.json({ ok: false, error: "PARENT_NOT_FOUND", message: "دسته والد پیدا نشد." }, { status: 400 });
        }
      }

      const slugOwner = await env.DB.prepare("SELECT id FROM categories WHERE slug = ? LIMIT 1").bind(slug).first();
      if (slugOwner) {
        return Response.json(
          { ok: false, error: "SLUG_TAKEN", message: "این شناسه (Slug) قبلاً برای دسته دیگری استفاده شده است." },
          { status: 400 }
        );
      }

      const timestamp = nowIso();
      const result = await env.DB
        .prepare(
          "INSERT INTO categories (name, slug, parent_id, sort_order, active, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(name, slug, parentId, sortOrder, active, timestamp, timestamp)
        .run();

      return Response.json(
        { ok: true, message: "دسته با موفقیت ایجاد شد.", category_id: result.meta?.last_row_id ?? null },
        { status: 201 }
      );
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "CATEGORIES_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول دسته‌بندی هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/categories-and-relations.sql) را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // PUT /api/store/admin/categories — ویرایش نام/Slug/والد/ترتیب/فعال‌بودن
  if (url.pathname === "/api/store/admin/categories" && request.method === "PUT") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const id = Number(body.id);
      const name = String(body.name || "").trim();
      const slug = String(body.slug || "").trim();
      const parentId = body.parent_id != null && body.parent_id !== "" ? Number(body.parent_id) : null;
      const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
      const active = body.active === false ? 0 : 1;

      if (!Number.isInteger(id) || id <= 0 || !name || !slug) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "شناسه، نام و Slug دسته الزامی است." },
          { status: 400 }
        );
      }

      if (parentId != null) {
        if (parentId === id) {
          return Response.json(
            { ok: false, error: "INVALID_PARENT", message: "یک دسته نمی‌تواند والد خودش باشد." },
            { status: 400 }
          );
        }
        const parentRow = await env.DB.prepare("SELECT id, parent_id FROM categories WHERE id = ? LIMIT 1").bind(parentId).first();
        if (!parentRow) {
          return Response.json({ ok: false, error: "PARENT_NOT_FOUND", message: "دسته والد پیدا نشد." }, { status: 400 });
        }
        // جلوگیری از حلقه ساده (والد جدید، خودش فرزند این دسته نباشد)
        if (Number(parentRow.parent_id) === id) {
          return Response.json(
            { ok: false, error: "CIRCULAR_PARENT", message: "این تغییر باعث حلقه در ساختار دسته‌ها می‌شود." },
            { status: 400 }
          );
        }
      }

      const slugOwner = await env.DB
        .prepare("SELECT id FROM categories WHERE slug = ? AND id != ? LIMIT 1")
        .bind(slug, id)
        .first();
      if (slugOwner) {
        return Response.json(
          { ok: false, error: "SLUG_TAKEN", message: "این شناسه (Slug) قبلاً برای دسته دیگری استفاده شده است." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE categories SET name = ?, slug = ?, parent_id = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?"
        )
        .bind(name, slug, parentId, sortOrder, active, nowIso(), id)
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "CATEGORY_NOT_FOUND", message: "دسته موردنظر پیدا نشد." }, { status: 404 });
      }

      return Response.json({ ok: true, message: "دسته با موفقیت ویرایش شد." });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // DELETE /api/store/admin/categories?id=..&reassign_to=.. — حذف امن:
  // اگر دسته دارای محصول یا زیردسته باشد و reassign_to داده نشده باشد، حذف
  // انجام نمی‌شود (پیام واضح با تعداد وابسته‌ها). با دادن reassign_to، همه
  // محصولات و زیردسته‌ها قبل از حذف به دسته مقصد منتقل می‌شوند — بدون حذف یا
  // ورود مجدد هیچ محصولی.
  if (url.pathname === "/api/store/admin/categories" && request.method === "DELETE") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const id = Number(url.searchParams.get("id"));
      const reassignToRaw = url.searchParams.get("reassign_to");
      const reassignTo = reassignToRaw != null && reassignToRaw !== "" ? Number(reassignToRaw) : null;

      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "شناسه دسته نامعتبر است." }, { status: 400 });
      }

      if (reassignTo != null && reassignTo === id) {
        return Response.json(
          { ok: false, error: "INVALID_DATA", message: "دسته مقصد نمی‌تواند همان دسته حذف‌شونده باشد." },
          { status: 400 }
        );
      }

      if (reassignTo != null) {
        const targetRow = await env.DB.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1").bind(reassignTo).first();
        if (!targetRow) {
          return Response.json({ ok: false, error: "TARGET_NOT_FOUND", message: "دسته مقصد پیدا نشد." }, { status: 400 });
        }
      }

      const productCountRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM products WHERE category_id = ?")
        .bind(id)
        .first();
      const childCountRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM categories WHERE parent_id = ?")
        .bind(id)
        .first();

      const productCount = productCountRow?.c || 0;
      const childCount = childCountRow?.c || 0;

      if ((productCount > 0 || childCount > 0) && reassignTo == null) {
        return Response.json(
          {
            ok: false,
            error: "CATEGORY_HAS_DEPENDENTS",
            message: `این دسته ${productCount} محصول و ${childCount} زیردسته دارد. برای حذف، یک دسته مقصد برای انتقال آنها انتخاب کنید.`,
            product_count: productCount,
            child_count: childCount,
          },
          { status: 409 }
        );
      }

      if (reassignTo != null) {
        if (productCount > 0) {
          await env.DB.prepare("UPDATE products SET category_id = ? WHERE category_id = ?").bind(reassignTo, id).run();
        }
        if (childCount > 0) {
          await env.DB.prepare("UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?").bind(reassignTo, nowIso(), id).run();
        }
      }

      await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();

      return Response.json({ ok: true, message: "دسته با موفقیت حذف شد." });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================================================================
  // روش‌های ارسال — بخش ۴ دستور: مدیریت کامل از پنل مدیریت، بدون تغییر کد.
  // =========================================================================

  const SHIPPING_COST_TYPES = ["prepaid", "cod"];
  const SHIPPING_SCOPES = ["all", "city"];

  // GET /api/store/admin/shipping-methods — فهرست کامل (برای پنل مدیریت،
  // شامل روش‌های غیرفعال هم می‌شود تا قابل فعال‌سازی مجدد باشند).
  if (url.pathname === "/api/store/admin/shipping-methods" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, cost, cost_type, active, scope, allowed_city, sort_order, created_at, updated_at " +
          "FROM shipping_methods ORDER BY sort_order ASC, id ASC"
        )
        .all();

      return Response.json({ ok: true, shipping_methods: result.results || [] });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "SHIPPING_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول روش‌های ارسال هنوز ایجاد نشده است. ابتدا database/shipping-methods.sql را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // POST /api/store/admin/shipping-methods — ایجاد روش ارسال جدید
  if (url.pathname === "/api/store/admin/shipping-methods" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const name = String(body.name || "").trim();
      const cost = Number(body.cost);
      const costType = String(body.cost_type || "prepaid").trim();
      const active = body.active === false ? 0 : 1;
      const scope = String(body.scope || "all").trim();
      const allowedCity = scope === "city" ? String(body.allowed_city || "").trim() : null;
      const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;

      if (!name) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "نام روش ارسال الزامی است." }, { status: 400 });
      }
      if (!Number.isFinite(cost) || cost < 0) {
        return Response.json({ ok: false, error: "INVALID_COST", message: "هزینه ارسال نامعتبر است." }, { status: 400 });
      }
      if (!SHIPPING_COST_TYPES.includes(costType)) {
        return Response.json({ ok: false, error: "INVALID_COST_TYPE", message: "نوع هزینه نامعتبر است." }, { status: 400 });
      }
      if (!SHIPPING_SCOPES.includes(scope)) {
        return Response.json({ ok: false, error: "INVALID_SCOPE", message: "محدوده نامعتبر است." }, { status: 400 });
      }
      if (scope === "city" && !allowedCity) {
        return Response.json(
          { ok: false, error: "MISSING_CITY", message: "برای محدوده «شهر مشخص»، نام شهر مجاز را وارد کنید." },
          { status: 400 }
        );
      }

      const timestamp = nowIso();
      const result = await env.DB
        .prepare(
          "INSERT INTO shipping_methods (name, cost, cost_type, active, scope, allowed_city, sort_order, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(name, Math.round(cost), costType, active, scope, allowedCity, sortOrder, timestamp, timestamp)
        .run();

      return Response.json(
        { ok: true, message: "روش ارسال با موفقیت ایجاد شد.", id: result.meta?.last_row_id ?? null },
        { status: 201 }
      );
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // PUT /api/store/admin/shipping-methods — ویرایش (شامل فعال/غیرفعال‌کردن)
  if (url.pathname === "/api/store/admin/shipping-methods" && request.method === "PUT") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const id = Number(body.id);
      const name = String(body.name || "").trim();
      const cost = Number(body.cost);
      const costType = String(body.cost_type || "prepaid").trim();
      const active = body.active === false ? 0 : 1;
      const scope = String(body.scope || "all").trim();
      const allowedCity = scope === "city" ? String(body.allowed_city || "").trim() : null;
      const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;

      if (!Number.isInteger(id) || id <= 0 || !name) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "شناسه و نام روش ارسال الزامی است." }, { status: 400 });
      }
      if (!Number.isFinite(cost) || cost < 0) {
        return Response.json({ ok: false, error: "INVALID_COST", message: "هزینه ارسال نامعتبر است." }, { status: 400 });
      }
      if (!SHIPPING_COST_TYPES.includes(costType)) {
        return Response.json({ ok: false, error: "INVALID_COST_TYPE", message: "نوع هزینه نامعتبر است." }, { status: 400 });
      }
      if (!SHIPPING_SCOPES.includes(scope)) {
        return Response.json({ ok: false, error: "INVALID_SCOPE", message: "محدوده نامعتبر است." }, { status: 400 });
      }
      if (scope === "city" && !allowedCity) {
        return Response.json(
          { ok: false, error: "MISSING_CITY", message: "برای محدوده «شهر مشخص»، نام شهر مجاز را وارد کنید." },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "UPDATE shipping_methods SET name = ?, cost = ?, cost_type = ?, active = ?, scope = ?, " +
          "allowed_city = ?, sort_order = ?, updated_at = ? WHERE id = ?"
        )
        .bind(name, Math.round(cost), costType, active, scope, allowedCity, sortOrder, nowIso(), id)
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "NOT_FOUND", message: "روش ارسال پیدا نشد." }, { status: 404 });
      }

      return Response.json({ ok: true, message: "روش ارسال با موفقیت ویرایش شد." });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // DELETE /api/store/admin/shipping-methods?id=.. — حذف امن: اگر سفارشی
  // قبلاً از این روش استفاده کرده، حذف رد می‌شود (تاریخچه سفارش نباید مبهم
  // شود)؛ در آن صورت فقط می‌توان آن را غیرفعال کرد (PUT با active=false).
  if (url.pathname === "/api/store/admin/shipping-methods" && request.method === "DELETE") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "شناسه نامعتبر است." }, { status: 400 });
      }

      const usedRow = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM orders WHERE shipping_method_id = ?")
        .bind(id)
        .first();
      const usedCount = usedRow?.c || 0;

      if (usedCount > 0) {
        return Response.json(
          {
            ok: false,
            error: "SHIPPING_METHOD_IN_USE",
            message: `این روش ارسال در ${usedCount} سفارش استفاده شده و قابل حذف نیست. به‌جای حذف، آن را غیرفعال کنید.`,
          },
          { status: 409 }
        );
      }

      const result = await env.DB.prepare("DELETE FROM shipping_methods WHERE id = ?").bind(id).run();
      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "NOT_FOUND", message: "روش ارسال پیدا نشد." }, { status: 404 });
      }

      return Response.json({ ok: true, message: "روش ارسال حذف شد." });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================================================================
  // قواعد ارسال اختصاصی هر محصول — بخش ۳/۴ ویرایش. گسترش همان جدول
  // shipping_methods (از طریق product_shipping_rates)، نه یک سیستم موازی.
  // =========================================================================

  // GET /api/store/admin/products/:id/shipping-rates — همه روش‌های فعال +
  // وضعیت اختصاصی این محصول برای هرکدام (اگر ردیفی نباشد یعنی «پیش‌فرض»).
  if (
    /^\/api\/store\/admin\/products\/\d+\/shipping-rates$/.test(url.pathname) &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const productId = Number(url.pathname.match(/\/products\/(\d+)\//)[1]);

      const methodsResult = await env.DB
        .prepare(
          "SELECT id, name, cost AS default_cost, cost_type, active FROM shipping_methods ORDER BY sort_order ASC, id ASC"
        )
        .all();

      const ratesResult = await env.DB
        .prepare(
          "SELECT shipping_method_id, is_allowed, custom_cost FROM product_shipping_rates WHERE product_id = ?"
        )
        .bind(productId)
        .all();

      const rateMap = new Map((ratesResult.results || []).map((r) => [r.shipping_method_id, r]));

      const rates = (methodsResult.results || []).map((method) => {
        const rate = rateMap.get(method.id);
        return {
          shipping_method_id: method.id,
          name: method.name,
          default_cost: method.default_cost,
          cost_type: method.cost_type,
          method_active: Number(method.active) === 1,
          is_allowed: rate ? Number(rate.is_allowed) === 1 : true,
          custom_cost: rate && rate.custom_cost != null ? rate.custom_cost : null,
        };
      });

      return Response.json({ ok: true, rates });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "SHIPPING_RATES_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول قواعد ارسال محصول هنوز ایجاد نشده. ابتدا database/product-shipping-rates.sql را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // PUT /api/store/admin/products/:id/shipping-rates — ذخیره یک‌جای قواعد.
  // ردیف‌هایی که دقیقاً حالت پیش‌فرض هستند (مجاز + بدون هزینه اختصاصی)
  // اصلاً ذخیره نمی‌شوند (حذف می‌شوند) تا جدول شلوغ نشود.
  if (
    /^\/api\/store\/admin\/products\/\d+\/shipping-rates$/.test(url.pathname) &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const productId = Number(url.pathname.match(/\/products\/(\d+)\//)[1]);
      const body = await request.json();
      const rates = Array.isArray(body.rates) ? body.rates : [];

      const timestamp = nowIso();

      for (const rate of rates) {
        const methodId = Number(rate.shipping_method_id);
        if (!Number.isInteger(methodId) || methodId <= 0) continue;

        const isAllowed = rate.is_allowed === false ? 0 : 1;
        const customCost =
          rate.custom_cost != null && rate.custom_cost !== "" && Number.isFinite(Number(rate.custom_cost))
            ? Math.round(Number(rate.custom_cost))
            : null;

        const isDefaultState = isAllowed === 1 && customCost === null;

        if (isDefaultState) {
          await env.DB
            .prepare("DELETE FROM product_shipping_rates WHERE product_id = ? AND shipping_method_id = ?")
            .bind(productId, methodId)
            .run();
          continue;
        }

        await env.DB
          .prepare(
            "INSERT INTO product_shipping_rates (product_id, shipping_method_id, is_allowed, custom_cost, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(product_id, shipping_method_id) DO UPDATE SET " +
            "is_allowed = excluded.is_allowed, custom_cost = excluded.custom_cost, updated_at = excluded.updated_at"
          )
          .bind(productId, methodId, isAllowed, customCost, timestamp, timestamp)
          .run();
      }

      return Response.json({ ok: true, message: "قواعد ارسال این محصول ذخیره شد." });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "SHIPPING_RATES_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول قواعد ارسال محصول هنوز ایجاد نشده. ابتدا database/product-shipping-rates.sql را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // منبع واحد محاسبه «روش‌های ارسال مجاز + هزینه واقعی» برای یک سبد از
  // محصولات و یک شهر مقصد — هم برآورد صفحه محصول/سبد، هم Checkout نهایی،
  // هر دو دقیقاً همین یک تابع را صدا می‌زنند (بدون سیستم موازی).
  //
  // تصمیم معماری (طبق درخواست، اینجا مستند شده): چون طبق ساختار فعلی سفارش
  // فقط یک روش ارسال مشترک برای کل سفارش ذخیره می‌شود (نه هزینه جدا برای
  // هر کالا)، وقتی چند محصول با هزینه‌های اختصاصی متفاوت برای همان روش در
  // سبد باشند، هزینه نهایی آن روش = بیشترین هزینه اختصاصی/پیش‌فرض در بین
  // همان محصولات (نه مجموع). این دقیقاً همان قاعده‌ای است که قبل از این
  // ویرایش هم برای هزینه ارسال ترکیبی استفاده می‌شد، فقط حالا هزینه هر
  // محصول از پنل مدیریت قابل تنظیم است، نه فقط از یک مقدار ثابت.
  //
  // اگر برای یک (محصول، روش ارسال) در product_shipping_rates ردیفی با
  // is_allowed=0 باشد، آن روش برای کل سبد (نه فقط آن محصول) از فهرست حذف
  // می‌شود — چون سفارش نمی‌تواند دو روش ارسال جدا داشته باشد.
  // =========================================================================
  async function resolveShippingOptionsForCart(env, productIds, city) {
    const uniqueProductIds = [
      ...new Set((productIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
    ];

    const methodsResult = await env.DB
      .prepare(
        "SELECT id, name, cost, cost_type, scope, allowed_city FROM shipping_methods " +
        "WHERE active = 1 ORDER BY sort_order ASC, id ASC"
      )
      .all();

    const destinationMethods = (methodsResult.results || []).filter((method) => {
      if (method.scope !== "city") return true;
      if (!city) return false;
      return String(method.allowed_city || "").trim() === city;
    });

    if (uniqueProductIds.length === 0) {
      return destinationMethods.map((m) => ({ ...m, cost: Number(m.cost) }));
    }

    let rateRows = [];
    try {
      const placeholders = uniqueProductIds.map(() => "?").join(",");
      const ratesResult = await env.DB
        .prepare(
          `SELECT product_id, shipping_method_id, is_allowed, custom_cost FROM product_shipping_rates ` +
          `WHERE product_id IN (${placeholders})`
        )
        .bind(...uniqueProductIds)
        .all();
      rateRows = ratesResult.results || [];
    } catch (error) {
      // Fail-Safe: اگر جدول قواعد اختصاصی هنوز Migrate نشده، همه محصولات از
      // هزینه پیش‌فرض همان روش ارسال استفاده می‌کنند (رفتار قبلی دست‌نخورده).
      rateRows = [];
    }

    const rateMap = new Map();
    for (const row of rateRows) {
      rateMap.set(`${row.product_id}:${row.shipping_method_id}`, row);
    }

    const options = [];
    for (const method of destinationMethods) {
      let allowed = true;
      let effectiveCost = 0;

      for (const productId of uniqueProductIds) {
        const rate = rateMap.get(`${productId}:${method.id}`);
        if (rate && Number(rate.is_allowed) === 0) {
          allowed = false;
          break;
        }
        const productCost = rate && rate.custom_cost != null ? Number(rate.custom_cost) : Number(method.cost);
        if (productCost > effectiveCost) effectiveCost = productCost;
      }

      if (allowed) {
        options.push({ ...method, cost: effectiveCost });
      }
    }

    return options;
  }

  // GET /api/store/shipping-methods?city=...&product_id=..&product_ids=1,2,3
  // — عمومی (صفحه محصول، سبد خرید، Checkout). فقط روش‌های فعال، مجاز برای
  // مقصد، و مجاز/با هزینه واقعی برای محصولات داده‌شده را برمی‌گرداند. روش
  // غیرفعال یا غیرمجاز، اصلاً در این پاسخ حاضر نمی‌شود (نه اینکه در
  // Frontend پنهان شود) — تا مشتری هرگز نتواند آن را انتخاب کند.
  if (url.pathname === "/api/store/shipping-methods" && request.method === "GET") {
    try {
      const city = String(url.searchParams.get("city") || "").trim();

      let productIds = [];
      const productIdsParam = url.searchParams.get("product_ids");
      const productIdParam = url.searchParams.get("product_id");
      if (productIdsParam) {
        productIds = productIdsParam.split(",").map((v) => Number(v.trim()));
      } else if (productIdParam) {
        productIds = [Number(productIdParam)];
      }

      const methods = await resolveShippingOptionsForCart(env, productIds, city);

      return Response.json({ ok: true, shipping_methods: methods });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      // Fail-Safe: اگر جدول هنوز Migrate نشده، فهرست خالی برمی‌گردد (نه
      // خطای ۵۰۰ که Checkout عمومی را کاملاً می‌شکند).
      if (isMissingTable) {
        return Response.json({ ok: true, shipping_methods: [] });
      }
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================================================================
  // روابط محصولات — مرتبط / مشابه / مکمل (فقط Admin برای مدیریت؛ نمایش
  // عمومی آن در endpoint محصول تکی، پشت پرچم‌های show_related_products و
  // show_similar_products کنترل می‌شود).
  // =========================================================================

  // GET /api/store/admin/product-relations?product_id=ID
  if (url.pathname === "/api/store/admin/product-relations" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const productId = Number(url.searchParams.get("product_id"));
      if (!Number.isInteger(productId) || productId <= 0) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "شناسه محصول نامعتبر است." }, { status: 400 });
      }

      const relations = await getProductRelationsGrouped(productId);
      const coPurchased = await getCoPurchasedProducts(productId, 10);

      return Response.json({ ok: true, relations, co_purchased: coPurchased });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "RELATIONS_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول روابط محصول هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/categories-and-relations.sql) را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // POST /api/store/admin/product-relations — { product_id, related_product_id, relation_type, sort_order? }
  if (url.pathname === "/api/store/admin/product-relations" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const productId = Number(body.product_id);
      const relatedProductId = Number(body.related_product_id);
      const relationType = String(body.relation_type || "").trim();
      const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;

      const ALLOWED_RELATION_TYPES = ["related", "similar", "complementary"];

      if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(relatedProductId) || relatedProductId <= 0) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "شناسه محصولات نامعتبر است." }, { status: 400 });
      }
      if (productId === relatedProductId) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "یک محصول نمی‌تواند با خودش رابطه داشته باشد." }, { status: 400 });
      }
      if (!ALLOWED_RELATION_TYPES.includes(relationType)) {
        return Response.json({ ok: false, error: "INVALID_RELATION_TYPE", message: "نوع رابطه نامعتبر است." }, { status: 400 });
      }

      const bothExist = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM products WHERE id IN (?, ?)")
        .bind(productId, relatedProductId)
        .first();
      if ((bothExist?.c || 0) !== 2) {
        return Response.json({ ok: false, error: "PRODUCT_NOT_FOUND", message: "یکی از محصولات پیدا نشد." }, { status: 404 });
      }

      await env.DB
        .prepare(
          "INSERT INTO product_relations (product_id, related_product_id, relation_type, sort_order) " +
          "VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(product_id, related_product_id, relation_type) DO UPDATE SET sort_order = excluded.sort_order"
        )
        .bind(productId, relatedProductId, relationType, sortOrder)
        .run();

      return Response.json({ ok: true, message: "رابطه با موفقیت ثبت شد." }, { status: 201 });
    } catch (error) {
      const isMissingTable = /no such table/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingTable ? "RELATIONS_TABLE_MISSING" : "DATABASE_ERROR",
          message: isMissingTable
            ? "جدول روابط محصول هنوز ایجاد نشده است. ابتدا Migration دیتابیس (database/categories-and-relations.sql) را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // DELETE /api/store/admin/product-relations?product_id=..&related_product_id=..&relation_type=..
  if (url.pathname === "/api/store/admin/product-relations" && request.method === "DELETE") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const productId = Number(url.searchParams.get("product_id"));
      const relatedProductId = Number(url.searchParams.get("related_product_id"));
      const relationType = String(url.searchParams.get("relation_type") || "").trim();

      if (!Number.isInteger(productId) || !Number.isInteger(relatedProductId) || !relationType) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "پارامترهای حذف رابطه ناقص است." }, { status: 400 });
      }

      await env.DB
        .prepare("DELETE FROM product_relations WHERE product_id = ? AND related_product_id = ? AND relation_type = ?")
        .bind(productId, relatedProductId, relationType)
        .run();

      return Response.json({ ok: true, message: "رابطه با موفقیت حذف شد." });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================================================================
  // پرچم‌های نمایش عمومی (Feature Flags) — فقط Admin. مقدار پیش‌فرض همه خاموش.
  // =========================================================================

  const FEATURE_FLAG_COLUMNS = [
    "show_categories_public",
    "show_related_products",
    "show_similar_products",
    "show_cart_suggestions",
  ];

  if (url.pathname === "/api/store/admin/feature-flags" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const flags = await getFeatureFlags(env);
    return Response.json({ ok: true, flags }, { headers: { "Cache-Control": "no-store" } });
  }

  if (url.pathname === "/api/store/admin/feature-flags" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const body = await request.json();
      const updates = [];
      const params = [];

      for (const column of FEATURE_FLAG_COLUMNS) {
        if (Object.prototype.hasOwnProperty.call(body, column)) {
          updates.push(`${column} = ?`);
          params.push(body[column] ? 1 : 0);
        }
      }

      if (updates.length === 0) {
        return Response.json({ ok: false, error: "INVALID_DATA", message: "هیچ پرچمی برای تغییر ارسال نشده است." }, { status: 400 });
      }

      await env.DB
        .prepare("INSERT INTO site_settings (id, store_status, services_status) VALUES (1, 'open', 'open') ON CONFLICT(id) DO NOTHING")
        .run();

      await env.DB.prepare(`UPDATE site_settings SET ${updates.join(", ")} WHERE id = 1`).bind(...params).run();

      const flags = await getFeatureFlags(env);
      return Response.json({ ok: true, flags });
    } catch (error) {
      const isMissingColumn = /no such column/i.test(error.message || "");
      return Response.json(
        {
          ok: false,
          error: isMissingColumn ? "FEATURE_FLAGS_MIGRATION_MISSING" : "DATABASE_ERROR",
          message: isMissingColumn
            ? "ستون‌های پرچم نمایش عمومی هنوز ایجاد نشده‌اند. ابتدا Migration دیتابیس (database/categories-and-relations.sql) را روی D1 اجرا کنید."
            : error.message,
        },
        { status: 500 }
      );
    }
  }

  // =========================================================================
  // GET /api/store/admin/products/search?q=.. — جست‌وجوی سبک محصول برای
  // انتخابگر «افزودن رابطه» در پنل مدیریت (فقط id/name/slug/image/active).
  // =========================================================================

  if (url.pathname === "/api/store/admin/products/search" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const q = (url.searchParams.get("q") || "").trim();
      const excludeId = Number(url.searchParams.get("exclude_id")) || 0;

      const conditions = ["id != ?"];
      const params = [excludeId];

      if (q) {
        conditions.push("(name LIKE ? OR slug LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }

      const result = await env.DB
        .prepare(
          `SELECT id, name, slug, image, price, active FROM products WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT 20`
        )
        .bind(...params)
        .all();

      return Response.json({ ok: true, products: result.results || [] });
    } catch (error) {
      return Response.json({ ok: false, error: "DATABASE_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================================================================
  // POST /api/store/cart/suggestions — عمومی؛ «پیشنهادهای تکمیلی سبد خرید»
  // (بخش ۸ دستور). فقط وقتی show_cart_suggestions روشن باشد چیزی برمی‌گردد؛
  // در غیر این صورت آرایه خالی — یعنی امروز هیچ تغییری در سبد خرید دیده
  // نمی‌شود، اما بک‌اند کاملاً آماده فعال‌سازی آینده است. دو منبع (روابط
  // مکمل تعریف‌شده توسط مدیر + آمار واقعی خرید مشترک) این‌جا در یک لیست
  // واحد و بدون تکرار ادغام می‌شوند.
  // =========================================================================

  if (url.pathname === "/api/store/cart/suggestions" && request.method === "POST") {
    try {
      const flags = await getFeatureFlags(env);
      if (!flags.show_cart_suggestions) {
        return Response.json({ ok: true, suggestions: [] });
      }

      const body = await request.json().catch(() => ({}));
      const cartProductIds = Array.isArray(body.product_ids)
        ? [...new Set(body.product_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
        : [];

      if (cartProductIds.length === 0) {
        return Response.json({ ok: true, suggestions: [] });
      }

      const suggestionsById = new Map();

      // منبع ۱: روابط «مکمل/همراه» تعریف‌شده دستی توسط مدیر
      for (const productId of cartProductIds) {
        const result = await env.DB
          .prepare(
            "SELECT p.id, p.name, p.slug, p.price, p.image, p.stock " +
            "FROM product_relations pr JOIN products p ON p.id = pr.related_product_id " +
            "WHERE pr.product_id = ? AND pr.relation_type = 'complementary' AND p.active = 1 AND p.stock > 0"
          )
          .bind(productId)
          .all();
        for (const row of result.results || []) {
          if (!cartProductIds.includes(Number(row.id))) suggestionsById.set(Number(row.id), row);
        }
      }

      // منبع ۲: آمار واقعی خرید مشترک (product_co_purchases)
      for (const productId of cartProductIds) {
        const coPurchased = await getCoPurchasedProducts(productId, 6);
        for (const row of coPurchased) {
          if (!cartProductIds.includes(Number(row.id)) && !suggestionsById.has(Number(row.id))) {
            suggestionsById.set(Number(row.id), row);
          }
        }
      }

      return Response.json({ ok: true, suggestions: [...suggestionsById.values()].slice(0, 8) });
    } catch (error) {
      // این endpoint هرگز نباید تجربه سبد خرید را مختل کند.
      console.error("[cart-suggestions] خطا:", error.message);
      return Response.json({ ok: true, suggestions: [] });
    }
  }

  // =========================
  // Product - Single
  // =========================

  if (url.pathname.startsWith("/api/store/products/")) {
    const slug = decodeURIComponent(url.pathname.split("/").pop());

    if (request.method !== "GET") {
      return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, name, slug, description, price, image, stock, " +
          "brand, model, sku, compare_at_price, shipping_cost, shipping_method, shipping_time, " +
          "warranty_months, warranty_provider, return_days, category_id " +
          "FROM products WHERE slug = ? AND active = 1 LIMIT 1"
        )
        .bind(slug)
        .first();

      if (!result) {
        return Response.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
      }

      const images = await getProductImages(result.id);

      result.images = images.length === 0 && result.image
        ? [{ id: null, image: result.image, sort_order: 0 }]
        : images;

      result.specs = await getProductSpecs(result.id);

      const formatRules = await getTechnicalFormatRules(env);
      applyTechnicalFormattingToProduct(result, formatRules);

      // زیرساخت «محصولات مرتبط/مشابه» — بخش ۸ دستور: فقط وقتی پرچم مربوطه
      // در پنل مدیریت روشن باشد این فیلدها پر می‌شوند؛ در غیر این صورت آرایه
      // خالی برمی‌گردد تا هیچ Frontend فعلی رفتار جدیدی نبیند (نمایش عمومی
      // فعلاً خاموش است، دقیقاً طبق دستور).
      const flags = await getFeatureFlags(env);
      let relatedProducts = [];
      let similarProducts = [];
      if (flags.show_related_products || flags.show_similar_products) {
        const grouped = await getProductRelationsGrouped(result.id);
        if (flags.show_related_products) relatedProducts = grouped.related;
        if (flags.show_similar_products) similarProducts = grouped.similar;
      }
      result.related_products = relatedProducts;
      result.similar_products = similarProducts;

      return Response.json({ ok: true, product: buildProductViewModel(result) });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // شمارش «در حال مشاهده این محصول» — فقط KV موقت، بدون تماس با D1
  // یک درخواست ترکیبی: هم heartbeat بازدیدکننده را تازه می‌کند و هم
  // شمار فعلی همان محصول را برمی‌گرداند، تا صفحه محصول به‌جای دو
  // درخواست جداگانه فقط یک درخواست هر ۴۵ ثانیه بزند.
  // POST /api/store/viewers/heartbeat  { slug, visitorId }
  // =========================

  if (url.pathname === "/api/store/viewers/heartbeat" && request.method === "POST") {
    // اگر KV متصل نباشد (مثلاً هنوز namespace ساخته نشده)، بدون خطا و
    // بدون تأثیر روی بقیه سایت، فقط شمارش را غیرفعال اعلام می‌کنیم.
    if (!env.VIEWERS_KV) {
      return Response.json({ ok: true, available: false, count: 0 });
    }

    try {
      const body = await request.json().catch(() => ({}));
      const slug = String(body.slug || "").trim().slice(0, 200);
      const visitorId = String(body.visitorId || "").trim().slice(0, 100);

      if (!slug || !visitorId) {
        return Response.json({ ok: true, available: false, count: 0 });
      }

      const key = `viewers:${slug}:${visitorId}`;

      // TTL حدود ۵ دقیقه: تا وقتی مرورگر هر ۴۵ ثانیه heartbeat بزند
      // کلید زنده می‌ماند؛ با بسته‌شدن تب/خروج کاربر، خودش بعد از حدود
      // ۵ دقیقه بدون هیچ عملیات پاک‌سازی دستی منقضی و حذف می‌شود.
      await env.VIEWERS_KV.put(key, "1", { expirationTtl: 300 });

      const list = await env.VIEWERS_KV.list({ prefix: `viewers:${slug}:` });
      const count = Array.isArray(list.keys) ? list.keys.length : 0;

      return Response.json({ ok: true, available: true, count });
    } catch (error) {
      // خطای KV هرگز نباید صفحه محصول یا بقیه سایت را مختل کند.
      return Response.json({ ok: true, available: false, count: 0 });
    }
  }

  // =========================
  // Checkout — ثبت سفارش واقعی
  // POST /api/store/checkout
  // =========================

  if (url.pathname === "/api/store/checkout" && request.method === "POST") {
    try {
      // --- گیت وضعیت عملیاتی فروشگاه (بخش ۹/۱۰ دستور توقف موقت) ---
      // Backend همیشه منبع حقیقت است؛ این بررسی قبل از هرگونه خواندن سبد،
      // کاهش موجودی یا INSERT سفارش انجام می‌شود. کاربری که پیش از Pause
      // شدن فروشگاه وارد Checkout شده باشد نیز همینجا رد می‌شود، چون این
      // بررسی روی خودِ درخواست ثبت نهایی انجام می‌شود، نه روی بارگذاری صفحه.
      const siteStatus = await getSiteStatus(env);
      if (!isOrderCreationAllowed(siteStatus)) {
        // «عدم توانایی در تشخیص وضعیت = عدم اجازه ایجاد سفارش» — چه فروشگاه
        // واقعاً Paused باشد و چه وضعیت اصلاً از D1 قابل خواندن نباشد (جدول
        // site_settings وجود ندارد، رکورد id=1 نیست، خطای D1)، در هر دو
        // حالت مسیر ایجاد سفارش همینجا و قبل از هر side effect دیگری بسته
        // می‌شود؛ هیچ INSERT سفارش، کاهش موجودی یا درخواست پرداختی رخ نمی‌دهد.
        return Response.json(
          {
            ok: false,
            error: "STORE_PAUSED",
            message: "ثبت سفارش جدید فروشگاه موقتاً متوقف شده است. لطفاً بعداً مجدداً مراجعه کنید.",
          },
          { status: 409 }
        );
      }

      const body = await request.json();
      const customer = body.customer || {};
      const items = Array.isArray(body.items) ? body.items : [];

      const customerName = String(customer.name || "").trim();
      const mobile = normalizeDigits(customer.mobile || customer.phone || "").trim();

      const address = {
        province: String(customer.province || "").trim(),
        city: String(customer.city || "").trim(),
        street: String(customer.street || "").trim(),
        sub_street: String(customer.sub_street || "").trim(),
        alley: String(customer.alley || "").trim(),
        plaque: String(customer.plaque || "").trim(),
        unit: String(customer.unit || "").trim(),
        postal_code: normalizeDigits(customer.postal_code || "").trim(),
        address_note: String(customer.address_note || "").trim(),
        latitude: customer.latitude != null && customer.latitude !== "" ? Number(customer.latitude) : null,
        longitude: customer.longitude != null && customer.longitude !== "" ? Number(customer.longitude) : null,
      };

      // --- اعتبارسنجی اطلاعات مشتری ---

      if (customerName.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست (مثال: 0912xxxxxxx)." },
          { status: 400 }
        );
      }

      // --- اعتبارسنجی آدرس (اجباری و کامل) ---

      const requiredAddressFields = ["province", "city", "street", "plaque"];
      for (const field of requiredAddressFields) {
        if (!address[field]) {
          return Response.json(
            {
              ok: false,
              error: "INCOMPLETE_ADDRESS",
              message: "آدرس ارسال باید کامل وارد شود.",
              field,
            },
            { status: 400 }
          );
        }
      }

      if (!isValidPostalCode(address.postal_code)) {
        return Response.json(
          { ok: false, error: "INVALID_POSTAL_CODE", message: "کد پستی باید دقیقاً ۱۰ رقم باشد." },
          { status: 400 }
        );
      }

      if (items.length === 0) {
        return Response.json(
          { ok: false, error: "EMPTY_CART", message: "سبد خرید خالی است." },
          { status: 400 }
        );
      }

      // --- ادغام اقلام تکراری و اعتبارسنجی اولیه هر قلم ---

      const mergedItems = new Map();
      for (const item of items) {
        const productId = Number(item.id ?? item.product_id);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
          return Response.json(
            { ok: false, error: "INVALID_ITEM", message: "اطلاعات یکی از کالاهای سفارش نامعتبر است." },
            { status: 400 }
          );
        }

        mergedItems.set(productId, (mergedItems.get(productId) || 0) + quantity);
      }

      // --- خواندن قیمت و موجودی واقعی از D1 (هرگز به اطلاعات مرورگر اعتماد نمی‌شود) ---

      const verifiedItems = [];
      let total = 0;

      for (const [productId, quantity] of mergedItems.entries()) {
        const product = await env.DB
          .prepare("SELECT id, name, price, stock, active FROM products WHERE id = ? LIMIT 1")
          .bind(productId)
          .first();

        if (!product || Number(product.active) !== 1) {
          return Response.json(
            { ok: false, error: "PRODUCT_NOT_AVAILABLE", message: "یکی از کالاهای سفارش دیگر قابل سفارش نیست." },
            { status: 400 }
          );
        }

        if (Number(product.stock) < quantity) {
          return Response.json(
            {
              ok: false,
              error: "INSUFFICIENT_STOCK",
              message: `موجودی «${product.name}» برای تعداد درخواستی کافی نیست.`,
            },
            { status: 409 }
          );
        }

        const price = Number(product.price) || 0;
        const subtotal = price * quantity;
        total += subtotal;

        verifiedItems.push({ productId: Number(product.id), productName: product.name, price, quantity, subtotal });
      }

      const itemsTotal = total;

      // --- روش ارسال — بخش ۴/۱ دستور: کل سفارش از یک روش ارسال مشترک استفاده
      // می‌کند (نه هر کالا جدا)، و هزینه/مجاز‌بودن آن همیشه سمت سرور، از روی
      // آدرس واقعی سفارش و قواعد ارسال واقعی محصولات سبد (نه از داده مرورگر
      // و نه از برآورد قبلی صفحه محصول/سبد) دوباره محاسبه می‌شود. ---

      const shippingMethodId = Number(body.shipping_method_id);
      if (!Number.isInteger(shippingMethodId) || shippingMethodId <= 0) {
        return Response.json(
          { ok: false, error: "SHIPPING_METHOD_REQUIRED", message: "لطفاً یک روش ارسال انتخاب کنید." },
          { status: 400 }
        );
      }

      const cartProductIds = verifiedItems.map((item) => item.productId);
      const availableShippingOptions = await resolveShippingOptionsForCart(env, cartProductIds, address.city);
      const shippingMethod = availableShippingOptions.find((m) => m.id === shippingMethodId);

      if (!shippingMethod) {
        return Response.json(
          {
            ok: false,
            error: "INVALID_SHIPPING_METHOD",
            message: "روش ارسال انتخاب‌شده برای این مقصد یا برای کالاهای سبد شما در دسترس نیست.",
          },
          { status: 400 }
        );
      }

      const shippingCost = Number(shippingMethod.cost) || 0;
      const shippingIsCod = shippingMethod.cost_type === "cod";

      total += shippingCost;

      // مبلغی که واقعاً باید به درگاه پرداخت ارسال شود (بخش ۵ دستور): اگر
      // روش ارسال پس‌کرایه باشد، هزینه ارسال از مبلغ آنلاین کسر می‌شود چون
      // نقداً توسط پیک/پست دریافت خواهد شد. total (جمع کامل سفارش برای
      // نمایش/فاکتور) هرگز از این بابت تغییر نمی‌کند.
      const payableAmount = itemsTotal + (shippingIsCod ? 0 : shippingCost);

      // --- کاهش اتمیک موجودی (هر UPDATE فقط وقتی موفق می‌شود که موجودی کافی باشد) ---
      // اگر یکی شکست بخورد، موجودیِ آیتم‌های قبلاً کاهش‌یافته برمی‌گردد (Rollback دستی).

      const decremented = [];
      let stockError = null;

      for (const item of verifiedItems) {
        const updateResult = await env.DB
          .prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
          .bind(item.quantity, item.productId, item.quantity)
          .run();

        if (!updateResult.meta?.changes) {
          stockError = item;
          break;
        }

        decremented.push(item);
      }

      if (stockError) {
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }

        return Response.json(
          {
            ok: false,
            error: "INSUFFICIENT_STOCK",
            message: `موجودی «${stockError.productName}» به‌تازگی تمام شده است. لطفاً سبد خرید را اصلاح کنید.`,
          },
          { status: 409 }
        );
      }

      // --- شناسایی مشتری واردشده به حساب کاربری (اختیاری) ---

      const sessionCustomer = await getSessionCustomer(request);
      const customerId = sessionCustomer ? sessionCustomer.id : null;

      // --- تولید کد پیگیری و ثبت سفارش ---

      let trackingCode;
      try {
        trackingCode = await generateTrackingCode();
      } catch (error) {
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }
        throw error;
      }

      const timestamp = nowIso();

      let orderId;
      try {
        const orderResult = await env.DB
          .prepare(
            "INSERT INTO orders (" +
            "tracking_code, customer_id, customer_name, customer_phone, customer_address, " +
            "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
            "latitude, longitude, total, shipping_cost, shipping_method_id, shipping_method_name, " +
            "shipping_is_cod, payable_amount, status, payment_status, created_at, updated_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            trackingCode,
            customerId,
            customerName,
            mobile,
            composeAddressText(address),
            address.province,
            address.city,
            address.street,
            address.sub_street,
            address.alley,
            address.plaque,
            address.unit || null,
            address.postal_code,
            address.address_note || null,
            address.latitude,
            address.longitude,
            total,
            shippingCost,
            shippingMethod.id,
            shippingMethod.name,
            shippingIsCod ? 1 : 0,
            payableAmount,
            "pending",
            "unpaid",
            timestamp,
            timestamp
          )
          .run();

        orderId = orderResult.meta?.last_row_id ?? null;
        if (!orderId) throw new Error("ORDER_ID_NOT_CREATED");

        for (const item of verifiedItems) {
          await env.DB
            .prepare(
              "INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal) " +
              "VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(orderId, item.productId, item.productName, item.price, item.quantity, item.subtotal)
            .run();
        }

        await env.DB
          .prepare("INSERT INTO order_status_history (order_id, status, note) VALUES (?, 'pending', ?)")
          .bind(orderId, "ثبت سفارش توسط مشتری")
          .run();

        // اعلان سفارش جدید برای پنل مدیریت — دقیقاً یک ردیف به‌ازای هر سفارش
        // (order_id UNIQUE در جدول order_notifications جلوی اعلان تکراری را
        // می‌گیرد، حتی اگر این کد به هر دلیلی دوباره اجرا شود).
        try {
          await env.DB
            .prepare("INSERT OR IGNORE INTO order_notifications (order_id, created_at, is_read) VALUES (?, ?, 0)")
            .bind(orderId, timestamp)
            .run();
        } catch (notifyError) {
          // اعلان صرفاً برای نمایش badge در پنل است؛ خطای آن هرگز نباید ثبت
          // سفارش واقعی مشتری را متوقف کند.
          console.error("[order-notifications] ثبت اعلان شکست خورد:", notifyError.message);
        }

        // زیرساخت «مشتریان همراه این محصول خریده‌اند» — به‌روزرسانی شمارنده
        // خرید مشترک بین اقلام همین سفارش. کاملاً غیربحرانی: خطای آن هرگز
        // باعث شکست ثبت سفارش نمی‌شود (خودِ تابع خطا را می‌بلعد و فقط لاگ می‌کند).
        await updateCoPurchases(env, verifiedItems.map((item) => item.productId), timestamp);
      } catch (error) {
        // اگر ثبت سفارش شکست خورد، موجودی کاهش‌یافته باید برگردد.
        for (const item of decremented) {
          await env.DB
            .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
            .bind(item.quantity, item.productId)
            .run();
        }
        throw error;
      }

      // --- ذخیره آدرس برای استفاده بعدی مشتری واردشده به حساب (اختیاری) ---

      if (customerId && body.save_address) {
        await env.DB
          .prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?")
          .bind(customerId)
          .run();

        await env.DB
          .prepare(
            "INSERT INTO customer_addresses (" +
            "customer_id, province, city, street, sub_street, alley, plaque, unit, " +
            "postal_code, address_note, latitude, longitude, is_default" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
          )
          .bind(
            customerId,
            address.province,
            address.city,
            address.street,
            address.sub_street,
            address.alley,
            address.plaque,
            address.unit || null,
            address.postal_code,
            address.address_note || null,
            address.latitude,
            address.longitude
          )
          .run();
      }

      await queueSms(
        env,
        orderId,
        mobile,
        "order_created",
        `سفارش شما با کد پیگیری ${trackingCode} ثبت شد. مبلغ: ${total.toLocaleString("fa-IR")} تومان.`
      );

      // --- Central SMS Service (بخش ۱۹) — علاوه بر queueSms قدیمی که
      // دست‌نخورده باقی مانده، Template واقعی ORDER_CREATED نیز فراخوانی می‌شود.
      try {
        await sendSms(env, {
          mobile,
          eventType: "ORDER_CREATED",
          variables: { ORDER_ID: trackingCode, AMOUNT: String(total) },
          customerId: customerId || null,
          purpose: "order_created",
        });
      } catch (smsError) {
        // ارسال پیامک هرگز نباید باعث شکست خود ثبت سفارش شود.
        console.error("Order created SMS (central service) failed:", smsError.message);
      }

      return Response.json(
        {
          ok: true,
          message: "سفارش شما با موفقیت ثبت شد.",
          order_id: orderId,
          tracking_code: trackingCode,
          total,
          shipping_cost: shippingCost,
          shipping_method_name: shippingMethod.name,
          shipping_is_cod: shippingIsCod,
          payable_amount: payableAmount,
          status: "pending",
          status_label: STATUS_LABELS.pending,
          created_at: timestamp,
          mobile,
        },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "ORDER_CREATE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  
// =========================
// پیگیری سفارش مهمان / هر مشتری
// GET /api/store/track?tracking_code=AP-XXXX&mobile=09xxxxxxxxx
// =========================

if (url.pathname === "/api/store/track" && request.method === "GET") {
  try {
    const trackingCode = (url.searchParams.get("tracking_code") || "")
      .trim()
      .toUpperCase();

    const mobile = normalizeDigits(
      url.searchParams.get("mobile") || ""
    ).trim();

    if (!trackingCode || !mobile) {
      return Response.json(
        {
          ok: false,
          error: "MISSING_PARAMS",
          message: "کد پیگیری و شماره موبایل را وارد کنید."
        },
        { status: 400 }
      );
    }

    const order = await env.DB
      .prepare(
        "SELECT id, tracking_code, customer_name, customer_phone, customer_address, " +
        "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
        "total, shipping_cost, shipping_method_name, shipping_is_cod, payable_amount, " +
        "status, payment_status, postal_carrier, postal_tracking_code, created_at " +
        "FROM orders WHERE tracking_code = ? AND customer_phone = ? LIMIT 1"
      )
      .bind(trackingCode, mobile)
      .first();

    if (!order) {
      return Response.json(
        {
          ok: false,
          error: "ORDER_NOT_FOUND",
          message: "سفارشی با این مشخصات پیدا نشد."
        },
        { status: 404 }
      );
    }

    const itemsResult = await env.DB
      .prepare(
        "SELECT " +
        "oi.product_name, " +
        "oi.price, " +
        "oi.quantity, " +
        "oi.subtotal, " +
        "p.image AS product_image, " +
        "(SELECT pi.image FROM product_images pi WHERE pi.product_id = oi.product_id " +
        "ORDER BY pi.sort_order ASC, pi.id ASC LIMIT 1) AS gallery_image " +
        "FROM order_items oi " +
        "LEFT JOIN products p ON p.id = oi.product_id " +
        "WHERE oi.order_id = ? " +
        "ORDER BY oi.id ASC"
      )
      .bind(order.id)
      .all();

    const historyResult = await env.DB
      .prepare(
        "SELECT status, created_at " +
        "FROM order_status_history WHERE order_id = ? ORDER BY id ASC"
      )
      .bind(order.id)
      .all();

    const invoiceItems = (itemsResult.results || []).map((item) => {
      const rawImage = item.product_image || item.gallery_image || null;
      const { gallery_image, ...rest } = item;
      return {
        ...rest,
        product_image: rawImage ? resolveAbsoluteProductImageUrl(rawImage) : null,
      };
    });

    return Response.json({
      ok: true,
      order: {
        tracking_code: order.tracking_code,

        // شماره فاکتور بر اساس شماره سفارش
        invoice_number: `INV-${String(order.id).padStart(6, "0")}`,

        customer_name: order.customer_name,
        mobile: order.customer_phone,
        postal_code: order.postal_code,

        address: composeAddressText(order),

        total: order.total,

        status: order.status,
        status_label:
          STATUS_LABELS[order.status] || order.status,

        payment_status: order.payment_status,
        payment_status_label:
          PAYMENT_STATUS_LABELS[order.payment_status] ||
          order.payment_status,

        postal_carrier: order.postal_carrier,
        postal_tracking_code: order.postal_tracking_code,

        created_at: order.created_at,

        items: invoiceItems,

        history: (historyResult.results || []).map((h) => ({
          status: h.status,
          status_label:
            STATUS_LABELS[h.status] || h.status,
          created_at: h.created_at
        }))
      }
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "DATABASE_ERROR",
        message: error.message
      },
      { status: 500 }
    );
  }
}
  // =========================
  // حساب مشتری — ثبت‌نام
  // =========================

  if (url.pathname === "/api/store/customers/register" && request.method === "POST") {
    try {
      const body = await request.json();
      const fullName = String(body.full_name || body.name || "").trim();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const password = String(body.password || "");

      if (fullName.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return Response.json(
          { ok: false, error: "WEAK_PASSWORD", message: "رمز عبور باید حداقل ۶ کاراکتر باشد." },
          { status: 400 }
        );
      }

      const existing = await env.DB
        .prepare("SELECT id FROM customers WHERE phone = ? LIMIT 1")
        .bind(mobile)
        .first();

      if (existing) {
        return Response.json(
          { ok: false, error: "PHONE_EXISTS", message: "این شماره موبایل قبلاً ثبت‌نام کرده است." },
          { status: 409 }
        );
      }

      const passwordHash = await hashPassword(password);

      const insertResult = await env.DB
        .prepare("INSERT INTO customers (full_name, phone, password_hash) VALUES (?, ?, ?)")
        .bind(fullName, mobile, passwordHash)
        .run();

      const customerId = insertResult.meta?.last_row_id;
      const token = await createCustomerSession(customerId);

      return Response.json(
        { ok: true, customer: { id: customerId, full_name: fullName, phone: mobile } },
        { status: 201, headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — ورود
  // =========================

  if (url.pathname === "/api/store/customers/login" && request.method === "POST") {
    try {
      const body = await request.json();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const password = String(body.password || "");

      const customer = await env.DB
        .prepare("SELECT id, full_name, phone, password_hash, is_active FROM customers WHERE phone = ? LIMIT 1")
        .bind(mobile)
        .first();

      const valid = customer ? await verifyPassword(password, customer.password_hash) : false;

      if (!customer || !valid) {
        return Response.json(
          { ok: false, error: "INVALID_CREDENTIALS", message: "شماره موبایل یا رمز عبور اشتباه است." },
          { status: 401 }
        );
      }

      // حساب غیرفعال‌شده توسط مدیر — بدون فاش‌کردن این وضعیت در پیام
      // INVALID_CREDENTIALS (تا اطلاعات اضافه‌ای درباره وجود حساب فاش نشود)،
      // اما با کد خطای مجزا تا Frontend بتواند پیام مناسب نشان دهد.
      if (Number(customer.is_active) === 0) {
        return Response.json(
          { ok: false, error: "ACCOUNT_DISABLED", message: "حساب کاربری شما غیرفعال شده است. لطفاً با پشتیبانی تماس بگیرید." },
          { status: 403 }
        );
      }

      const token = await createCustomerSession(customer.id);

      return Response.json(
        { ok: true, customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone } },
        { headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — خروج
  // =========================

  if (url.pathname === "/api/store/customers/logout" && request.method === "POST") {
    const cookies = parseCookies(request);
    const token = cookies[SESSION_COOKIE_NAME];

    if (token) {
      try {
        await env.DB.prepare("DELETE FROM customer_sessions WHERE token = ?").bind(token).run();
      } catch {
        // بی‌اثر بودن خطا در این مرحله مشکلی ایجاد نمی‌کند.
      }
    }

    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": buildClearSessionCookie(request) } }
    );
  }

  // =========================
  // حساب مشتری — وضعیت فعلی ورود
  // =========================

  if (url.pathname === "/api/store/customers/me" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, logged_in: false });
    }

    return Response.json({
      ok: true,
      logged_in: true,
      customer: { id: sessionCustomer.id, full_name: sessionCustomer.full_name, phone: sessionCustomer.phone },
    });
  }

  // =========================
  // حساب مشتری — OTP Engine (بخش ۸ تا ۱۳)
  // این دو endpoint موتور مرکزی OTP هستند و برای هر ۴ purpose استفاده می‌شوند:
  // register | login | password_reset | phone_change
  // منطق ثبت‌نام/ورود قدیمی (بالا) دست‌نخورده باقی می‌ماند؛ این‌ها قابلیت
  // افزوده هستند و frontend جدید از همین‌ها استفاده می‌کند.
  // =========================

  if (url.pathname === "/api/store/customers/otp/request" && request.method === "POST") {
    try {
      const body = await request.json();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const purpose = String(body.purpose || "").trim();

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (!OTP_PURPOSES.includes(purpose)) {
        return Response.json(
          { ok: false, error: "INVALID_PURPOSE", message: "نوع درخواست نامعتبر است." },
          { status: 400 }
        );
      }

      const enumerationSafe = OTP_ENUMERATION_SAFE_PURPOSES.includes(purpose);
      const genericSentResponse = () =>
        Response.json({
          ok: true,
          message: "در صورت معتبر بودن این شماره، کد تأیید برای آن ارسال شد.",
          expires_in: OTP_CODE_TTL_SECONDS,
        });

      let customer = await env.DB
        .prepare("SELECT id, full_name, phone, phone_verified FROM customers WHERE phone = ? LIMIT 1")
        .bind(mobile)
        .first();

      // --- اعتبارسنجی و منطق مخصوص هر purpose ---

      if (purpose === "register") {
        const fullName = String(body.full_name || body.name || "").trim();
        const password = String(body.password || "");

        if (fullName.length < 3) {
          return Response.json(
            { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
            { status: 400 }
          );
        }

        if (password.length < 6) {
          return Response.json(
            { ok: false, error: "WEAK_PASSWORD", message: "رمز عبور باید حداقل ۶ کاراکتر باشد." },
            { status: 400 }
          );
        }

        if (customer && customer.phone_verified) {
          return Response.json(
            { ok: false, error: "PHONE_EXISTS", message: "این شماره موبایل قبلاً ثبت‌نام کرده است." },
            { status: 409 }
          );
        }

        const passwordHash = await hashPassword(password);

        if (customer) {
          // تلاش ثبت‌نام قبلی هنوز تأیید نشده بود؛ اطلاعات را به‌روزرسانی می‌کنیم.
          await env.DB
            .prepare("UPDATE customers SET full_name = ?, password_hash = ?, updated_at = ? WHERE id = ?")
            .bind(fullName, passwordHash, nowIso(), customer.id)
            .run();
        } else {
          const insertResult = await env.DB
            .prepare(
              "INSERT INTO customers (full_name, phone, password_hash, phone_verified) VALUES (?, ?, ?, 0)"
            )
            .bind(fullName, mobile, passwordHash)
            .run();
          customer = { id: insertResult.meta?.last_row_id };
        }
      } else if (purpose === "login") {
        if (!customer) {
          return genericSentResponse();
        }
      } else if (purpose === "password_reset") {
        if (!customer) {
          return genericSentResponse();
        }
      } else if (purpose === "phone_change") {
        const sessionCustomer = await getSessionCustomer(request);
        if (!sessionCustomer) {
          return Response.json(
            { ok: false, error: "UNAUTHORIZED", message: "برای تغییر شماره ابتدا وارد حساب شوید." },
            { status: 401 }
          );
        }

        const owner = await env.DB
          .prepare("SELECT id FROM customers WHERE phone = ? AND id != ? LIMIT 1")
          .bind(mobile, sessionCustomer.id)
          .first();

        if (owner) {
          return Response.json(
            { ok: false, error: "PHONE_EXISTS", message: "این شماره متعلق به حساب دیگری است." },
            { status: 409 }
          );
        }

        customer = { id: sessionCustomer.id };
      }

      // --- Rate limit: فاصله حداقل بین دو ارسال (resend cooldown) ---

      const lastRow = await env.DB
        .prepare(
          "SELECT created_at FROM otp_codes WHERE mobile = ? AND purpose = ? ORDER BY id DESC LIMIT 1"
        )
        .bind(mobile, purpose)
        .first();

      if (lastRow) {
        const elapsedSeconds = (Date.now() - new Date(lastRow.created_at).getTime()) / 1000;
        if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
          if (enumerationSafe) return genericSentResponse();
          return Response.json(
            {
              ok: false,
              error: "RESEND_COOLDOWN",
              message: `لطفاً ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds)} ثانیه دیگر دوباره تلاش کنید.`,
            },
            { status: 429 }
          );
        }
      }

      // --- Rate limit: حداکثر تعداد درخواست در یک ساعت ---

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const countRow = await env.DB
        .prepare(
          "SELECT COUNT(*) AS c FROM otp_codes WHERE mobile = ? AND purpose = ? AND created_at > ?"
        )
        .bind(mobile, purpose, hourAgo)
        .first();

      if ((countRow?.c || 0) >= OTP_MAX_REQUESTS_PER_HOUR) {
        if (enumerationSafe) return genericSentResponse();
        return Response.json(
          {
            ok: false,
            error: "RATE_LIMITED",
            message: "تعداد درخواست‌های شما بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
          },
          { status: 429 }
        );
      }

      // --- تولید، hash، و ذخیره OTP ---

      const code = generateOtpCode();
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + OTP_CODE_TTL_SECONDS * 1000).toISOString();

      await env.DB
        .prepare(
          "INSERT INTO otp_codes (mobile, code_hash, purpose, expires_at, status) VALUES (?, ?, ?, ?, 'pending')"
        )
        .bind(mobile, codeHash, purpose, expiresAt)
        .run();

      // --- ارسال از طریق Central SMS Service ---
      // هر purpose اکنون Template اختصاصی و واقعی خودش را دارد (بخش ۴ دستور).

      const eventType = OTP_PURPOSE_EVENT_TYPES[purpose];

      try {
        await sendSms(env, {
          mobile,
          eventType,
          variables: { CODE: code },
          customerId: customer?.id || null,
          purpose,
        });
      } catch (smsError) {
        // برای login/password_reset هرگز جزئیات خطای provider را افشا نمی‌کنیم
        // (enumeration protection) — فقط برای register/phone_change که وجود
        // حساب از قبل مشخص است، خطای واقعی را برمی‌گردانیم.
        console.error("OTP SMS send failed:", smsError.message);
        if (enumerationSafe) return genericSentResponse();
        return Response.json(
          { ok: false, error: "SMS_SEND_FAILED", message: "ارسال پیامک ناموفق بود. لطفاً بعداً تلاش کنید." },
          { status: 502 }
        );
      }

      if (enumerationSafe) return genericSentResponse();

      return Response.json({
        ok: true,
        message: "کد تأیید ارسال شد.",
        expires_in: OTP_CODE_TTL_SECONDS,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "SERVER_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  if (url.pathname === "/api/store/customers/otp/verify" && request.method === "POST") {
    try {
      const body = await request.json();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const purpose = String(body.purpose || "").trim();
      const code = normalizeDigits(body.code || "").trim();

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (!OTP_PURPOSES.includes(purpose)) {
        return Response.json(
          { ok: false, error: "INVALID_PURPOSE", message: "نوع درخواست نامعتبر است." },
          { status: 400 }
        );
      }

      if (!/^\d{6}$/.test(code)) {
        return Response.json(
          { ok: false, error: "INVALID_CODE", message: "کد باید دقیقاً ۶ رقم باشد." },
          { status: 400 }
        );
      }

      const genericInvalid = () =>
        Response.json(
          { ok: false, error: "INVALID_OR_EXPIRED_CODE", message: "کد وارد شده نامعتبر یا منقضی شده است." },
          { status: 400 }
        );

      const otpRow = await env.DB
        .prepare(
          "SELECT id, code_hash, expires_at, consumed_at, attempt_count FROM otp_codes " +
          "WHERE mobile = ? AND purpose = ? ORDER BY id DESC LIMIT 1"
        )
        .bind(mobile, purpose)
        .first();

      if (!otpRow) return genericInvalid();
      if (otpRow.consumed_at) return genericInvalid();
      if (new Date(otpRow.expires_at).getTime() < Date.now()) return genericInvalid();

      if (otpRow.attempt_count >= OTP_MAX_VERIFY_ATTEMPTS) {
        return Response.json(
          {
            ok: false,
            error: "TOO_MANY_ATTEMPTS",
            message: "تعداد تلاش بیش از حد مجاز است. یک کد جدید درخواست کنید.",
          },
          { status: 429 }
        );
      }

      const isValid = await verifyPassword(code, otpRow.code_hash);

      if (!isValid) {
        await env.DB
          .prepare("UPDATE otp_codes SET attempt_count = attempt_count + 1 WHERE id = ?")
          .bind(otpRow.id)
          .run();
        return genericInvalid();
      }

      // کد صحیح است؛ بلافاصله one-time mark می‌شود تا دوباره مصرف نشود.
      await env.DB
        .prepare("UPDATE otp_codes SET consumed_at = ?, status = 'verified' WHERE id = ?")
        .bind(nowIso(), otpRow.id)
        .run();

      // --- نهایی‌سازی مخصوص هر purpose ---

      if (purpose === "register") {
        const customer = await env.DB
          .prepare("SELECT id, full_name, phone FROM customers WHERE phone = ? LIMIT 1")
          .bind(mobile)
          .first();

        if (!customer) {
          return Response.json(
            { ok: false, error: "NOT_FOUND", message: "درخواست ثبت‌نام یافت نشد. دوباره تلاش کنید." },
            { status: 404 }
          );
        }

        await env.DB.prepare("UPDATE customers SET phone_verified = 1 WHERE id = ?").bind(customer.id).run();
        const token = await createCustomerSession(customer.id);

        return Response.json(
          { ok: true, customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone } },
          { status: 201, headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
        );
      }

      if (purpose === "login") {
        const customer = await env.DB
          .prepare("SELECT id, full_name, phone, is_active FROM customers WHERE phone = ? LIMIT 1")
          .bind(mobile)
          .first();

        if (!customer) return genericInvalid();

        if (Number(customer.is_active) === 0) {
          return Response.json(
            { ok: false, error: "ACCOUNT_DISABLED", message: "حساب کاربری شما غیرفعال شده است. لطفاً با پشتیبانی تماس بگیرید." },
            { status: 403 }
          );
        }

        const token = await createCustomerSession(customer.id);

        return Response.json(
          { ok: true, customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone } },
          { headers: { "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS) } }
        );
      }

      if (purpose === "password_reset") {
        const newPassword = String(body.new_password || "");

        if (newPassword.length < 6) {
          return Response.json(
            { ok: false, error: "WEAK_PASSWORD", message: "رمز عبور جدید باید حداقل ۶ کاراکتر باشد." },
            { status: 400 }
          );
        }

        const customer = await env.DB
          .prepare("SELECT id FROM customers WHERE phone = ? LIMIT 1")
          .bind(mobile)
          .first();

        if (!customer) {
          // طبق سیاست enumeration protection همان پیام موفقیت عمومی برگردانده می‌شود.
          return Response.json({ ok: true, message: "در صورت معتبر بودن این شماره، رمز عبور بروزرسانی شد." });
        }

        const newHash = await hashPassword(newPassword);
        await env.DB
          .prepare("UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?")
          .bind(newHash, nowIso(), customer.id)
          .run();

        // ابطال sessionهای قبلی برای امنیت بیشتر بعد از بازیابی رمز عبور.
        await env.DB.prepare("DELETE FROM customer_sessions WHERE customer_id = ?").bind(customer.id).run();

        return Response.json({ ok: true, message: "رمز عبور با موفقیت بروزرسانی شد." });
      }

      if (purpose === "phone_change") {
        const sessionCustomer = await getSessionCustomer(request);

        if (!sessionCustomer) {
          return Response.json(
            { ok: false, error: "UNAUTHORIZED", message: "ابتدا وارد حساب شوید." },
            { status: 401 }
          );
        }

        const owner = await env.DB
          .prepare("SELECT id FROM customers WHERE phone = ? AND id != ? LIMIT 1")
          .bind(mobile, sessionCustomer.id)
          .first();

        if (owner) {
          return Response.json(
            { ok: false, error: "PHONE_EXISTS", message: "این شماره متعلق به حساب دیگری است." },
            { status: 409 }
          );
        }

        await env.DB
          .prepare("UPDATE customers SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?")
          .bind(mobile, nowIso(), sessionCustomer.id)
          .run();

        return Response.json({ ok: true, message: "شماره موبایل با موفقیت تغییر کرد." });
      }

      return genericInvalid();
    } catch (error) {
      return Response.json(
        { ok: false, error: "SERVER_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — آدرس پیش‌فرض ذخیره‌شده
  // =========================

  if (url.pathname === "/api/store/customers/address" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const address = await env.DB
        .prepare(
          "SELECT province, city, street, sub_street, alley, plaque, unit, postal_code, " +
          "address_note, latitude, longitude FROM customer_addresses " +
          "WHERE customer_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1"
        )
        .bind(sessionCustomer.id)
        .first();

      return Response.json({ ok: true, address: address || null });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // حساب مشتری — سفارش‌های من (فهرست)
  // =========================

  if (url.pathname === "/api/store/customers/orders" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED", message: "لطفاً وارد حساب کاربری شوید." }, { status: 401 });
    }

    try {
      const ordersResult = await env.DB
        .prepare(
          "SELECT id, tracking_code, total, shipping_method_name, shipping_is_cod, status, payment_status, postal_carrier, " +
          "postal_tracking_code, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC"
        )
        .bind(sessionCustomer.id)
        .all();

      const orders = ordersResult.results || [];

      for (const order of orders) {
        const itemCount = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?")
          .bind(order.id)
          .first();

        order.item_count = itemCount?.count || 0;
        order.status_label = STATUS_LABELS[order.status] || order.status;
        order.payment_status_label = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status;
      }

      return Response.json({ ok: true, orders });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
// حساب مشتری — جزئیات یک سفارش
// GET /api/store/customers/orders/:id
// =========================

if (
  url.pathname.startsWith("/api/store/customers/orders/") &&
  request.method === "GET"
) {
  const sessionCustomer = await getSessionCustomer(request);

  if (!sessionCustomer) {
    return Response.json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message: "لطفاً وارد حساب کاربری شوید."
      },
      { status: 401 }
    );
  }

  try {
    const orderId = Number(url.pathname.split("/").pop());

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return Response.json(
        {
          ok: false,
          error: "INVALID_ORDER_ID"
        },
        { status: 400 }
      );
    }

    const order = await env.DB
      .prepare(
        "SELECT id, tracking_code, customer_id, customer_name, customer_phone, " +
        "province, city, street, sub_street, alley, plaque, unit, postal_code, address_note, " +
        "total, shipping_cost, shipping_method_name, shipping_is_cod, payable_amount, " +
        "status, payment_status, postal_carrier, postal_tracking_code, created_at " +
        "FROM orders WHERE id = ? LIMIT 1"
      )
      .bind(orderId)
      .first();

    if (!order || order.customer_id !== sessionCustomer.id) {
      return Response.json(
        {
          ok: false,
          error: "ORDER_NOT_FOUND",
          message: "سفارش پیدا نشد."
        },
        { status: 404 }
      );
    }

    const itemsResult = await env.DB
      .prepare(
        "SELECT " +
        "oi.product_name, " +
        "oi.price, " +
        "oi.quantity, " +
        "oi.subtotal, " +
        "p.image AS product_image, " +
        "(SELECT pi.image FROM product_images pi WHERE pi.product_id = oi.product_id " +
        "ORDER BY pi.sort_order ASC, pi.id ASC LIMIT 1) AS gallery_image " +
        "FROM order_items oi " +
        "LEFT JOIN products p ON p.id = oi.product_id " +
        "WHERE oi.order_id = ? " +
        "ORDER BY oi.id ASC"
      )
      .bind(orderId)
      .all();

    const historyResult = await env.DB
      .prepare(
        "SELECT status, note, created_at " +
        "FROM order_status_history WHERE order_id = ? ORDER BY id ASC"
      )
      .bind(orderId)
      .all();

    order.address = composeAddressText(order);

    // شماره فاکتور
    order.invoice_number = `INV-${String(order.id).padStart(6, "0")}`;

    order.status_label =
      STATUS_LABELS[order.status] || order.status;

    order.payment_status_label =
      PAYMENT_STATUS_LABELS[order.payment_status] ||
      order.payment_status;

    // تصویر واقعی محصول برای فاکتور — اول تصویر اصلی محصول (products.image)،
    // در نبود آن اولین تصویر گالری (product_images)، و در نهایت Placeholder.
    // resolveProductImageUrl مسیر را با همان قاعده‌ای می‌سازد که در بقیه سایت
    // (فروشگاه/SSR) استفاده می‌شود — چه فایل JPG/JPEG باشد چه WebP، فقط یک
    // پیشوند مسیر اضافه می‌کند و به فرمت فایل کاری ندارد.
    order.items = (itemsResult.results || []).map((item) => {
      const rawImage = item.product_image || item.gallery_image || null;
      const { gallery_image, ...rest } = item;
      return {
        ...rest,
        product_image: rawImage ? resolveAbsoluteProductImageUrl(rawImage) : null,
      };
    });

    order.history = (historyResult.results || []).map((h) => ({
      status: h.status,
      status_label: STATUS_LABELS[h.status] || h.status,
      note: h.note,
      created_at: h.created_at,
    }));

    return Response.json({
      ok: true,
      order
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "DATABASE_ERROR",
        message: error.message
      },
      { status: 500 }
    );
  }
}

  // =========================
  // پشتیبانی — ثبت تیکت جدید (مهمان یا مشتری ثبت‌نام‌شده)
  // POST /api/support/tickets
  // =========================

  if (url.pathname === "/api/support/tickets" && request.method === "POST") {
    try {
      const body = await request.json();

      const name = String(body.name || "").trim();
      const mobile = normalizeDigits(body.mobile || body.phone || "").trim();
      const email = String(body.email || "").trim();
      const subject = String(body.subject || "").trim();
      const message = String(body.message || "").trim();

      if (name.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_NAME", message: "نام و نام خانوادگی را کامل وارد کنید." },
          { status: 400 }
        );
      }

      if (!isValidMobile(mobile)) {
        return Response.json(
          { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست." },
          { status: 400 }
        );
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { ok: false, error: "INVALID_EMAIL", message: "ایمیل واردشده معتبر نیست." },
          { status: 400 }
        );
      }

      if (!subject || subject.length < 3) {
        return Response.json(
          { ok: false, error: "INVALID_SUBJECT", message: "موضوع درخواست را وارد کنید." },
          { status: 400 }
        );
      }

      if (!message || message.length < 5) {
        return Response.json(
          { ok: false, error: "INVALID_MESSAGE", message: "متن درخواست خیلی کوتاه است." },
          { status: 400 }
        );
      }

      const sessionCustomer = await getSessionCustomer(request);
      const customerId = sessionCustomer ? sessionCustomer.id : null;

      const orderId = body.order_id != null && Number.isInteger(Number(body.order_id))
        ? Number(body.order_id)
        : null;

      const trackingCode = await generateTicketTrackingCode();
      const timestamp = nowIso();

      const insertResult = await env.DB
        .prepare(
          "INSERT INTO tickets (" +
          "tracking_code, customer_id, order_id, name, mobile, email, subject, message, " +
          "status, created_at, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)"
        )
        .bind(trackingCode, customerId, orderId, name, mobile, email || null, subject, message, timestamp, timestamp)
        .run();

      const ticketId = insertResult.meta?.last_row_id;

      await env.DB
        .prepare(
          "INSERT INTO ticket_messages (ticket_id, sender_type, message) VALUES (?, 'customer', ?)"
        )
        .bind(ticketId, message)
        .run();

      await queueTicketSms(
        env,
        ticketId,
        mobile,
        "ticket_created",
        `درخواست پشتیبانی شما با کد پیگیری ${trackingCode} ثبت شد.`
      );

      // --- Central SMS Service (بخش ۲۰) — علاوه بر queueTicketSms قدیمی. ---
      try {
        await sendSms(env, {
          mobile,
          eventType: "SUPPORT_TICKET_CREATED",
          variables: { TICKET_ID: trackingCode },
          customerId: customerId || null,
          purpose: "support_ticket_created",
        });
      } catch (smsError) {
        console.error("Ticket created SMS (central service) failed:", smsError.message);
      }

      if (email) {
        await queueEmail(
          env,
          null,
          ticketId,
          email,
          `دریافت درخواست پشتیبانی — ${trackingCode}`,
          `درخواست شما با موضوع «${subject}» دریافت شد. کد پیگیری: ${trackingCode}`
        );
      }

      return Response.json(
        {
          ok: true,
          message: "درخواست پشتیبانی شما با موفقیت ثبت شد.",
          tracking_code: trackingCode,
          status: "received",
          status_label: TICKET_STATUS_LABELS.received,
          created_at: timestamp,
        },
        { status: 201 }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: "TICKET_CREATE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی — پیگیری تیکت (مهمان یا هر کاربر) با کد پیگیری + موبایل
  // GET /api/support/tickets/track?tracking_code=TK-XXXX&mobile=09xxxxxxxxx
  // =========================

  if (url.pathname === "/api/support/tickets/track" && request.method === "GET") {
    try {
      const trackingCode = (url.searchParams.get("tracking_code") || "").trim().toUpperCase();
      const mobile = normalizeDigits(url.searchParams.get("mobile") || "").trim();

      if (!trackingCode || !mobile) {
        return Response.json(
          { ok: false, error: "MISSING_PARAMS", message: "کد پیگیری و شماره موبایل را وارد کنید." },
          { status: 400 }
        );
      }

      const ticket = await env.DB
        .prepare(
          "SELECT id, tracking_code, name, subject, status, created_at, updated_at " +
          "FROM tickets WHERE tracking_code = ? AND mobile = ? LIMIT 1"
        )
        .bind(trackingCode, mobile)
        .first();

      if (!ticket) {
        return Response.json(
          { ok: false, error: "TICKET_NOT_FOUND", message: "درخواستی با این مشخصات پیدا نشد." },
          { status: 404 }
        );
      }

      const messagesResult = await env.DB
        .prepare(
          "SELECT sender_type, message, created_at FROM ticket_messages " +
          "WHERE ticket_id = ? ORDER BY id ASC"
        )
        .bind(ticket.id)
        .all();

      return Response.json({
        ok: true,
        ticket: {
          tracking_code: ticket.tracking_code,
          name: ticket.name,
          subject: ticket.subject,
          status: ticket.status,
          status_label: TICKET_STATUS_LABELS[ticket.status] || ticket.status,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          messages: messagesResult.results || [],
        },
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی — سفارش‌های من: تیکت‌های مشتری واردشده به حساب
  // GET /api/support/tickets/mine
  // =========================

  if (url.pathname === "/api/support/tickets/mine" && request.method === "GET") {
    const sessionCustomer = await getSessionCustomer(request);

    if (!sessionCustomer) {
      return Response.json({ ok: false, error: "UNAUTHORIZED", message: "لطفاً وارد حساب کاربری شوید." }, { status: 401 });
    }

    try {
      const result = await env.DB
        .prepare(
          "SELECT id, tracking_code, subject, status, created_at FROM tickets " +
          "WHERE customer_id = ? ORDER BY id DESC"
        )
        .bind(sessionCustomer.id)
        .all();

      const tickets = (result.results || []).map((t) => ({
        ...t,
        status_label: TICKET_STATUS_LABELS[t.status] || t.status,
      }));

      return Response.json({ ok: true, tickets });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — فهرست تیکت‌ها
  // GET /api/support/admin/tickets
  // نکته: پنل تصویری مدیریت تیکت طبق دستورالعمل فعلاً در مراحل بعدی ساخته می‌شود؛
  // این API از هم‌اکنون آماده است تا آن مرحله بدون بازنویسی ساختار انجام شود.
  // =========================

  if (url.pathname === "/api/support/admin/tickets" && request.method === "GET") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const statusFilter = (url.searchParams.get("status") || "").trim();
      const query = (url.searchParams.get("q") || "").trim();
      const orderIdFilter = (url.searchParams.get("order_id") || "").trim();
      const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));

      const conditions = [];
      const params = [];

      if (statusFilter) {
        conditions.push("status = ?");
        params.push(statusFilter);
      }

      if (query) {
        conditions.push("(tracking_code LIKE ? OR mobile LIKE ? OR name LIKE ? OR subject LIKE ?)");
        params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
      }

      if (orderIdFilter && Number.isInteger(Number(orderIdFilter))) {
        conditions.push("order_id = ?");
        params.push(Number(orderIdFilter));
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS c FROM tickets ${whereClause}`)
        .bind(...params)
        .first();

      const total = countRow?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;

      const result = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, order_id, name, mobile, email, subject, " +
          "status, created_at, updated_at FROM tickets " +
          whereClause +
          " ORDER BY id DESC LIMIT ? OFFSET ?"
        )
        .bind(...params, limit, offset)
        .all();

      const tickets = (result.results || []).map((t) => ({
        ...t,
        status_label: TICKET_STATUS_LABELS[t.status] || t.status,
      }));

      return Response.json({
        ok: true,
        tickets,
        page,
        limit,
        total,
        total_pages: totalPages,
      });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — جزئیات یک تیکت
  // GET /api/support/admin/tickets/:id
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    request.method === "GET"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const ticketId = Number(url.pathname.split("/").pop());

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      const ticket = await env.DB
        .prepare(
          "SELECT id, tracking_code, customer_id, order_id, name, mobile, email, subject, " +
          "status, created_at, updated_at FROM tickets WHERE id = ? LIMIT 1"
        )
        .bind(ticketId)
        .first();

      if (!ticket) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      const messagesResult = await env.DB
        .prepare(
          "SELECT id, sender_type, message, attachment_url, created_at FROM ticket_messages " +
          "WHERE ticket_id = ? ORDER BY id ASC"
        )
        .bind(ticketId)
        .all();

      ticket.status_label = TICKET_STATUS_LABELS[ticket.status] || ticket.status;
      ticket.messages = messagesResult.results || [];

      return Response.json({ ok: true, ticket });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — تغییر وضعیت تیکت
  // PUT /api/support/admin/tickets/:id
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    request.method === "PUT"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const ticketId = Number(url.pathname.split("/").pop());
      const body = await request.json();
      const status = String(body.status || "").trim();

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      if (!ALLOWED_TICKET_STATUSES.includes(status)) {
        return Response.json(
          { ok: false, error: "INVALID_STATUS", message: "وضعیت تیکت نامعتبر است." },
          { status: 400 }
        );
      }

      const existingTicket = await env.DB
        .prepare("SELECT id, customer_id, mobile, tracking_code, status FROM tickets WHERE id = ? LIMIT 1")
        .bind(ticketId)
        .first();

      if (!existingTicket) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      const result = await env.DB
        .prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, nowIso(), ticketId)
        .run();

      if (!result.meta?.changes) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      // --- Central SMS Service (بخش ۲۰) — این endpoint قبلاً هیچ اتصال SMS
      // نداشت؛ چون هم Trigger واقعی (همین تغییر وضعیت) و هم Template واقعی
      // (SUPPORT_TICKET_STATUS / SUPPORT_TICKET_CLOSED) موجودند، اضافه شد.
      if (status !== existingTicket.status) {
        try {
          const smsEventType = status === "closed" ? "SUPPORT_TICKET_CLOSED" : "SUPPORT_TICKET_STATUS";
          const smsVariables = { TICKET_ID: existingTicket.tracking_code };
          if (smsEventType === "SUPPORT_TICKET_STATUS") {
            smsVariables.STATUS = TICKET_STATUS_LABELS[status] || status;
          }

          await sendSms(env, {
            mobile: existingTicket.mobile,
            eventType: smsEventType,
            variables: smsVariables,
            customerId: existingTicket.customer_id || null,
            purpose: "support_ticket_status",
          });
        } catch (smsError) {
          console.error("Ticket status SMS (central service) failed:", smsError.message);
        }
      }

      return Response.json({ ok: true, ticket_id: ticketId, status });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // پشتیبانی (مدیریت) — پاسخ به تیکت
  // POST /api/support/admin/tickets/:id/reply
  // =========================

  if (
    url.pathname.startsWith("/api/support/admin/tickets/") &&
    url.pathname.endsWith("/reply") &&
    request.method === "POST"
  ) {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    try {
      const segments = url.pathname.split("/");
      const ticketId = Number(segments[segments.length - 2]);
      const body = await request.json();
      const message = String(body.message || "").trim();

      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TICKET_ID" }, { status: 400 });
      }

      if (!message) {
        return Response.json(
          { ok: false, error: "INVALID_MESSAGE", message: "متن پاسخ نمی‌تواند خالی باشد." },
          { status: 400 }
        );
      }

      const ticket = await env.DB
        .prepare("SELECT id, customer_id, mobile, email, tracking_code FROM tickets WHERE id = ? LIMIT 1")
        .bind(ticketId)
        .first();

      if (!ticket) {
        return Response.json({ ok: false, error: "TICKET_NOT_FOUND" }, { status: 404 });
      }

      await env.DB
        .prepare("INSERT INTO ticket_messages (ticket_id, sender_type, message) VALUES (?, 'admin', ?)")
        .bind(ticketId, message)
        .run();

      await env.DB
        .prepare("UPDATE tickets SET status = 'answered', updated_at = ? WHERE id = ?")
        .bind(nowIso(), ticketId)
        .run();

      await queueTicketSms(
        env,
        ticketId,
        ticket.mobile,
        "ticket_replied",
        `به درخواست پشتیبانی شما (${ticket.tracking_code}) پاسخ داده شد.`
      );

      // --- Central SMS Service (بخش ۲۰) — علاوه بر queueTicketSms قدیمی. ---
      try {
        await sendSms(env, {
          mobile: ticket.mobile,
          eventType: "SUPPORT_TICKET_REPLY",
          variables: { TICKET_ID: ticket.tracking_code },
          customerId: ticket.customer_id || null,
          purpose: "support_ticket_reply",
        });
      } catch (smsError) {
        console.error("Ticket reply SMS (central service) failed:", smsError.message);
      }

      if (ticket.email) {
        await queueEmail(
          env,
          null,
          ticketId,
          ticket.email,
          `پاسخ به درخواست پشتیبانی — ${ticket.tracking_code}`,
          message
        );
      }

      return Response.json({ ok: true, ticket_id: ticketId, status: "answered" });
    } catch (error) {
      return Response.json(
        { ok: false, error: "DATABASE_ERROR", message: error.message },
        { status: 500 }
      );
    }
  }

  // =========================
  // SMS.ir — Test Endpoint (فقط Admin)
  // POST /api/sms/test
  // =========================

  if (url.pathname === "/api/sms/test" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const ALLOWED_SMS_TEMPLATES = [916162, 222638];

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "INVALID_JSON", message: "بدنه درخواست JSON معتبر نیست." },
        { status: 400 }
      );
    }

    const mobileRaw = body?.mobile;
    const templateId = Number(body?.templateId);
    const code = normalizeDigits(body?.code).trim();

    if (!mobileRaw || !isValidMobile(mobileRaw)) {
      return Response.json(
        { ok: false, error: "INVALID_MOBILE", message: "شماره موبایل معتبر نیست. فرمت صحیح: 09xxxxxxxxx" },
        { status: 400 }
      );
    }

    if (!ALLOWED_SMS_TEMPLATES.includes(templateId)) {
      return Response.json(
        {
          ok: false,
          error: "INVALID_TEMPLATE",
          message: "Template ID مجاز نیست. مقادیر مجاز: 916162 یا 222638",
        },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return Response.json(
        { ok: false, error: "INVALID_CODE", message: "کد باید دقیقاً ۶ رقم و فقط عدد باشد." },
        { status: 400 }
      );
    }

    const normalizedMobile = normalizeDigits(mobileRaw).trim();

    try {
      await sendSmsIrVerify(env, normalizedMobile, templateId, [
        { name: "CODE", value: code },
      ]);

      // مقدار مبایل/کد عمداً در response برنگردانده می‌شود.
      return Response.json({ ok: true, message: "پیامک با موفقیت ارسال شد." });
    } catch (error) {
      // پیام خطا هرگز حاوی مقدار SMS_IR_API_KEY نیست؛ فقط پیام خطای SMS.ir یا عدم تنظیم Secret را منعکس می‌کند.
      return Response.json(
        { ok: false, error: "SMS_SEND_FAILED", message: error.message },
        { status: 502 }
      );
    }
  }

  // =========================================================================
  // تست مسیر پرداخت (فقط Admin) — بخش ۵/۶ دستور: امکان اجرای واقعی مسیر
  // «ایجاد تراکنش → تبدیل تومان به ریال → Verify → بروزرسانی سفارش» روی یک
  // سفارش واقعی، بدون نیاز به درگاه واقعی. دقیقاً همان مسیر initiatePaymentRequest/
  // verifyPaymentTransaction را اجرا می‌کند که یک درگاه واقعی هم استفاده خواهد کرد.
  // =========================================================================

  if (url.pathname === "/api/store/admin/payment/test/initiate" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    try {
      const body = await request.json();
      const orderId = Number(body.order_id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json({ ok: false, error: "INVALID_ORDER_ID" }, { status: 400 });
      }
      const result = await initiatePaymentRequest(env, orderId);
      return Response.json(result);
    } catch (error) {
      return Response.json({ ok: false, error: "SERVER_ERROR", message: error.message }, { status: 500 });
    }
  }

  if (url.pathname === "/api/store/admin/payment/test/verify" && request.method === "POST") {
    if (!isAdmin(request, env)) {
      return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    try {
      const body = await request.json();
      const transactionId = Number(body.transaction_id);
      const simulateSuccess = body.success !== false;
      if (!Number.isInteger(transactionId) || transactionId <= 0) {
        return Response.json({ ok: false, error: "INVALID_TRANSACTION_ID" }, { status: 400 });
      }
      const result = await verifyPaymentTransaction(env, transactionId, simulateSuccess);
      return Response.json(result);
    } catch (error) {
      return Response.json({ ok: false, error: "SERVER_ERROR", message: error.message }, { status: 500 });
    }
  }

  // =========================
  // API Not Found
  // =========================

  return Response.json({ ok: false, error: "API_NOT_FOUND" }, { status: 404 });
}


// =========================
// Worker
// =========================

// =========================================================================
// Product Page SSR + Schema.org + Sitemap — بخش ۱۰/۱۱ دستور بهینه‌سازی صفحه محصول
//
// هدف: اطلاعات اصلی محصول (نام/قیمت/موجودی/تصویر) نباید صرفاً وابسته به اجرای
// JavaScript باشد (الزام ترب/SEO). این توابع همان صفحه استاتیک
// public/store/product.html را می‌گیرند و قبل از تحویل به مرورگر/ربات، محتوای
// واقعی محصول + Schema.org را در آن درج می‌کنند. صفحه بعد از بارگذاری، دقیقاً
// مثل قبل با JavaScript خودش (همان buildProductViewModel که API JSON هم از آن
// استفاده می‌کند) دوباره رندر می‌شود — یعنی هیچ‌وقت داده SSR با داده API متفاوت
// نیست، چون منبع هر دو یکی است.
// =========================================================================

function resolveProductImageUrl(image) {
  if (!image) return "/assets/products/placeholder.svg";
  const value = String(image).trim();
  if (!value) return "/assets/products/placeholder.svg";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return value;
  if (value.startsWith("assets/")) return "/" + value;
  if (value.startsWith("products/")) return "/assets/" + value;
  return "/assets/products/" + value;
}

// نسخه مطلق resolveProductImageUrl — برای فاکتور/PDF که باید حتی خارج از
// مرورگر سایت (مثلاً هنگام دانلود/چاپ) درست باز شود. اگر مسیر از قبل کامل
// (http/https/data:) باشد، هرگز دوباره پیشوند نمی‌گیرد.
function resolveAbsoluteProductImageUrl(image) {
  const resolved = resolveProductImageUrl(image);
  if (/^(https?:|data:)/.test(resolved)) return resolved;
  return `${STORE_BASE_URL}${resolved}`;
}

async function fetchProductImagesForSsr(env, productId) {
  const result = await env.DB
    .prepare("SELECT id, image, alt, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
    .bind(productId)
    .all();
  return result.results || [];
}

async function fetchProductSpecsForSsr(env, productId) {
  const result = await env.DB
    .prepare("SELECT id, label, value, sort_order FROM product_specs WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
    .bind(productId)
    .all();
  return result.results || [];
}

// یک خلاصه متنی ساده (بدون تگ HTML) برای meta description و Schema، از همان
// description غنی (HTML) که در پنل مدیریت ذخیره شده است.
function stripHtmlToText(html, maxLength) {
  const text = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function escapeHtmlForSsr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ⚠️ نکته درباره واحد پول: قیمت‌های سایت به «تومان» نمایش داده می‌شوند، اما
// کد استاندارد ISO 4217 برای تومان وجود ندارد (کد رسمی ایران IRR/ریال است).
// طبق رویه رایج سایت‌های ایرانی برای Schema.org در Torob/Google، همان عدد
// نمایشی (تومان) با کد IRR گزارش می‌شود تا با آنچه واقعاً در صفحه دیده
// می‌شود مطابقت کامل داشته باشد (طبق تأکید دستور). پیشنهاد می‌شود این مورد
// را با آخرین مستندات فنی ترب مجدداً تطبیق دهید، چون امکان تغییر آن وجود دارد.
function buildProductJsonLd(viewModel, images) {
  const imageUrls = (images.length > 0 ? images : [{ image: viewModel.image }])
    .map((img) => `${STORE_BASE_URL}${resolveProductImageUrl(img.image)}`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: viewModel.name,
    image: imageUrls,
    description: stripHtmlToText(viewModel.description, 500) || viewModel.name,
    url: viewModel.canonical_url,
    offers: {
      "@type": "Offer",
      url: viewModel.canonical_url,
      priceCurrency: "IRR",
      price: String(viewModel.price),
      availability: viewModel.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  if (viewModel.brand) jsonLd.brand = { "@type": "Brand", name: viewModel.brand };
  if (viewModel.model) jsonLd.model = viewModel.model;
  if (viewModel.sku) jsonLd.sku = viewModel.sku;

  if (viewModel.has_return_policy) {
    jsonLd.offers.hasMerchantReturnPolicy = {
      "@type": "MerchantReturnPolicy",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: Number(viewModel.return_days),
      applicableCountry: "IR",
    };
  }

  return jsonLd;
}

// همان چیدمانی که در public/store/product.html با JavaScript ساخته می‌شود
// (renderBrandModelLine/renderPriceBlock/renderShippingBlock/renderAssuranceList/
// renderSpecsTable)، اینجا سمت سرور هم تولید می‌شود تا قبل از اجرای JS هم در
// HTML واقعی موجود باشد. اگر یکی از این دو تغییر کرد، دیگری هم باید هماهنگ شود.
function renderProductDetailSsrHtml(viewModel, images, specs) {
  const mainImage = images[0]?.image || viewModel.image;
  const mainImageAlt = images[0]?.alt || viewModel.name;

  const brandModelLine = (() => {
    const parts = [];
    if (viewModel.brand) parts.push(escapeHtmlForSsr(viewModel.brand));
    if (viewModel.model) parts.push(escapeHtmlForSsr(viewModel.model));
    return parts.length ? `<div class="product-detail-meta">${parts.join(" — ")}</div>` : "";
  })();

  const priceBlock = viewModel.discount_active
    ? `${Number(viewModel.price).toLocaleString("fa-IR")} تومان
       <span class="old-price">${Number(viewModel.compare_at_price).toLocaleString("fa-IR")} تومان</span>
       ${viewModel.discount_percent ? `<span class="discount-badge">${Number(viewModel.discount_percent).toLocaleString("fa-IR")}٪ تخفیف</span>` : ""}`
    : `${Number(viewModel.price).toLocaleString("fa-IR")} تومان`;

  const shippingBlock = `
    <div class="product-shipping-info">
      <div>هزینه ارسال: ${Number(viewModel.shipping_cost) > 0 ? Number(viewModel.shipping_cost).toLocaleString("fa-IR") + " تومان" : "رایگان"}</div>
      ${viewModel.shipping_method ? `<div>روش ارسال: ${escapeHtmlForSsr(viewModel.shipping_method)}</div>` : ""}
      ${viewModel.shipping_time ? `<div>زمان ارسال: ${escapeHtmlForSsr(viewModel.shipping_time)}</div>` : ""}
    </div>
  `;

  const assuranceItems = [];
  if (viewModel.has_return_policy) {
    assuranceItems.push(`<li>ضمانت بازگشت ${Number(viewModel.return_days).toLocaleString("fa-IR")} روزه</li>`);
  }
  if (viewModel.has_warranty) {
    const provider = viewModel.warranty_provider ? ` ${escapeHtmlForSsr(viewModel.warranty_provider)}` : "";
    assuranceItems.push(`<li>${Number(viewModel.warranty_months).toLocaleString("fa-IR")} ماه گارانتی${provider}</li>`);
  }
  const assuranceBlock = assuranceItems.length ? `<ul class="product-assurance-list">${assuranceItems.join("")}</ul>` : "";

  const specsBlock = specs.length > 0
    ? `
      <button type="button" id="product-specs-toggle" class="product-info-toggle" aria-expanded="true"
        onclick="toggleCollapsible('product-specs-panel','product-specs-toggle','مشخصات فنی','بستن مشخصات فنی')">
        بستن مشخصات فنی
      </button>
      <div id="product-specs-panel" class="product-info-panel">
        <table class="product-specs-table">
          ${specs.map((s) => `<tr><th>${escapeHtmlForSsr(s.label)}</th><td>${escapeHtmlForSsr(s.value)}</td></tr>`).join("")}
        </table>
      </div>
    `
    : "";

  const introBlock = viewModel.description
    ? `
      <button type="button" id="product-info-toggle" class="product-info-toggle" aria-expanded="true"
        onclick="toggleCollapsible('product-info-panel','product-info-toggle','معرفی محصول','بستن معرفی محصول')">
        بستن معرفی محصول
      </button>
      <div id="product-info-panel" class="product-info-panel">
        <div class="product-description">${viewModel.description}</div>
      </div>
    `
    : "";

  return `
    <div class="product-detail-card">
      <div class="product-detail-media">
        <img class="product-detail-image" src="${escapeHtmlForSsr(resolveProductImageUrl(mainImage))}" alt="${escapeHtmlForSsr(mainImageAlt)}">
      </div>
      <div class="product-detail-content">
        <h1>${escapeHtmlForSsr(viewModel.name)}</h1>
        ${brandModelLine}
        <div class="product-detail-price">${priceBlock}</div>
        <div class="product-detail-stock">${viewModel.in_stock ? `موجودی: ${Number(viewModel.stock).toLocaleString("fa-IR")} عدد` : "در حال حاضر ناموجود"}</div>
        ${shippingBlock}
        ${assuranceBlock}
        <div class="product-actions">
          <label for="quantity">تعداد:</label>
          <input id="quantity" type="number" min="1" max="${Math.max(Number(viewModel.stock || 0), 1)}" value="1" ${viewModel.in_stock ? "" : "disabled"}>
          <button type="button" class="product-button" onclick="addProductToCart()" ${viewModel.in_stock ? "" : "disabled"}>
            ${viewModel.in_stock ? "افزودن به سبد خرید" : "محصول ناموجود است"}
          </button>
        </div>
        ${introBlock}
        ${specsBlock}
        <a href="index.html" class="back-link">← بازگشت به فروشگاه</a>
      </div>
    </div>
  `;
}

async function handleProductPageSsr(request, env, slug) {
  // یک درخواست تازه و مستقل فقط برای /store/product.html می‌سازیم — نه با
  // کپی‌کردن request ورودی. علت واقعی خالی‌بودن Body: وقتی request ورودی
  // (که برای مسیر /store/product/:slug است) به‌عنوان پایه Request جدید
  // استفاده می‌شد، هدرهای آن (مثل هدرهای conditional cache که برای مسیر
  // اصلی معتبر بودند، نه برای خود فایل استاتیک) با Static Assets binding
  // به شکلی ترکیب می‌شدند که پاسخ 200 با Body خالی برمی‌گشت. یک Request
  // ساده و تازه این مشکل را ندارد.
  const shellUrl = new URL("/store/product.html", request.url).toString();

  async function fetchShellOnce() {
    const response = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
    if (!response || !response.ok) return null;
    const text = await response.text();
    if (!text) return null;
    return { response, text };
  }

  let shell = await fetchShellOnce();
  if (!shell) {
    // تلاش دوم؛ اگر باز هم Body خالی/ناموفق بود، دیگر 200 با Body صفر
    // برنمی‌گردانیم — یک خطای کنترل‌شده و صریح می‌دهیم.
    shell = await fetchShellOnce();
  }

  if (!shell) {
    return new Response("صفحه محصول موقتاً در دسترس نیست. لطفاً دوباره تلاش کنید.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=UTF-8" },
    });
  }

  let productRow;
  try {
    productRow = await env.DB
      .prepare(
        "SELECT id, name, slug, description, price, image, stock, brand, model, sku, compare_at_price, " +
        "shipping_cost, shipping_method, shipping_time, warranty_months, warranty_provider, return_days " +
        "FROM products WHERE slug = ? AND active = 1 LIMIT 1"
      )
      .bind(slug)
      .first();
  } catch (error) {
    // در صورت خطای DB، فقط shell خام (رفتار قبلی JS) برگردانده می‌شود.
    return new Response(shell.text, { headers: { "content-type": "text/html; charset=UTF-8" } });
  }

  if (!productRow) {
    return new Response(shell.text, {
      status: 404,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  }

  const images = await fetchProductImagesForSsr(env, productRow.id);
  let specs = await fetchProductSpecsForSsr(env, productRow.id);
  const viewModel = buildProductViewModel(productRow);

  const formatRules = await getTechnicalFormatRules(env);
  applyTechnicalFormattingToProduct(viewModel, formatRules);
  specs = specs.map((spec) => ({
    ...spec,
    label: formatTechnicalText(spec.label, formatRules),
    value: formatTechnicalText(spec.value, formatRules),
  }));

  const jsonLd = buildProductJsonLd(viewModel, images);
  const metaDescription = stripHtmlToText(viewModel.description, 155) ||
    `${viewModel.name} — خرید آنلاین از فروشگاه تأسیسات آپادانا`;

  let html = shell.text;

  // <base> باید در همان ابتدای <head> باشد، قبل از هر تگی که URL نسبی دارد
  // (مثل <link rel="stylesheet" href="store.css">) — چون مرورگر تگ‌ها را
  // به‌ترتیب پردازش می‌کند و اگر <base> بعد از آن تگ‌ها بیاید، آن‌ها قبلاً
  // با base اشتباه (URL خودِ صفحه) resolve و fetch شده‌اند.
  html = html.replace("<head>", `<head>\n<base href="/store/">`);

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtmlForSsr(viewModel.name)} | تأسیسات آپادانا</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[\s\S]*?"\s*>/,
    `<meta name="description" content="${escapeHtmlForSsr(metaDescription)}">`
  );
  html = html.replace(
    "</head>",
    `<link rel="canonical" href="${escapeHtmlForSsr(viewModel.canonical_url)}">\n` +
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`
  );
  html = html.replace(
    /<div[^>]*id="product-detail"[^>]*>[\s\S]*?<\/div>/,
    `<div id="product-detail" class="product-detail">${renderProductDetailSsrHtml(viewModel, images, specs)}</div>`
  );

  return new Response(html, {
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

// =========================================================================
// sitemap.xml — فقط محصولات فعال (بخش ۱۰ دستور)
// =========================================================================

async function handleSitemapXml(env) {
  try {
    const result = await env.DB.prepare("SELECT slug, updated_at FROM products WHERE active = 1").all();
    const products = result.results || [];

    const staticUrls = [
      "", "store/", "service.html", "support.html",
    ];

    const urls = [
      ...staticUrls.map((path) => `
        <url>
          <loc>${STORE_BASE_URL}/${path}</loc>
        </url>`),
      ...products.map((p) => `
        <url>
          <loc>${STORE_BASE_URL}/store/product/${encodeURIComponent(p.slug)}</loc>
          ${p.updated_at ? `<lastmod>${String(p.updated_at).slice(0, 10)}</lastmod>` : ""}
        </url>`),
    ].join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`;

    return new Response(xml, { headers: { "content-type": "application/xml; charset=UTF-8" } });
  } catch (error) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      headers: { "content-type": "application/xml; charset=UTF-8" },
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      url.pathname.startsWith("/api/store/") ||
      url.pathname.startsWith("/api/support/") ||
      url.pathname.startsWith("/api/sms/")
    ) {
      return handleStoreApi(request, env);
    }

    if (url.pathname === "/sitemap.xml") {
      return handleSitemapXml(env);
    }

    const productSlugMatch = url.pathname.match(/^\/store\/product\/([^/]+)\/?$/);
    if (productSlugMatch && request.method === "GET") {
      return handleProductPageSsr(request, env, decodeURIComponent(productSlugMatch[1]));
    }

    if (url.pathname === "/store/product.html" && request.method === "GET") {
      const slug = url.searchParams.get("slug");
      if (slug) {
        return handleProductPageSsr(request, env, slug);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
