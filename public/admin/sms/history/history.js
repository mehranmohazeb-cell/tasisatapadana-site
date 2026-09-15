// =========================
// تاریخچه پیامک — /admin/sms/history/
// =========================

let currentPage = 1;
const PAGE_LIMIT = 20;

function smsStatusLabel(status) {
  const labels = { sent: "ارسال شده", failed: "ناموفق", skipped_no_template: "بدون قالب" };
  return labels[status] || status;
}

async function loadHistory(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");

  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);

  const mobile = document.getElementById("filter-mobile")?.value.trim();
  const category = document.getElementById("filter-category")?.value;
  const status = document.getElementById("filter-status")?.value;
  const dateFrom = document.getElementById("filter-date-from")?.value;
  const dateTo = document.getElementById("filter-date-to")?.value;

  if (mobile) params.set("mobile", mobile);
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  try {
    const data = await fetchAdmin(`/admin/sms/history?${params.toString()}`);
    currentPage = data.page || page;
    renderHistory(data.messages || []);
    renderPagination(paginationContainer, data, (targetPage) => loadHistory(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderHistory(messages) {
  const container = document.getElementById("list-container");

  if (messages.length === 0) {
    container.innerHTML = '<p class="loading">پیامکی یافت نشد.</p>';
    return;
  }

  container.innerHTML = messages.map((m) => `
    <div class="ticket-admin-item" onclick="showDetail(${Number(m.id)})">
      <div class="ticket-admin-info">
        <strong>${escapeHtml(m.title || m.event_type)}</strong>
        <span>${escapeHtml(m.customer_name || "مهمان")} — ${escapeHtml(m.mobile)}</span>
        <span>${escapeHtml(formatDate(m.created_at))} ${m.template_id ? "&middot; قالب " + m.template_id : ""}</span>
      </div>
      <span class="badge ${m.status === "sent" ? "gray" : "red"}">${escapeHtml(smsStatusLabel(m.status))}</span>
    </div>
  `).join("");
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

async function showDetail(id) {
  const root = document.getElementById("modal-root");

  root.innerHTML = `
    <div class="modal-overlay"><div class="modal-box"><p class="loading">در حال بارگذاری...</p></div></div>
  `;

  try {
    const data = await fetchAdmin(`/admin/sms/history/${id}`);
    const m = data.message;

    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
          <h3 class="modal-title">${escapeHtml(m.title || m.event_type)}</h3>

          <div class="detail-row"><span>مشتری</span><span>${escapeHtml(m.customer_name || "مهمان")}</span></div>
          <div class="detail-row"><span>موبایل</span><span>${escapeHtml(m.mobile)}</span></div>
          <div class="detail-row"><span>دسته</span><span>${escapeHtml(m.category_label || "-")}</span></div>
          <div class="detail-row"><span>Template ID</span><span>${escapeHtml(m.template_id || "-")}</span></div>
          <div class="detail-row"><span>وضعیت</span><span class="status-chip">${escapeHtml(smsStatusLabel(m.status))}</span></div>
          <div class="detail-row"><span>Provider</span><span>${escapeHtml(m.provider)}</span></div>
          <div class="detail-row"><span>Provider Message ID</span><span>${escapeHtml(m.provider_message_id || "-")}</span></div>
          ${m.error_code ? `<div class="detail-row"><span>خطا</span><span>${escapeHtml(m.error_code)}</span></div>` : ""}
          <div class="detail-row"><span>تاریخ ثبت</span><span>${escapeHtml(formatDate(m.created_at))}</span></div>
          <div class="detail-row"><span>زمان ارسال</span><span>${escapeHtml(m.sent_at ? formatDate(m.sent_at) : "-")}</span></div>
        </div>
      </div>
    `;
  } catch (error) {
    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
          <p class="loading">${escapeHtml(error.message)}</p>
        </div>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-history");

  loadHistory(1);

  document.getElementById("refresh-history")?.addEventListener("click", () => loadHistory(currentPage));
  document.getElementById("apply-filters")?.addEventListener("click", () => loadHistory(1));
  document.getElementById("filter-category")?.addEventListener("change", () => loadHistory(1));
  document.getElementById("filter-status")?.addEventListener("change", () => loadHistory(1));
  document.getElementById("filter-mobile")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadHistory(1);
    }
  });
});
