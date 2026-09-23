// =========================
// مدیریت روش‌های ارسال — /admin/shipping/
// =========================

let methodsCache = [];

async function loadMethods() {
  const container = document.getElementById("list-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin("/admin/shipping-methods");
    methodsCache = data.shipping_methods || [];
    renderMethods();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderMethods() {
  const container = document.getElementById("list-container");

  if (methodsCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز روش ارسالی ثبت نشده است.</p>';
    return;
  }

  container.innerHTML = methodsCache.map((m) => {
    const scopeText = m.scope === "city" ? `فقط شهر: ${escapeHtml(m.allowed_city || "-")}` : "همه مقصدها";
    return `
      <div class="shipping-method-row">
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <span class="shipping-badge ${m.cost_type === "cod" ? "cod" : "prepaid"}">
            ${m.cost_type === "cod" ? "پس‌کرایه" : "پرداخت آنلاین"}
          </span>
          ${Number(m.active) === 0 ? '<span class="shipping-badge inactive">غیرفعال</span>' : ""}
          <br>
          <span style="font-size:13px; color:#71817e;">
            ${Number(m.cost).toLocaleString("fa-IR")} تومان — ${scopeText}
          </span>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="secondary-button" onclick="editMethod(${Number(m.id)})">ویرایش</button>
          <button type="button" class="secondary-button" onclick="toggleMethodActive(${Number(m.id)}, ${Number(m.active) === 0})">
            ${Number(m.active) === 0 ? "فعال‌سازی" : "غیرفعال‌کردن"}
          </button>
          <button type="button" class="danger-button" onclick="deleteMethod(${Number(m.id)})">حذف</button>
        </div>
      </div>
    `;
  }).join("");
}

function resetForm() {
  document.getElementById("shipping-form").reset();
  document.getElementById("method-id").value = "";
  document.getElementById("method-active").checked = true;
  document.getElementById("method-city-wrapper").style.display = "none";
  document.getElementById("form-title").textContent = "افزودن روش ارسال جدید";
  document.getElementById("cancel-edit").style.display = "none";
}

function editMethod(id) {
  const method = methodsCache.find((m) => m.id === id);
  if (!method) return;

  document.getElementById("method-id").value = method.id;
  document.getElementById("method-name").value = method.name;
  document.getElementById("method-cost").value = method.cost;
  document.getElementById("method-cost-type").value = method.cost_type;
  document.getElementById("method-scope").value = method.scope;
  document.getElementById("method-city").value = method.allowed_city || "";
  document.getElementById("method-city-wrapper").style.display = method.scope === "city" ? "block" : "none";
  document.getElementById("method-sort").value = method.sort_order;
  document.getElementById("method-active").checked = Number(method.active) !== 0;

  document.getElementById("form-title").textContent = `ویرایش روش ارسال: ${method.name}`;
  document.getElementById("cancel-edit").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function toggleMethodActive(id, makeActive) {
  const method = methodsCache.find((m) => m.id === id);
  if (!method) return;

  try {
    await fetchAdmin("/admin/shipping-methods", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...method, active: makeActive }),
    });
    showToast(makeActive ? "روش ارسال فعال شد." : "روش ارسال غیرفعال شد.", "success");
    loadMethods();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteMethod(id) {
  const confirmed = confirm("این روش ارسال حذف شود؟ اگر قبلاً در سفارشی استفاده شده باشد، حذف رد می‌شود.");
  if (!confirmed) return;

  try {
    await fetchAdmin(`/admin/shipping-methods?id=${id}`, { method: "DELETE" });
    showToast("روش ارسال حذف شد.", "success");
    loadMethods();
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-methods");
  loadMethods();

  document.getElementById("refresh-methods")?.addEventListener("click", loadMethods);
  document.getElementById("cancel-edit")?.addEventListener("click", resetForm);

  document.getElementById("method-scope")?.addEventListener("change", (event) => {
    document.getElementById("method-city-wrapper").style.display = event.target.value === "city" ? "block" : "none";
  });

  document.getElementById("shipping-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.getElementById("method-id").value;
    const payload = {
      name: document.getElementById("method-name").value.trim(),
      cost: Number(document.getElementById("method-cost").value),
      cost_type: document.getElementById("method-cost-type").value,
      scope: document.getElementById("method-scope").value,
      allowed_city: document.getElementById("method-city").value.trim(),
      sort_order: Number(document.getElementById("method-sort").value) || 0,
      active: document.getElementById("method-active").checked,
    };

    try {
      if (id) {
        await fetchAdmin("/admin/shipping-methods", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: Number(id) }),
        });
        showToast("روش ارسال ویرایش شد.", "success");
      } else {
        await fetchAdmin("/admin/shipping-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showToast("روش ارسال جدید ایجاد شد.", "success");
      }
      resetForm();
      loadMethods();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
