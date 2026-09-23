// =========================
// Table Rate Shipping — /admin/shipping/table-rates/
// =========================

let tableRatesCache = [];
let shippingMethodsForForm = [];
let shippingClassesForForm = [];

async function loadFormOptions() {
  try {
    const [methodsData, classesData] = await Promise.all([
      fetchAdmin("/admin/shipping-methods"),
      fetchAdmin("/admin/shipping-classes"),
    ]);
    shippingMethodsForForm = methodsData.shipping_methods || [];
    shippingClassesForForm = classesData.shipping_classes || [];

    const methodSelect = document.getElementById("rate-method");
    methodSelect.innerHTML = shippingMethodsForForm
      .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
      .join("");

    const classSelect = document.getElementById("rate-class");
    classSelect.innerHTML =
      '<option value="">— همه Classها —</option>' +
      shippingClassesForForm.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadTableRates() {
  const container = document.getElementById("list-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin("/admin/shipping-table-rates");
    tableRatesCache = data.table_rates || [];
    renderTableRates();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function describeCondition(rate) {
  const parts = [];
  if (rate.min_weight_grams != null || rate.max_weight_grams != null) {
    parts.push(`وزن: ${rate.min_weight_grams ?? "۰"} تا ${rate.max_weight_grams ?? "∞"} گرم`);
  }
  if (rate.min_quantity != null || rate.max_quantity != null) {
    parts.push(`تعداد: ${rate.min_quantity ?? "۰"} تا ${rate.max_quantity ?? "∞"}`);
  }
  if (rate.min_cart_value != null || rate.max_cart_value != null) {
    parts.push(`مبلغ سبد: ${rate.min_cart_value ?? "۰"} تا ${rate.max_cart_value ?? "∞"} تومان`);
  }
  if (rate.destination_city) parts.push(`مقصد: ${rate.destination_city}`);
  return parts.length ? parts.join(" | ") : "بدون شرط (همیشه منطبق)";
}

function renderTableRates() {
  const container = document.getElementById("list-container");

  if (tableRatesCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز Table Rateای ثبت نشده است.</p>';
    return;
  }

  container.innerHTML = tableRatesCache.map((r) => `
    <div class="rate-row">
      <div>
        <strong>${escapeHtml(r.method_name || "-")}</strong>
        ${r.class_name ? ` — ${escapeHtml(r.class_name)}` : " — همه Classها"}
        ${Number(r.active) === 0 ? '<span class="shipping-badge inactive">غیرفعال</span>' : ""}
        <br>
        <span style="color:#71817e;">${escapeHtml(describeCondition(r))}</span>
        <br>
        <span>هزینه: ${Number(r.cost).toLocaleString("fa-IR")} تومان — اولویت: ${r.priority}</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary-button" onclick="editRate(${Number(r.id)})">ویرایش</button>
        <button type="button" class="danger-button" onclick="deleteRate(${Number(r.id)})">حذف</button>
      </div>
    </div>
  `).join("");
}

function resetRateForm() {
  document.getElementById("rate-form").reset();
  document.getElementById("rate-id").value = "";
  document.getElementById("rate-active").checked = true;
  document.getElementById("form-title").textContent = "افزودن Table Rate جدید";
  document.getElementById("cancel-rate-edit").style.display = "none";
}

function editRate(id) {
  const r = tableRatesCache.find((x) => x.id === id);
  if (!r) return;

  document.getElementById("rate-id").value = r.id;
  document.getElementById("rate-method").value = r.shipping_method_id;
  document.getElementById("rate-class").value = r.shipping_class_id || "";
  document.getElementById("rate-cost").value = r.cost;
  document.getElementById("rate-min-weight").value = r.min_weight_grams ?? "";
  document.getElementById("rate-max-weight").value = r.max_weight_grams ?? "";
  document.getElementById("rate-min-qty").value = r.min_quantity ?? "";
  document.getElementById("rate-max-qty").value = r.max_quantity ?? "";
  document.getElementById("rate-min-value").value = r.min_cart_value ?? "";
  document.getElementById("rate-max-value").value = r.max_cart_value ?? "";
  document.getElementById("rate-destination").value = r.destination_city || "";
  document.getElementById("rate-priority").value = r.priority;
  document.getElementById("rate-active").checked = Number(r.active) !== 0;

  document.getElementById("form-title").textContent = "ویرایش Table Rate";
  document.getElementById("cancel-rate-edit").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRate(id) {
  if (!confirm("این Table Rate حذف شود؟")) return;
  try {
    await fetchAdmin(`/admin/shipping-table-rates?id=${id}`, { method: "DELETE" });
    showToast("حذف شد.", "success");
    loadTableRates();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function exportTableRatesCsv() {
  try {
    const token = requireAdminToken();
    const response = await fetch(`${ADMIN_API_BASE}/admin/shipping-table-rates/export.csv`, {
      headers: { "X-Admin-Token": token },
    });
    if (!response.ok) throw new Error("خروجی گرفتن ممکن نشد.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "shipping-table-rates.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-table-rates");
  loadFormOptions().then(loadTableRates);

  document.getElementById("refresh-rates")?.addEventListener("click", loadTableRates);
  document.getElementById("cancel-rate-edit")?.addEventListener("click", resetRateForm);
  document.getElementById("export-csv-btn")?.addEventListener("click", exportTableRatesCsv);

  document.getElementById("rate-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.getElementById("rate-id").value;
    const val = (elId) => {
      const v = document.getElementById(elId).value;
      return v === "" ? null : Number(v);
    };

    const payload = {
      shipping_method_id: Number(document.getElementById("rate-method").value),
      shipping_class_id: document.getElementById("rate-class").value || null,
      cost: val("rate-cost"),
      min_weight_grams: val("rate-min-weight"),
      max_weight_grams: val("rate-max-weight"),
      min_quantity: val("rate-min-qty"),
      max_quantity: val("rate-max-qty"),
      min_cart_value: val("rate-min-value"),
      max_cart_value: val("rate-max-value"),
      destination_city: document.getElementById("rate-destination").value.trim() || null,
      priority: Number(document.getElementById("rate-priority").value) || 0,
      active: document.getElementById("rate-active").checked,
    };

    try {
      if (id) {
        await fetchAdmin("/admin/shipping-table-rates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: Number(id) }),
        });
        showToast("ویرایش شد.", "success");
      } else {
        await fetchAdmin("/admin/shipping-table-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showToast("ایجاد شد.", "success");
      }
      resetRateForm();
      loadTableRates();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
