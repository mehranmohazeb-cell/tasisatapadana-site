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
      <a href="../support/" class="alert-pill danger">
        🔴 پشتیبانی ${unansweredTickets.toLocaleString("fa-IR")}
      </a>
    `);
  }

  const newOrders = data.orders?.new || 0;
  if (newOrders > 0) {
    alerts.push(`
      <a href="../orders/" class="alert-pill warning">
        🟠 سفارش‌های جدید ${newOrders.toLocaleString("fa-IR")}
      </a>
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

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("dashboard");
  loadDashboard();

  const refreshButton = document.getElementById("refresh-summary");
  if (refreshButton) {
    refreshButton.addEventListener("click", loadDashboard);
  }
});
