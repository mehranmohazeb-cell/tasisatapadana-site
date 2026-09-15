// =========================
// قالب‌های پیامک — /admin/sms/templates/
// =========================

let templatesCache = [];

async function loadTemplates() {
  const container = document.getElementById("list-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin("/admin/sms/templates");
    templatesCache = data.templates || [];
    renderTemplates();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderTemplates() {
  const container = document.getElementById("list-container");
  const categoryFilter = document.getElementById("filter-category")?.value;

  const filtered = categoryFilter
    ? templatesCache.filter((t) => t.category === categoryFilter)
    : templatesCache;

  if (filtered.length === 0) {
    container.innerHTML = '<p class="loading">قالبی یافت نشد.</p>';
    return;
  }

  container.innerHTML = filtered.map((t) => `
    <div class="product-admin-item" style="grid-template-columns: 1fr auto;">
      <div class="product-admin-info">
        <strong>${escapeHtml(t.title)} <span class="status-chip" style="margin-inline-start:6px;">${escapeHtml(t.category_label)}</span></strong>
        <span>Event: ${escapeHtml(t.event_type)}</span>
        <span>متغیرها: ${escapeHtml((t.variables || []).join(", ") || "-")}</span>
        <span>ارسال: ${Number(t.stats.total).toLocaleString("fa-IR")} &middot; موفق: ${Number(t.stats.sent).toLocaleString("fa-IR")} &middot; ناموفق: ${Number(t.stats.failed).toLocaleString("fa-IR")}</span>
        <span>آخرین ارسال: ${t.stats.last_sent_at ? escapeHtml(formatDate(t.stats.last_sent_at)) : "هنوز ارسال نشده"}</span>
        <span class="badge ${t.enabled ? "gray" : "red"}">${t.enabled ? "فعال" : "غیرفعال"}${t.is_overridden ? " (سفارشی‌شده)" : ""}</span>
      </div>
      <button type="button" class="secondary-button" onclick="openEditModal('${escapeAttribute(t.event_type)}')">ویرایش</button>
    </div>
  `).join("");
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

function openEditModal(eventType) {
  const template = templatesCache.find((t) => t.event_type === eventType);
  if (!template) return;

  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <button type="button" class="modal-close" onclick="closeModal()">بستن ✕</button>
        <h3 class="modal-title">${escapeHtml(template.title)}</h3>

        <div class="detail-row"><span>Event Type</span><span>${escapeHtml(template.event_type)}</span></div>
        <div class="detail-row"><span>دسته</span><span>${escapeHtml(template.category_label)}</span></div>
        <div class="detail-row"><span>متغیرها</span><span>${escapeHtml((template.variables || []).join(", "))}</span></div>
        <div class="detail-row"><span>Template ID پیش‌فرض</span><span>${escapeHtml(template.default_template_id)}</span></div>

        <div class="form-group" style="margin-top:14px;">
          <label for="edit-template-id">Template ID</label>
          <input id="edit-template-id" type="text" value="${escapeAttribute(template.template_id ?? "")}" placeholder="مثلاً ${escapeAttribute(template.default_template_id)}">
          <small>خالی گذاشتن این فیلد یعنی استفاده از همان Template ID پیش‌فرض کد. برای غیرفعال کردن کامل این قالب، تیک «فعال باشد» را بردارید.</small>
        </div>

        <div class="form-group checkbox-group" style="margin-top:10px;">
          <label>
            <input id="edit-template-enabled" type="checkbox" ${template.enabled ? "checked" : ""}>
            این قالب فعال باشد
          </label>
        </div>

        <div class="form-actions">
          <button type="button" class="primary-button" onclick="saveTemplate('${escapeAttribute(eventType)}')">ذخیره</button>
        </div>
      </div>
    </div>
  `;
}

async function saveTemplate(eventType) {
  const templateIdInput = document.getElementById("edit-template-id").value.trim();
  const enabled = document.getElementById("edit-template-enabled").checked;

  if (templateIdInput && !/^\d+$/.test(templateIdInput)) {
    showToast("Template ID باید فقط عدد باشد.", "error");
    return;
  }

  try {
    await fetchAdmin(`/admin/sms/templates/${encodeURIComponent(eventType)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: templateIdInput ? Number(templateIdInput) : null,
        enabled,
      }),
    });

    showToast("تنظیمات قالب ذخیره شد.", "success");
    closeModal();
    loadTemplates();
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-templates");

  loadTemplates();

  document.getElementById("refresh-templates")?.addEventListener("click", loadTemplates);
  document.getElementById("filter-category")?.addEventListener("change", renderTemplates);
});
