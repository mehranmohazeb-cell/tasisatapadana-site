// =========================
// Packaging Profiles — /admin/shipping/packaging/
// =========================

let profilesCache = [];

async function loadProfiles() {
  const container = document.getElementById("list-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin("/admin/packaging-profiles");
    profilesCache = data.packaging_profiles || [];
    renderProfiles();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderProfiles() {
  const container = document.getElementById("list-container");

  if (profilesCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز Packaging Profileای ثبت نشده است.</p>';
    return;
  }

  container.innerHTML = profilesCache.map((p) => `
    <div class="shipping-method-row">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <span style="color:#8a9793;"> (${escapeHtml(p.code)})</span>
        ${Number(p.active) === 0 ? '<span class="shipping-badge inactive">غیرفعال</span>' : ""}
        ${Number(p.is_default) === 1 ? '<span class="shipping-badge">پیش‌فرض سیستم</span>' : ""}
        ${Number(p.require_separate_shipment) === 1 ? '<span class="shipping-badge">ارسال جداگانه</span>' : ""}
        <div style="font-size:12px; color:#71817e; margin-top:4px;">
          تلرانس: ${p.length_tolerance_cm}×${p.width_tolerance_cm}×${p.height_tolerance_cm} سانتی‌متر،
          +${p.weight_tolerance_grams} گرم / +${p.weight_tolerance_percent}٪ —
          حداقل بسته: ${p.min_package_length_cm}×${p.min_package_width_cm}×${p.min_package_height_cm} سانتی‌متر، حداقل وزن: ${p.min_shipping_weight_grams} گرم
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary-button" onclick="editProfile(${Number(p.id)})">ویرایش</button>
        ${Number(p.is_default) === 1 ? "" : `<button type="button" class="danger-button" onclick="deleteProfile(${Number(p.id)})">حذف</button>`}
      </div>
    </div>
  `).join("");
}

function resetProfileForm() {
  document.getElementById("profile-form").reset();
  document.getElementById("profile-id").value = "";
  document.getElementById("profile-active").checked = true;
  document.getElementById("profile-allow-combine").checked = true;
  document.getElementById("profile-require-separate").checked = false;
  document.getElementById("profile-protection-level").value = "standard";
  document.getElementById("form-title").firstChild.textContent = "افزودن Packaging Profile جدید ";
}

function editProfile(id) {
  const p = profilesCache.find((item) => Number(item.id) === Number(id));
  if (!p) return;

  document.getElementById("profile-id").value = p.id;
  document.getElementById("profile-code").value = p.code;
  document.getElementById("profile-name").value = p.name;
  document.getElementById("profile-description").value = p.description || "";
  document.getElementById("profile-length-tolerance").value = p.length_tolerance_cm;
  document.getElementById("profile-width-tolerance").value = p.width_tolerance_cm;
  document.getElementById("profile-height-tolerance").value = p.height_tolerance_cm;
  document.getElementById("profile-weight-tolerance-grams").value = p.weight_tolerance_grams;
  document.getElementById("profile-weight-tolerance-percent").value = p.weight_tolerance_percent;
  document.getElementById("profile-min-length").value = p.min_package_length_cm;
  document.getElementById("profile-min-width").value = p.min_package_width_cm;
  document.getElementById("profile-min-height").value = p.min_package_height_cm;
  document.getElementById("profile-min-weight").value = p.min_shipping_weight_grams;
  document.getElementById("profile-protection-level").value = p.protection_level || "standard";
  document.getElementById("profile-packaging-group").value = p.packaging_group || "";
  document.getElementById("profile-allow-combine").checked = Number(p.allow_combine_with_other_items) === 1;
  document.getElementById("profile-require-separate").checked = Number(p.require_separate_shipment) === 1;
  document.getElementById("profile-active").checked = Number(p.active) === 1;

  document.getElementById("form-title").firstChild.textContent = `ویرایش: ${p.name} `;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProfile(id) {
  if (!confirm("این Packaging Profile حذف شود؟ اگر روی محصول/Shipping Classای تنظیم شده باشد، حذف رد می‌شود.")) return;
  try {
    await fetchAdmin(`/admin/packaging-profiles?id=${id}`, { method: "DELETE" });
    showToast("حذف شد.", "success");
    loadProfiles();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function collectProfileFormPayload() {
  return {
    code: document.getElementById("profile-code").value.trim(),
    name: document.getElementById("profile-name").value.trim(),
    description: document.getElementById("profile-description").value.trim() || null,
    length_tolerance_cm: Number(document.getElementById("profile-length-tolerance").value) || 0,
    width_tolerance_cm: Number(document.getElementById("profile-width-tolerance").value) || 0,
    height_tolerance_cm: Number(document.getElementById("profile-height-tolerance").value) || 0,
    weight_tolerance_grams: Number(document.getElementById("profile-weight-tolerance-grams").value) || 0,
    weight_tolerance_percent: Number(document.getElementById("profile-weight-tolerance-percent").value) || 0,
    min_package_length_cm: Number(document.getElementById("profile-min-length").value) || 10,
    min_package_width_cm: Number(document.getElementById("profile-min-width").value) || 10,
    min_package_height_cm: Number(document.getElementById("profile-min-height").value) || 5,
    min_shipping_weight_grams: Number(document.getElementById("profile-min-weight").value) || 200,
    protection_level: document.getElementById("profile-protection-level").value,
    packaging_group: document.getElementById("profile-packaging-group").value.trim() || null,
    allow_combine_with_other_items: document.getElementById("profile-allow-combine").checked,
    require_separate_shipment: document.getElementById("profile-require-separate").checked,
    active: document.getElementById("profile-active").checked,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-packaging");
  loadProfiles();

  document.getElementById("refresh-profiles")?.addEventListener("click", loadProfiles);
  document.getElementById("cancel-edit")?.addEventListener("click", resetProfileForm);

  document.getElementById("profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("profile-id").value;
    const payload = collectProfileFormPayload();

    if (!payload.code || !payload.name) {
      showToast("کد و نام Profile الزامی است.", "error");
      return;
    }

    try {
      if (id) {
        await fetchAdmin("/admin/packaging-profiles", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: Number(id) }),
        });
        showToast("ویرایش شد.", "success");
      } else {
        await fetchAdmin("/admin/packaging-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showToast("ایجاد شد.", "success");
      }
      resetProfileForm();
      loadProfiles();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
