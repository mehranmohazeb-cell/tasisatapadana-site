// =========================================================================
// تأسیسات آپادانا — پنل مدیریت — امکانات مشترک بین همه صفحات
// (داشبورد / محصولات / سفارش‌ها / پشتیبانی)
// =========================================================================

// نکته مهم: endpointهای «محصولات/سفارش‌ها/خلاصه» زیر مسیر /api/store هستند،
// اما endpointهای «پشتیبانی/تیکت» زیر مسیر جدای /api/support ثبت شده‌اند
// (طبق ساختار واقعی src/index.js). هر دو باید جدا نگه داشته شوند.
const ADMIN_API_BASE = "/api/store";
const SUPPORT_API_BASE = "/api/support";
const ADMIN_TOKEN_STORAGE_KEY = "apadana_admin_token";

// وضعیت‌ها دقیقاً همان مقادیر backend (src/index.js) — یک محل مرکزی
// تا بعداً تغییرشان آسان باشد و با کد سرور ناسازگار نشوند.
const ORDER_STATUS_LABELS = {
  pending: "در حال بررسی",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال شده",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
};

const PAYMENT_STATUS_LABELS = {
  unpaid: "پرداخت‌نشده",
  paid: "پرداخت‌شده",
  failed: "پرداخت ناموفق",
  refunded: "بازگشت وجه",
};

const TICKET_STATUS_LABELS = {
  received: "ثبت شده",
  in_review: "در حال بررسی",
  answered: "پاسخ داده شد",
  closed: "بسته شد",
};

// =========================
// Token (X-Admin-Token)
// نگهداری فقط در sessionStorage (پاک‌شدنی با بستن تب)، هرگز در کد ثابت نمی‌شود.
// =========================

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
}

function setAdminToken(token) {
  if (token) {
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

function requireAdminToken() {
  let token = getAdminToken();
  if (!token) {
    token = prompt("رمز مدیریت را وارد کنید:") || "";
    if (token) setAdminToken(token);
  }
  return token;
}

// درخواست به API مدیریت با یک مسیر کامل (مثلاً "/api/support/admin/tickets").
// در صورت 401 توکن پاک شده و دوباره پرسیده می‌شود (فقط یک بار retry).
async function fetchAdminPath(fullPath, options = {}, _retried = false) {
  const token = requireAdminToken();

  if (!token) {
    throw new Error("ورود به مدیریت لغو شد.");
  }

  const response = await fetch(fullPath, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Admin-Token": token,
    },
  });

  if (response.status === 401) {
    setAdminToken("");
    if (!_retried) {
      return fetchAdminPath(fullPath, options, true);
    }
    throw new Error("رمز مدیریت صحیح نیست.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("پاسخ نامعتبر از سرور دریافت شد.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.message || "خطا در ارتباط با سرور.");
  }

  return data;
}

// درخواست به endpointهای زیر /api/store (محصولات، سفارش‌ها، خلاصه داشبورد).
async function fetchAdmin(path, options = {}) {
  return fetchAdminPath(`${ADMIN_API_BASE}${path}`, options);
}

// درخواست به endpointهای زیر /api/support (تیکت‌های پشتیبانی).
async function fetchSupportAdmin(path, options = {}) {
  return fetchAdminPath(`${SUPPORT_API_BASE}${path}`, options);
}

// =========================
// Helpers — نمایش
// =========================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

function formatDate(value) {
  if (!value) return "-";
  try {
    let normalized = String(value).trim();

    // مقادیری که از CURRENT_TIMESTAMP خود D1/SQLite می‌آیند به‌صورت
    // "YYYY-MM-DD HH:MM:SS" (بدون Z و بدون آفست) هستند، اما همیشه UTC هستند.
    // بدون این علامت‌گذاری صریح، مرورگر آنها را اشتباهاً local تفسیر می‌کند
    // (دقیقاً همان چیزی که باعث می‌شد ساعت تاریخچه با ساعت ایران هماهنگ نباشد).
    // این فقط لایه نمایش را اصلاح می‌کند؛ چیزی در D1 یا Worker تغییر نکرده.
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized = normalized.replace(" ", "T") + "Z";
    }

    return new Date(normalized).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  } catch {
    return String(value);
  }
}

function getProductImageUrl(image) {
  if (!image) return "";
  const value = String(image).trim();
  if (!value) return "";

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("/")) return value;
  if (value.startsWith("assets/")) return "/" + value;
  if (value.startsWith("products/")) return "/assets/" + value;
  return "/assets/products/" + value;
}

// عکس نمایشی یک محصول را دقیقاً به همان ترتیب اولویتی که فروشگاه عمومی
// استفاده می‌کند برمی‌گرداند: products.image → اولین ردیف product_images →
// placeholder. محصولاتی که فقط از طریق «تصاویر محصول» (product_images) عکس
// دارند و ستون قدیمی image آن‌ها خالی است، قبلاً در پنل مدیریت دیده نمی‌شدند
// چون فقط product.image بررسی می‌شد؛ این تابع همان مشکل را رفع می‌کند.
function getProductDisplayImage(product) {
  let source = product?.image || "";

  if (!source && Array.isArray(product?.images) && product.images.length > 0) {
    source = product.images[0]?.image || "";
  }

  const resolved = getProductImageUrl(source);
  return resolved || "/assets/products/placeholder.svg";
}

// =========================
// Toast (بازخورد کوتاه به مدیر)
// =========================

function ensureToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = "info", durationMs = 3200) {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, durationMs);
}

// =========================
// Pagination UI مشترک
// onPageClick(page) هنگام کلیک روی هر شماره صدا زده می‌شود.
// =========================

function renderPagination(container, { page, totalPages, total }, onPageClick) {
  if (!container) return;

  if (!totalPages || totalPages <= 1) {
    container.innerHTML = total
      ? `<p class="pagination-summary">${Number(total).toLocaleString("fa-IR")} مورد</p>`
      : "";
    return;
  }

  const maxButtons = 5;
  let start = Math.max(1, page - Math.floor(maxButtons / 2));
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);

  const buttons = [];

  buttons.push(
    `<button type="button" ${page <= 1 ? "disabled" : ""} data-page="${page - 1}">قبلی</button>`
  );

  if (start > 1) {
    buttons.push(`<button type="button" data-page="1">۱</button>`);
    if (start > 2) buttons.push(`<span>…</span>`);
  }

  for (let p = start; p <= end; p++) {
    buttons.push(
      `<button type="button" class="${p === page ? "active" : ""}" data-page="${p}">${p.toLocaleString("fa-IR")}</button>`
    );
  }

  if (end < totalPages) {
    if (end < totalPages - 1) buttons.push(`<span>…</span>`);
    buttons.push(`<button type="button" data-page="${totalPages}">${totalPages.toLocaleString("fa-IR")}</button>`);
  }

  buttons.push(
    `<button type="button" ${page >= totalPages ? "disabled" : ""} data-page="${page + 1}">بعدی</button>`
  );

  container.innerHTML = `<div class="pagination-bar">${buttons.join("")}</div>` +
    `<p class="pagination-summary">${Number(total).toLocaleString("fa-IR")} مورد &middot; صفحه ${page.toLocaleString("fa-IR")} از ${totalPages.toLocaleString("fa-IR")}</p>`;

  container.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetPage = Number(btn.getAttribute("data-page"));
      if (Number.isInteger(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
        onPageClick(targetPage);
      }
    });
  });
}

// =========================
// Navigation مشترک + Notification badges
// =========================

const ADMIN_NAV_ITEMS = [
  { key: "dashboard", href: "/admin/", label: "داشبورد" },
  { key: "products", href: "/admin/products/", label: "محصولات" },
  { key: "orders", href: "/admin/orders/", label: "سفارش‌ها" },
  { key: "support", href: "/admin/support/", label: "پشتیبانی" },
  { key: "sms", href: "/admin/sms/", label: "مدیریت پیامک" },
];

function renderAdminNav(activeKey) {
  const nav = document.getElementById("admin-nav");
  if (!nav) return;

  nav.innerHTML = ADMIN_NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="${item.key === activeKey ? "active" : ""}" data-nav-key="${item.key}">
      ${item.label}
      <span class="nav-badge" data-nav-badge="${item.key}" style="display:none;"></span>
    </a>
  `).join("");
}

// زیرمنوی داخلی بخش «مدیریت پیامک» (بخش ۵ دستور پنل SMS)
const SMS_SUB_NAV_ITEMS = [
  { key: "sms-dashboard", href: "/admin/sms/", label: "داشبورد" },
  { key: "sms-history", href: "/admin/sms/history/", label: "تاریخچه" },
  { key: "sms-send", href: "/admin/sms/send/", label: "ارسال پیامک" },
  { key: "sms-templates", href: "/admin/sms/templates/", label: "قالب‌ها" },
  { key: "sms-consent", href: "/admin/sms/consent/", label: "رضایت پیامکی" },
  { key: "sms-scheduled", href: "/admin/sms/scheduled/", label: "پیامک زمان‌بندی‌شده" },
];

function renderSmsSubNav(activeKey) {
  const nav = document.getElementById("sms-sub-nav");
  if (!nav) return;

  nav.innerHTML = SMS_SUB_NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="${item.key === activeKey ? "active" : ""}">${item.label}</a>
  `).join("");
}

// Badge‌های ناوبری را از /api/store/admin/summary پر می‌کند (فقط COUNT، سبک).
async function loadAdminNavBadges() {
  try {
    const data = await fetchAdmin("/admin/summary");

    const ordersBadge = document.querySelector('[data-nav-badge="orders"]');
    if (ordersBadge) {
      const newOrders = data.orders?.new || 0;
      if (newOrders > 0) {
        ordersBadge.textContent = newOrders.toLocaleString("fa-IR");
        ordersBadge.classList.add("orange");
        ordersBadge.style.display = "inline-flex";
      } else {
        ordersBadge.style.display = "none";
      }
    }

    const supportBadge = document.querySelector('[data-nav-badge="support"]');
    if (supportBadge) {
      const unanswered = data.tickets?.unanswered || 0;
      if (unanswered > 0) {
        supportBadge.textContent = unanswered.toLocaleString("fa-IR");
        supportBadge.style.display = "inline-flex";
      } else {
        supportBadge.style.display = "none";
      }
    }

    return data;
  } catch {
    // بی‌صدا شکست می‌خورد؛ نبود badge نباید کار پنل را مختل کند.
    return null;
  }
}

// صفحه را با نویگیشن مشترک + بارگذاری badgeها آماده می‌کند.
function initAdminPage(activeKey) {
  renderAdminNav(activeKey);
  loadAdminNavBadges();
}
