// =========================
// رضایت پیامکی — /admin/sms/consent/
// =========================

let customersCache = [];
let currentPage = 1;
const PAGE_LIMIT = 20;

async function loadCustomers(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");

  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);

  const q = document.getElementById("filter-search")?.value.trim();
  const consent = document.getElementById("filter-consent")?.value;

  if (q) params.set("q", q);
  if (consent) params.set("consent", consent);

  try {
    const data = await fetchAdmin(`/admin/customers?${params.toString()}`);
    currentPage = data.page || page;
    customersCache = data.customers || [];
    renderCustomers();
    renderPagination(paginationContainer, data, (targetPage) => loadCustomers(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderCustomers() {
  const container = document.getElementById("list-container");

  if (customersCache.length === 0) {
    container.innerHTML = '<p class="loading">مشتری یافت نشد.</p>';
    return;
  }

  container.innerHTML = customersCache.map((c) => `
    <div class="product-admin-item" style="grid-template-columns: 1fr auto;">
      <div class="product-admin-info">
        <strong>${escapeHtml(c.full_name)}</strong>
        <span>${escapeHtml(c.phone)} ${c.phone_verified ? "(شماره تأییدشده)" : ""}</span>
        <span>عضویت: ${escapeHtml(formatDate(c.created_at))}</span>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:13px; white-space:nowrap;">
        <input type="checkbox" ${c.sms_marketing_consent ? "checked" : ""} onchange="toggleConsent(${Number(c.id)}, this.checked)">
        رضایت تبلیغاتی
      </label>
    </div>
  `).join("");
}

async function toggleConsent(customerId, checked) {
  try {
    await fetchAdmin(`/admin/customers/${customerId}/consent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sms_marketing_consent: checked }),
    });
    showToast("رضایت پیامکی بروزرسانی شد.", "success");
  } catch (error) {
    showToast(error.message, "error");
    loadCustomers(currentPage);
  }
}

async function previewCampaign() {
  const filter = document.getElementById("campaign-filter").value;
  const resultContainer = document.getElementById("campaign-preview-result");

  resultContainer.innerHTML = '<p class="loading">در حال محاسبه...</p>';

  try {
    const data = await fetchAdmin("/admin/sms/campaign/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter }),
    });

    resultContainer.innerHTML = `
      <p style="margin-top:12px; font-weight:700; color:#173b3b;">
        این پیام برای ${Number(data.recipient_count).toLocaleString("fa-IR")} مشتری ارسال خواهد شد.
      </p>
      <p style="font-size:12px; color:#a23b3b;">${escapeHtml(data.note)}</p>
    `;
  } catch (error) {
    resultContainer.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-consent");

  loadCustomers(1);

  document.getElementById("refresh-consent")?.addEventListener("click", () => loadCustomers(currentPage));
  document.getElementById("filter-consent")?.addEventListener("change", () => loadCustomers(1));
  document.getElementById("filter-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadCustomers(1);
    }
  });

  document.getElementById("campaign-preview-button")?.addEventListener("click", previewCampaign);
});
