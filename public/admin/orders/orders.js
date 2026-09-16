// =========================
// مدیریت سفارش‌ها — /admin/orders/
// =========================

let ordersCache = [];
let currentPage = 1;
const PAGE_LIMIT = 20;

async function loadOrders(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");
  if (!container) return;

  container.innerHTML = '<p class="loading">در حال بارگذاری سفارش‌ها...</p>';

  const q = document.getElementById("orders-search")?.value.trim() || "";
  const status = document.getElementById("orders-status-filter")?.value || "";

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);
  if (q) params.set("q", q);
  if (status) params.set("status", status);

  try {
    const data = await fetchAdmin(`/orders?${params.toString()}`);
    currentPage = data.page || page;
    ordersCache = data.orders || [];
    renderOrders();
    renderPagination(paginationContainer, data, (targetPage) => loadOrders(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderOrders() {
  const container = document.getElementById("list-container");
  if (!container) return;

  if (ordersCache.length === 0) {
    container.innerHTML = '<p class="loading">سفارشی یافت نشد.</p>';
    return;
  }

  container.innerHTML = ordersCache.map((order) => {
    const status = order.status || "pending";
    const paymentLabel = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status || "پرداخت‌نشده";
    const openTickets = Number(order.open_ticket_count || 0);

    return `
      <div class="order-admin-item">
        <div class="order-admin-main">
          <div>
            <strong>سفارش ${escapeHtml(order.tracking_code || ("#" + order.id))}</strong>
            ${
              openTickets > 0
                ? `<a href="../support/?order_id=${Number(order.id)}" class="badge red">🟥 ${openTickets > 1 ? openTickets.toLocaleString("fa-IR") + " تیکت" : "تیکت جدید"}</a>`
                : ""
            }
            <span>${order.is_guest ? "مهمان" : "مشتری ثبت‌نامی"}: ${escapeHtml(order.customer_name)} (${escapeHtml(order.customer_phone || "")})</span>
            <span>آدرس: ${escapeHtml(order.customer_address || "-")}</span>
            <span>مبلغ: ${formatPrice(order.total)} تومان &middot; پرداخت: ${escapeHtml(paymentLabel)}</span>
            <span>تاریخ: ${escapeHtml(formatDate(order.created_at))}</span>
          </div>

          <div class="order-status-box">
            <label>وضعیت سفارش</label>
            <select class="order-status-select" onchange="changeOrderStatus(${Number(order.id)}, this.value)">
              ${Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => `
                <option value="${value}" ${value === status ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
            <small>وضعیت فعلی: ${escapeHtml(ORDER_STATUS_LABELS[status] || status)}</small>

            <div class="postal-info-box">
              <input type="text" placeholder="شرکت پستی/باربری" id="postal-carrier-${Number(order.id)}" value="${escapeAttribute(order.postal_carrier || "")}">
              <input type="text" placeholder="کد مرسوله پستی" id="postal-code-${Number(order.id)}" value="${escapeAttribute(order.postal_tracking_code || "")}">
              <button type="button" class="secondary-button" onclick="savePostalInfo(${Number(order.id)})">ثبت اطلاعات ارسال</button>
            </div>
          </div>

          <button type="button" class="secondary-button" onclick="showOrderDetails(${Number(order.id)})">جزئیات</button>
        </div>
      </div>
    `;
  }).join("");
}

async function changeOrderStatus(orderId, newStatus) {
  const order = ordersCache.find((item) => Number(item.id) === Number(orderId));
  if (!order) return;

  const oldStatus = order.status || "pending";
  if (newStatus === oldStatus) return;

  const newLabel = ORDER_STATUS_LABELS[newStatus] || newStatus;
  const confirmed = confirm(`وضعیت سفارش شماره ${orderId} به «${newLabel}» تغییر کند؟`);
  if (!confirmed) {
    renderOrders();
    return;
  }

  // مقادیر فعلی فیلدهای «شرکت پستی/کد مرسوله» را همراه همین درخواست
  // می‌فرستیم — حتی اگر هنوز جداگانه با «ثبت اطلاعات ارسال» ذخیره نشده باشند.
  // این تضمین می‌کند اگر مدیر قبل از تغییر وضعیت، کد رهگیری را تایپ کرده
  // باشد، همان لحظه در D1 ذخیره شود و پیامک ارسال سفارش کد رهگیری درست را
  // ببیند (نه این‌که به‌خاطر دو درخواست جدا از هم، کد رهگیری هنوز ذخیره
  // نشده باشد و پیامک بدون کد رهگیری برود).
  const postalCarrier = document.getElementById(`postal-carrier-${Number(orderId)}`)?.value.trim() || "";
  const postalTrackingCode = document.getElementById(`postal-code-${Number(orderId)}`)?.value.trim() || "";

  try {
    await fetchAdmin(`/orders/${Number(orderId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        postal_carrier: postalCarrier,
        postal_tracking_code: postalTrackingCode,
      }),
    });

    order.status = newStatus;
    if (postalCarrier) order.postal_carrier = postalCarrier;
    if (postalTrackingCode) order.postal_tracking_code = postalTrackingCode;
    renderOrders();
    showToast("وضعیت سفارش با موفقیت تغییر کرد.", "success");
  } catch (error) {
    showToast(error.message, "error");
    renderOrders();
  }
}

async function savePostalInfo(orderId) {
  const order = ordersCache.find((item) => Number(item.id) === Number(orderId));
  if (!order) return;

  const postalCarrier = document.getElementById(`postal-carrier-${Number(orderId)}`)?.value.trim() || "";
  const postalTrackingCode = document.getElementById(`postal-code-${Number(orderId)}`)?.value.trim() || "";

  try {
    await fetchAdmin(`/orders/${Number(orderId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: order.status || "pending",
        postal_carrier: postalCarrier,
        postal_tracking_code: postalTrackingCode,
      }),
    });

    order.postal_carrier = postalCarrier;
    order.postal_tracking_code = postalTrackingCode;
    showToast("اطلاعات ارسال با موفقیت ثبت شد.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// =========================
// جزئیات سفارش (Modal)
// =========================

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

async function showOrderDetails(orderId) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
        <h3 class="modal-title">جزئیات سفارش</h3>
        <p class="loading">در حال بارگذاری...</p>
      </div>
    </div>
  `;

  try {
    const data = await fetchAdmin(`/orders/${Number(orderId)}`);
    const order = data.order;

    const itemsRows = (order.items || []).map((item) => `
      <div class="detail-row">
        <span>${escapeHtml(item.product_name)} × ${Number(item.quantity || 0).toLocaleString("fa-IR")}</span>
        <span>${formatPrice(item.subtotal || item.price * item.quantity)} تومان</span>
      </div>
    `).join("") || '<p class="loading">بدون کالا</p>';

    const paymentLabel = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status || "-";
    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status || "-";

    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
          <h3 class="modal-title">جزئیات سفارش ${escapeHtml(order.tracking_code || ("#" + order.id))}</h3>

          <div class="detail-row"><span>نام مشتری</span><span>${escapeHtml(order.customer_name || "-")}</span></div>
          <div class="detail-row"><span>موبایل</span><span>${escapeHtml(order.customer_phone || "-")}</span></div>
          <div class="detail-row"><span>آدرس</span><span>${escapeHtml(order.customer_address || "-")}</span></div>
          <div class="detail-row"><span>وضعیت سفارش</span><span class="status-chip">${escapeHtml(statusLabel)}</span></div>
          <div class="detail-row"><span>وضعیت پرداخت</span><span>${escapeHtml(paymentLabel)}</span></div>
          ${
            order.postal_tracking_code
              ? `<div class="detail-row"><span>اطلاعات ارسال</span><span>${escapeHtml(order.postal_carrier || "-")} — ${escapeHtml(order.postal_tracking_code)}</span></div>`
              : ""
          }

          <h4 style="margin:16px 0 8px; color:#173b3b;">کالاها</h4>
          ${itemsRows}

          <div class="detail-row" style="border-bottom:none; margin-top:10px; font-weight:800;">
            <span>مبلغ کل</span><span>${formatPrice(order.total)} تومان</span>
          </div>
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

// =========================
// شروع
// =========================

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("orders");

  document.getElementById("refresh-orders")?.addEventListener("click", () => loadOrders(currentPage));
  document.getElementById("orders-search-button")?.addEventListener("click", () => loadOrders(1));
  document.getElementById("orders-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadOrders(1);
    }
  });
  document.getElementById("orders-status-filter")?.addEventListener("change", () => loadOrders(1));

  loadOrders(1);
});
