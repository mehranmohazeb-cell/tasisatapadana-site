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

const ROUTE_POLICY_LABELS = { normal: "عادی", freight: "باربری (پس‌کرایه)" };

// وضعیت route_policy دقیقاً همان‌طور که در D1 است نمایش داده می‌شود (بدون تبدیل بی‌صدا).
function routePolicyBadge(c) {
  const status = c.route_policy_status;
  if (status === "valid") {
    const label = ROUTE_POLICY_LABELS[c.route_policy] || c.route_policy;
    return `<span class="shipping-badge ${c.route_policy === "freight" ? "" : "inactive"}">Route Policy: ${escapeHtml(label)}</span>`;
  }
  if (status === "unset") {
    return '<span class="shipping-badge inactive" title="در D1 مقداری ثبت نشده (NULL). سیستم پیش‌فرض فنی «عادی» را اعمال می‌کند.">Route Policy: ثبت نشده (پیش‌فرض فنی: عادی)</span>';
  }
  if (status === "invalid") {
    return `<span class="shipping-badge" style="background:#fbeaea; color:#a23b3b;" title="مقدار خارج از مقادیر پشتیبانی‌شده در D1. منطق فعلی سیستم آن را «عادی» تلقی می‌کند.">Route Policy نامعتبر در D1: ${escapeHtml(String(c.route_policy))}</span>`;
  }
  return '<span class="shipping-badge inactive" title="ستون route_policy هنوز روی D1 ایجاد نشده (database/shipping-routing.sql).">Route Policy: ستون در D1 موجود نیست</span>';
}

function applyRoutePolicyFormState(item) {
  const select = document.getElementById("class-route-policy");
  const note = document.getElementById("class-route-policy-note");
  select.value = item && ROUTE_POLICY_LABELS[item.route_policy] ? item.route_policy : "";
  const status = item ? item.route_policy_status : null;
  const messages = {
    unset: "Route Policy این کلاس در D1 ثبت نشده (فعلاً «عادی» محاسبه می‌شود). برای صریح‌شدن، یکی را انتخاب و ذخیره کنید.",
    invalid: `مقدار نامعتبر در D1: «${item ? item.route_policy : ""}». تا انتخاب و ذخیرهٔ مقدار معتبر، سیستم آن را «عادی» تلقی می‌کند.`,
    unavailable: "ستون route_policy هنوز روی D1 ایجاد نشده؛ ذخیرهٔ Route Policy ممکن نیست (database/shipping-routing.sql).",
  };
  note.textContent = messages[status] || "";
  note.style.display = messages[status] ? "block" : "none";
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
        ${routePolicyBadge(c)}
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
  applyRoutePolicyFormState(null);
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
  applyRoutePolicyFormState(item);
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
    const routePolicyRaw = document.getElementById("class-route-policy").value;
    if (!id && !routePolicyRaw) {
      showToast("Route Policy را برای Shipping Class جدید صریحاً انتخاب کنید.", "error");
      return;
    }
    const payload = {
      name: document.getElementById("class-name").value.trim(),
      active: document.getElementById("class-active").checked,
      default_packaging_profile_id: packagingProfileRaw ? Number(packagingProfileRaw) : null,
    };
    // در ویرایش، اگر انتخابی نشده باشد route_policy ارسال نمی‌شود تا مقدار فعلی D1 دست‌نخورده بماند.
    if (routePolicyRaw) payload.route_policy = routePolicyRaw;

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
