// =========================
// پیامک زمان‌بندی‌شده — /admin/sms/scheduled/
// =========================

function renderStatBox(value, label) {
  return `
    <div class="stat-box">
      <div class="stat-value">${Number(value || 0).toLocaleString("fa-IR")}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `;
}

async function loadScheduledStatus() {
  const banner = document.getElementById("cron-status-banner");
  const statsContainer = document.getElementById("scheduled-stats");
  const noteEl = document.getElementById("scheduled-note");

  try {
    const data = await fetchAdmin("/admin/sms/scheduled-status");

    banner.innerHTML = `
      <div class="alert-pill ${data.cron_configured ? "" : "warning"}">
        ${data.cron_configured ? "🟢 Cron فعال است" : "🟠 Cron واقعی هنوز پیکربندی نشده — این بخش فقط آماده‌سازی است"}
      </div>
    `;

    statsContainer.innerHTML = [
      renderStatBox(data.eligible_boiler_service_count, "مشتریان سررسیده سرویس سالانه پکیج"),
      renderStatBox(data.customers_with_birthday_count, "مشتریان دارای تاریخ تولد ثبت‌شده"),
    ].join("");

    noteEl.textContent = data.note || "";
  } catch (error) {
    statsContainer.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-scheduled");
  loadScheduledStatus();
});
