// =========================
// مدیریت پشتیبانی — /admin/support/
// =========================

let ticketsCache = [];
let currentPage = 1;
const PAGE_LIMIT = 20;

function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function loadTickets(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");
  if (!container) return;

  container.innerHTML = '<p class="loading">در حال بارگذاری تیکت‌ها...</p>';

  const q = document.getElementById("tickets-search")?.value.trim() || "";
  const status = document.getElementById("tickets-status-filter")?.value || "";
  const orderId = getUrlParam("order_id") || "";

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (orderId) params.set("order_id", orderId);

  try {
    const data = await fetchSupportAdmin(`/admin/tickets?${params.toString()}`);
    currentPage = data.page || page;
    ticketsCache = data.tickets || [];
    renderTickets();
    renderPagination(paginationContainer, data, (targetPage) => loadTickets(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderOrderFilterBanner() {
  const banner = document.getElementById("order-filter-banner");
  const orderId = getUrlParam("order_id");
  if (!banner) return;

  if (orderId) {
    banner.style.display = "block";
    banner.innerHTML = `
      <div class="alert-pill warning" style="margin-bottom:14px;">
        نمایش تیکت‌های مربوط به سفارش #${escapeHtml(orderId)}
        <a href="./" style="margin-inline-start:8px; text-decoration:underline;">حذف فیلتر</a>
      </div>
    `;
  } else {
    banner.style.display = "none";
    banner.innerHTML = "";
  }
}

function renderTickets() {
  const container = document.getElementById("list-container");
  if (!container) return;

  if (ticketsCache.length === 0) {
    container.innerHTML = '<p class="loading">تیکتی یافت نشد.</p>';
    return;
  }

  container.innerHTML = ticketsCache.map((ticket) => `
    <div class="ticket-admin-item" onclick="showTicketDetails(${Number(ticket.id)})">
      <div class="ticket-admin-info">
        <strong>${escapeHtml(ticket.tracking_code)} — ${escapeHtml(ticket.subject)}</strong>
        <span>${escapeHtml(ticket.name)} (${escapeHtml(ticket.mobile)})</span>
        <span>ایجاد: ${escapeHtml(formatDate(ticket.created_at))} &middot; آخرین بروزرسانی: ${escapeHtml(formatDate(ticket.updated_at))}</span>
        ${ticket.order_id ? `<span>سفارش مرتبط: #${Number(ticket.order_id)}</span>` : ""}
      </div>
      <span class="status-chip">${escapeHtml(TICKET_STATUS_LABELS[ticket.status] || ticket.status)}</span>
    </div>
  `).join("");
}

// =========================
// جزئیات تیکت + گفتگو (Modal)
// =========================

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

function renderTicketModal(ticket) {
  const messagesHtml = (ticket.messages || []).map((m) => `
    <div class="ticket-message ${m.sender_type === "admin" ? "admin" : "customer"}">
      <div>${escapeHtml(m.message)}</div>
      <div class="meta">${m.sender_type === "admin" ? "پشتیبانی" : "مشتری"} &middot; ${escapeHtml(formatDate(m.created_at))}</div>
    </div>
  `).join("") || '<p class="loading">پیامی ثبت نشده است.</p>';

  return `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
        <h3 class="modal-title">${escapeHtml(ticket.tracking_code)} — ${escapeHtml(ticket.subject)}</h3>

        <div class="detail-row"><span>نام مشتری</span><span>${escapeHtml(ticket.name)}</span></div>
        <div class="detail-row"><span>موبایل</span><span>${escapeHtml(ticket.mobile)}</span></div>
        ${ticket.email ? `<div class="detail-row"><span>ایمیل</span><span>${escapeHtml(ticket.email)}</span></div>` : ""}
        ${ticket.order_id ? `<div class="detail-row"><span>سفارش مرتبط</span><span>#${Number(ticket.order_id)}</span></div>` : ""}
        <div class="detail-row">
          <span>وضعیت</span>
          <span>
            <select id="ticket-status-select" onchange="changeTicketStatus(${Number(ticket.id)}, this.value)">
              ${Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => `
                <option value="${value}" ${value === ticket.status ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
          </span>
        </div>

        <h4 style="margin:16px 0 8px; color:#173b3b;">گفتگو</h4>
        <div class="ticket-conversation">${messagesHtml}</div>

        <div class="reply-box">
          <textarea id="ticket-reply-text" placeholder="پاسخ خود را بنویسید..."></textarea>
          <div class="form-actions">
            <button type="button" class="primary-button" onclick="sendTicketReply(${Number(ticket.id)})">ارسال پاسخ</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function showTicketDetails(ticketId) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-box">
        <p class="loading">در حال بارگذاری...</p>
      </div>
    </div>
  `;

  try {
    const data = await fetchSupportAdmin(`/admin/tickets/${Number(ticketId)}`);
    root.innerHTML = renderTicketModal(data.ticket);
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

async function changeTicketStatus(ticketId, status) {
  try {
    await fetchSupportAdmin(`/admin/tickets/${Number(ticketId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    showToast("وضعیت تیکت با موفقیت تغییر کرد.", "success");
    loadTickets(currentPage);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function sendTicketReply(ticketId) {
  const textarea = document.getElementById("ticket-reply-text");
  const message = textarea?.value.trim();

  if (!message) {
    showToast("متن پاسخ نمی‌تواند خالی باشد.", "error");
    return;
  }

  try {
    await fetchSupportAdmin(`/admin/tickets/${Number(ticketId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    showToast("پاسخ با موفقیت ارسال شد.", "success");
    await showTicketDetails(ticketId);
    loadTickets(currentPage);
  } catch (error) {
    showToast(error.message, "error");
  }
}

// =========================
// شروع
// =========================

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("support");
  renderOrderFilterBanner();

  document.getElementById("refresh-tickets")?.addEventListener("click", () => loadTickets(currentPage));
  document.getElementById("tickets-search-button")?.addEventListener("click", () => loadTickets(1));
  document.getElementById("tickets-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadTickets(1);
    }
  });
  document.getElementById("tickets-status-filter")?.addEventListener("change", () => loadTickets(1));

  const ticketParam = getUrlParam("ticket");
  loadTickets(1).then(() => {
    if (ticketParam) {
      showTicketDetails(Number(ticketParam));
    }
  });
});
