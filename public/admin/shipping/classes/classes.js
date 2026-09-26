// =========================
// Shipping Classes — /admin/shipping/classes/
// =========================

let classesCache = [];
let packagingProfilesCache = [];

async function loadPackagingProfilesForClassSelect() {
  const select = document.getElementById("class-packaging-profile");
  if (!select) return;
  try {
    const data = await fetchAdmin("/admin/packaging-profiles");
    packagingProfilesCache = (data.packaging_profiles || []).filter((p) => Number(p.active) === 1);
    select.innerHTML =
      '<option value="">— بدون Profile پیش‌فرض —</option>' +
      packagingProfilesCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  } catch (error) {
    // اختیاری — اگر Migration هنوز اجرا نشده، صفحه بدون این گزینه کار می‌کند.
  }
}

async function loadClasses() {
  const container = document.getElementById("list-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin("/admin/shipping-classes");
    classesCache = data.shipping_classes || [];
    renderClasses();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderClasses() {
  const container = document.getElementById("list-container");

  if (classesCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز Shipping Classای ثبت نشده است.</p>';
    return;
  }

  const profileName = (id) => {
    if (id == null) return null;
    const p = packagingProfilesCache.find((item) => Number(item.id) === Number(id));
    return p ? p.name : null;
  };

  container.innerHTML = classesCache.map((c) => `
    <div class="shipping-method-row">
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        ${Number(c.active) === 0 ? '<span class="shipping-badge inactive">غیرفعال</span>' : ""}
        ${profileName(c.default_packaging_profile_id) ? `<span class="shipping-badge">Packaging: ${escapeHtml(profileName(c.default_packaging_profile_id))}</span>` : ""}
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary-button" onclick="editClass(${Number(c.id)})">ویرایش</button>
        <button type="button" class="secondary-button" onclick="toggleClassActive(${Number(c.id)}, ${Number(c.active) === 0})">
          ${Number(c.active) === 0 ? "فعال‌سازی" : "غیرفعال‌کردن"}
        </button>
        <button type="button" class="danger-button" onclick="deleteClass(${Number(c.id)})">حذف</button>
      </div>
    </div>
  `).join("");
}

function resetClassForm() {
  document.getElementById("class-form").reset();
  document.getElementById("class-id").value = "";
  document.getElementById("class-active").checked = true;
  document.getElementById("class-packaging-profile").value = "";
  document.getElementById("cancel-class-edit").style.display = "none";
}

function editClass(id) {
  const item = classesCache.find((c) => c.id === id);
  if (!item) return;
  document.getElementById("class-id").value = item.id;
  document.getElementById("class-name").value = item.name;
  document.getElementById("class-active").checked = Number(item.active) !== 0;
  document.getElementById("class-packaging-profile").value =
    item.default_packaging_profile_id != null ? String(item.default_packaging_profile_id) : "";
  document.getElementById("cancel-class-edit").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function toggleClassActive(id, makeActive) {
  const item = classesCache.find((c) => c.id === id);
  if (!item) return;
  try {
    await fetchAdmin("/admin/shipping-classes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id, name: item.name, active: makeActive, sort_order: item.sort_order,
        default_packaging_profile_id: item.default_packaging_profile_id ?? null,
      }),
    });
    showToast(makeActive ? "فعال شد." : "غیرفعال شد.", "success");
    loadClasses();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteClass(id) {
  if (!confirm("این Shipping Class حذف شود؟ اگر روی محصولی تنظیم شده باشد، حذف رد می‌شود.")) return;
  try {
    await fetchAdmin(`/admin/shipping-classes?id=${id}`, { method: "DELETE" });
    showToast("حذف شد.", "success");
    loadClasses();
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-classes");
  loadPackagingProfilesForClassSelect();
  loadClasses();

  document.getElementById("refresh-classes")?.addEventListener("click", loadClasses);
  document.getElementById("cancel-class-edit")?.addEventListener("click", resetClassForm);

  document.getElementById("class-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("class-id").value;
    const packagingProfileRaw = document.getElementById("class-packaging-profile").value;
    const payload = {
      name: document.getElementById("class-name").value.trim(),
      active: document.getElementById("class-active").checked,
      default_packaging_profile_id: packagingProfileRaw ? Number(packagingProfileRaw) : null,
    };

    try {
      if (id) {
        await fetchAdmin("/admin/shipping-classes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: Number(id) }),
        });
        showToast("ویرایش شد.", "success");
      } else {
        await fetchAdmin("/admin/shipping-classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showToast("ایجاد شد.", "success");
      }
      resetClassForm();
      loadClasses();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
