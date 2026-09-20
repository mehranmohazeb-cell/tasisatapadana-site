// =========================================================================
// مدیریت دسته‌بندی محصولات — /admin/categories/
// دسته‌بندی یک ساختار خودارجاع (parent_id) است؛ این صفحه آن را به‌صورت
// درخت نمایش می‌دهد و امکان ایجاد/ویرایش/فعال‌سازی/حذف امن را می‌دهد.
// =========================================================================

let categoriesCache = [];
let editingCategoryId = null;

// =========================
// پرچم‌های نمایش عمومی
// =========================

const FEATURE_FLAG_ROWS = [
  { key: "show_categories_public", label: "منوی دسته‌بندی برای مشتری" },
  { key: "show_related_products", label: "نوار «محصولات مرتبط»" },
  { key: "show_similar_products", label: "نوار «محصولات مشابه»" },
  { key: "show_cart_suggestions", label: "پیشنهادهای تکمیلی سبد خرید" },
];

async function loadFeatureFlags() {
  const container = document.getElementById("feature-flags-row");
  if (!container) return;

  try {
    const data = await fetchAdmin("/admin/feature-flags");
    renderFeatureFlags(data.flags || {});
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderFeatureFlags(flags) {
  const container = document.getElementById("feature-flags-row");
  if (!container) return;

  container.innerHTML = FEATURE_FLAG_ROWS.map((row) => {
    const isOn = !!flags[row.key];
    return `
      <div class="site-status-item">
        <span class="site-status-label">${escapeHtml(row.label)}</span>
        <span class="site-status-chip ${isOn ? "open" : "paused"}">${isOn ? "روشن" : "خاموش"}</span>
        <button type="button" class="secondary-button" data-flag-toggle="${row.key}" data-flag-value="${isOn ? "0" : "1"}">
          ${isOn ? "خاموش کن" : "روشن کن"}
        </button>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-flag-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = button.dataset.flagToggle;
      const value = button.dataset.flagValue === "1";
      button.disabled = true;
      try {
        const data = await fetchAdmin("/admin/feature-flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });
        renderFeatureFlags(data.flags || {});
        showToast("تنظیمات به‌روزرسانی شد.", "success");
      } catch (error) {
        showToast(error.message, "error");
        button.disabled = false;
      }
    });
  });
}

// =========================
// بارگذاری و نمایش درختی دسته‌ها
// =========================

async function loadCategories() {
  const container = document.getElementById("categories-list");
  if (!container) return;

  container.innerHTML = '<p class="loading">در حال بارگذاری دسته‌ها...</p>';

  try {
    const data = await fetchAdmin("/admin/categories");
    categoriesCache = data.categories || [];
    renderCategoriesTree();
    populateParentSelect();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function buildCategoryTree(categories) {
  const byParent = new Map();
  for (const category of categories) {
    const key = category.parent_id == null ? "root" : String(category.parent_id);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(category);
  }

  function attachChildren(list) {
    return list.map((category) => ({
      ...category,
      children: attachChildren(byParent.get(String(category.id)) || []),
    }));
  }

  return attachChildren(byParent.get("root") || []);
}

function renderCategoriesTree() {
  const container = document.getElementById("categories-list");
  if (!container) return;

  if (categoriesCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز دسته‌ای ایجاد نشده است.</p>';
    return;
  }

  const tree = buildCategoryTree(categoriesCache);
  container.innerHTML = renderCategoryNodes(tree, 0);

  container.querySelectorAll("[data-edit-category]").forEach((button) => {
    button.addEventListener("click", () => editCategory(Number(button.dataset.editCategory)));
  });
  container.querySelectorAll("[data-toggle-category]").forEach((button) => {
    button.addEventListener("click", () => toggleCategoryActive(Number(button.dataset.toggleCategory)));
  });
  container.querySelectorAll("[data-delete-category]").forEach((button) => {
    button.addEventListener("click", () => deleteCategory(Number(button.dataset.deleteCategory)));
  });
}

function renderCategoryNodes(nodes, depth) {
  return nodes.map((node) => {
    const isActive = Number(node.active) === 1;
    const indent = depth * 22;
    const childCount = node.children.length;

    return `
      <div class="category-row" style="margin-right:${indent}px;">
        <div class="category-name">
          ${depth > 0 ? "└ " : ""}${escapeHtml(node.name)}
          <span class="category-meta">
            (${escapeHtml(node.slug)}) &middot;
            ${Number(node.product_count || 0).toLocaleString("fa-IR")} محصول &middot;
            ${childCount.toLocaleString("fa-IR")} زیردسته
          </span>
          <span class="badge ${isActive ? "gray" : "red"}">${isActive ? "فعال" : "غیرفعال"}</span>
        </div>
        <div class="category-actions">
          <button type="button" class="secondary-button" data-edit-category="${node.id}">ویرایش</button>
          <button type="button" class="secondary-button" data-toggle-category="${node.id}">
            ${isActive ? "غیرفعال کن" : "فعال کن"}
          </button>
          <button type="button" class="danger-button" data-delete-category="${node.id}">حذف</button>
        </div>
      </div>
      ${node.children.length ? renderCategoryNodes(node.children, depth + 1) : ""}
    `;
  }).join("");
}

// گزینه‌های select والد — با تورفتگی متنی برای نمایش عمق
function populateParentSelect(excludeId = null) {
  const select = document.getElementById("category-parent");
  if (!select) return;

  const excludedIds = new Set();
  if (excludeId != null) {
    excludedIds.add(excludeId);
    // فرزندان excludeId هم باید مستثنی شوند تا حلقه ایجاد نشود
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categoriesCache) {
        if (category.parent_id != null && excludedIds.has(Number(category.parent_id)) && !excludedIds.has(Number(category.id))) {
          excludedIds.add(Number(category.id));
          changed = true;
        }
      }
    }
  }

  const tree = buildCategoryTree(categoriesCache.filter((c) => !excludedIds.has(Number(c.id))));

  function flatten(nodes, depth) {
    let out = [];
    for (const node of nodes) {
      out.push({ id: node.id, label: `${"— ".repeat(depth)}${node.name}` });
      out = out.concat(flatten(node.children, depth + 1));
    }
    return out;
  }

  const options = flatten(tree, 0);
  const currentValue = select.value;

  select.innerHTML =
    `<option value="">— بدون والد (دسته اصلی) —</option>` +
    options.map((opt) => `<option value="${opt.id}">${escapeHtml(opt.label)}</option>`).join("");

  if (options.some((opt) => String(opt.id) === currentValue)) {
    select.value = currentValue;
  }
}

// =========================
// فرم افزودن/ویرایش
// =========================

function clearCategoryForm() {
  const form = document.getElementById("category-form");
  if (!form) return;
  form.reset();

  document.getElementById("category-id").value = "";
  document.getElementById("category-sort-order").value = 0;
  document.getElementById("category-active").checked = true;
  document.getElementById("category-form-title").textContent = "افزودن دسته";

  editingCategoryId = null;
  populateParentSelect();
}

function editCategory(id) {
  const category = categoriesCache.find((item) => Number(item.id) === Number(id));
  if (!category) return;

  editingCategoryId = Number(category.id);

  document.getElementById("category-id").value = category.id;
  document.getElementById("category-name").value = category.name || "";
  document.getElementById("category-slug").value = category.slug || "";
  document.getElementById("category-sort-order").value = category.sort_order || 0;
  document.getElementById("category-active").checked = Number(category.active) === 1;

  populateParentSelect(editingCategoryId);
  document.getElementById("category-parent").value = category.parent_id != null ? String(category.parent_id) : "";

  document.getElementById("category-form-title").textContent = "ویرایش دسته";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveCategory(event) {
  event.preventDefault();

  const name = document.getElementById("category-name")?.value.trim();
  const slug = document.getElementById("category-slug")?.value.trim();
  const parentIdRaw = document.getElementById("category-parent")?.value;
  const sortOrder = Number(document.getElementById("category-sort-order")?.value) || 0;
  const active = document.getElementById("category-active")?.checked;

  if (!name) {
    showToast("نام دسته الزامی است.", "error");
    return;
  }

  const payload = {
    name,
    slug,
    parent_id: parentIdRaw ? Number(parentIdRaw) : null,
    sort_order: sortOrder,
    active,
  };
  if (editingCategoryId) payload.id = editingCategoryId;

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    await fetchAdmin("/admin/categories", {
      method: editingCategoryId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    showToast(editingCategoryId ? "دسته با موفقیت ویرایش شد." : "دسته با موفقیت ایجاد شد.", "success");
    clearCategoryForm();
    await loadCategories();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function toggleCategoryActive(id) {
  const category = categoriesCache.find((item) => Number(item.id) === Number(id));
  if (!category) return;

  try {
    await fetchAdmin("/admin/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: category.id,
        name: category.name,
        slug: category.slug,
        parent_id: category.parent_id,
        sort_order: category.sort_order,
        active: !(Number(category.active) === 1),
      }),
    });
    showToast("وضعیت دسته به‌روزرسانی شد.", "success");
    await loadCategories();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// =========================
// حذف امن (با انتقال محصولات/زیردسته‌ها در صورت نیاز)
// =========================

let pendingDeleteId = null;

function closeDeleteModal() {
  document.getElementById("delete-modal").style.display = "none";
  pendingDeleteId = null;
}

async function deleteCategory(id) {
  const category = categoriesCache.find((item) => Number(item.id) === Number(id));
  if (!category) return;

  const childCount = categoriesCache.filter((c) => Number(c.parent_id) === Number(id)).length;
  const productCount = Number(category.product_count || 0);

  if (childCount === 0 && productCount === 0) {
    if (!confirm(`آیا از حذف دسته «${category.name}» مطمئن هستید؟`)) return;
    try {
      await fetchAdmin(`/admin/categories?id=${id}`, { method: "DELETE" });
      showToast("دسته حذف شد.", "success");
      await loadCategories();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  // دارای وابسته (محصول یا زیردسته) — باید مقصد انتقال انتخاب شود.
  pendingDeleteId = id;
  document.getElementById("delete-modal-message").textContent =
    `دسته «${category.name}» شامل ${productCount.toLocaleString("fa-IR")} محصول و ${childCount.toLocaleString("fa-IR")} زیردسته است. ` +
    `برای حذف، ابتدا یک دسته مقصد برای انتقال آنها انتخاب کنید.`;

  const targetSelect = document.getElementById("delete-modal-target");
  const excludedIds = new Set([Number(id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categoriesCache) {
      if (c.parent_id != null && excludedIds.has(Number(c.parent_id)) && !excludedIds.has(Number(c.id))) {
        excludedIds.add(Number(c.id));
        changed = true;
      }
    }
  }
  const options = categoriesCache.filter((c) => !excludedIds.has(Number(c.id)));
  if (options.length === 0) {
    targetSelect.innerHTML = `<option value="">— دسته مقصدی وجود ندارد —</option>`;
  } else {
    targetSelect.innerHTML = options.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

  document.getElementById("delete-modal").style.display = "flex";
}

async function confirmDeleteWithReassign() {
  const targetSelect = document.getElementById("delete-modal-target");
  const targetId = targetSelect.value;

  if (!targetId) {
    showToast("یک دسته مقصد برای انتقال انتخاب کنید.", "error");
    return;
  }

  try {
    await fetchAdmin(`/admin/categories?id=${pendingDeleteId}&reassign_to=${targetId}`, { method: "DELETE" });
    showToast("دسته حذف و محتوای آن منتقل شد.", "success");
    closeDeleteModal();
    await loadCategories();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// =========================
// شروع
// =========================

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("categories");

  document.getElementById("category-form")?.addEventListener("submit", saveCategory);
  document.getElementById("cancel-category-edit")?.addEventListener("click", clearCategoryForm);
  document.getElementById("refresh-categories")?.addEventListener("click", loadCategories);

  document.getElementById("delete-modal-close")?.addEventListener("click", closeDeleteModal);
  document.getElementById("delete-modal-cancel")?.addEventListener("click", closeDeleteModal);
  document.getElementById("delete-modal-confirm")?.addEventListener("click", confirmDeleteWithReassign);

  clearCategoryForm();
  loadFeatureFlags();
  loadCategories();
});
