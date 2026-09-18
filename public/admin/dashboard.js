// =========================
// داشبورد — /admin/
// =========================

function renderStatBox(value, label) {
  return `
    <div class="stat-box">
      <div class="stat-value">${Number(value || 0).toLocaleString("fa-IR")}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function renderAlerts(data) {
  const container = document.getElementById("alerts-bar");
  if (!container) return;

  const alerts = [];

  const unansweredTickets = data.tickets?.unanswered || 0;
  if (unansweredTickets > 0) {
    alerts.push(`
      <span class="alert-pill danger">
        🔴 پشتیبانی ${unansweredTickets.toLocaleString("fa-IR")}
      </span>
    `);
  }

  const newOrders = data.orders?.new || 0;
  if (newOrders > 0) {
    alerts.push(`
      <span class="alert-pill warning">
        🟠 سفارش‌های جدید ${newOrders.toLocaleString("fa-IR")}
      </span>
    `);
  }

  container.innerHTML = alerts.join("");
}

async function loadDashboard() {
  const productsContainer = document.getElementById("products-stats");
  const ordersContainer = document.getElementById("orders-stats");
  const ticketsContainer = document.getElementById("tickets-stats");

  try {
    const data = await fetchAdmin("/admin/summary");

    renderAlerts(data);

    productsContainer.innerHTML = [
      renderStatBox(data.products?.total, "تعداد کل محصولات"),
      renderStatBox(data.products?.active, "محصولات فعال"),
      renderStatBox(data.products?.inactive, "محصولات غیرفعال"),
    ].join("");

    ordersContainer.innerHTML = [
      renderStatBox(data.orders?.total, "تعداد کل سفارش‌ها"),
      renderStatBox(data.orders?.new, "سفارش‌های جدید"),
      renderStatBox(data.orders?.in_review, "در حال بررسی"),
      renderStatBox(data.orders?.shipped, "ارسال‌شده"),
      renderStatBox(data.orders?.completed, "تکمیل‌شده"),
    ].join("");

    ticketsContainer.innerHTML = [
      renderStatBox(data.tickets?.total, "تعداد کل تیکت‌ها"),
      renderStatBox(data.tickets?.new, "تیکت‌های جدید"),
      renderStatBox(data.tickets?.in_progress, "در حال پیگیری"),
      renderStatBox(data.tickets?.unanswered, "پاسخ‌داده‌نشده"),
    ].join("");
  } catch (error) {
    const message = `<p class="loading">${escapeHtml(error.message)}</p>`;
    productsContainer.innerHTML = message;
    ordersContainer.innerHTML = message;
    ticketsContainer.innerHTML = message;
  }
}

// =========================
// وضعیت عملیاتی سایت (توقف موقت فروشگاه/خدمات)
// =========================

function renderSiteStatusControl(kind, status) {
  // kind: "store" | "services"
  const chip = document.getElementById(`${kind}-status-chip`);
  const button = document.getElementById(`${kind}-status-toggle`);
  if (!chip || !button) return;

  const isOpen = status === "open";
  chip.textContent = isOpen ? "● فعال" : "● متوقف";
  chip.className = `site-status-chip ${isOpen ? "open" : "paused"}`;
  button.textContent = isOpen
    ? (kind === "store" ? "توقف موقت فروشگاه" : "توقف موقت خدمات")
    : (kind === "store" ? "فعال‌سازی فروشگاه" : "فعال‌سازی خدمات");
  button.disabled = false;
  button.dataset.nextStatus = isOpen ? "paused" : "open";
}

async function loadSiteStatus() {
  try {
    const data = await fetchAdmin("/admin/site-status");
    renderSiteStatusControl("store", data.store_status);
    renderSiteStatusControl("services", data.services_status);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleSiteStatus(kind) {
  const button = document.getElementById(`${kind}-status-toggle`);
  if (!button) return;

  const nextStatus = button.dataset.nextStatus;
  const label = kind === "store" ? "فروشگاه" : "خدمات";
  const confirmMessage = nextStatus === "paused"
    ? `آیا مطمئن هستید؟ با توقف ${label}، ثبت ${kind === "store" ? "سفارش‌های" : "درخواست‌های"} جدید متوقف خواهد شد.`
    : `آیا مطمئن هستید که می‌خواهید ${label} را دوباره فعال کنید؟`;

  if (!confirm(confirmMessage)) return;

  button.disabled = true;

  try {
    const data = await fetchAdmin(`/admin/site-status/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    renderSiteStatusControl("store", data.store_status);
    renderSiteStatusControl("services", data.services_status);
    showToast("وضعیت با موفقیت تغییر کرد.", "success");
  } catch (error) {
    showToast(error.message, "error");
    button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("dashboard");
  loadDashboard();
  loadSiteStatus();

  const refreshButton = document.getElementById("refresh-summary");
  if (refreshButton) {
    refreshButton.addEventListener("click", loadDashboard);
  }

  const storeToggle = document.getElementById("store-status-toggle");
  if (storeToggle) {
    storeToggle.addEventListener("click", () => toggleSiteStatus("store"));
  }

  const servicesToggle = document.getElementById("services-status-toggle");
  if (servicesToggle) {
    servicesToggle.addEventListener("click", () => toggleSiteStatus("services"));
  }
});
