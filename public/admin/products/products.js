// =========================
// مدیریت محصولات — /admin/products/
// =========================

function getCategoryNameById(id) {
  const category = categoriesForSelect.find((item) => Number(item.id) === Number(id));
  return category ? category.name : "";
}

let editingProductId = null;
let productImages = []; // [{ image, alt }]
let productSpecs = []; // [{ label, value }]
let currentPage = 1;
const PAGE_LIMIT = 20;
let lastPagination = { page: 1, total_pages: 1, total: 0 };
let categoriesForSelect = [];

// =========================
// دسته‌بندی — بارگذاری برای select فرم محصول
// =========================

async function loadShippingClassesForSelect() {
  const select = document.getElementById("product-shipping-class");
  if (!select) return;
  try {
    const data = await fetchAdmin("/admin/shipping-classes");
    const classes = data.shipping_classes || [];
    select.innerHTML =
      '<option value="">— بدون Shipping Class —</option>' +
      classes.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  } catch (error) {
    // اختیاری است؛ اگر جدول هنوز Migrate نشده یا خطایی رخ دهد، فرم محصول
    // همچنان بدون این گزینه به کار خودش ادامه می‌دهد.
  }
}

async function loadCategoriesForSelect() {
  const select = document.getElementById("product-category");
  if (!select) return;
  try {
    const data = await fetchAdmin("/admin/categories");
    categoriesForSelect = data.categories || [];

    const byParent = new Map();
    for (const category of categoriesForSelect) {
      const key = category.parent_id == null ? "root" : String(category.parent_id);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(category);
    }

    function flatten(parentKey, depth) {
      let out = [];
      for (const category of byParent.get(parentKey) || []) {
        out.push({ id: category.id, label: `${"— ".repeat(depth)}${category.name}` });
        out = out.concat(flatten(String(category.id), depth + 1));
      }
      return out;
    }

    const options = flatten("root", 0);
    select.innerHTML =
      `<option value="">— بدون دسته —</option>` +
      options.map((opt) => `<option value="${opt.id}">${escapeHtml(opt.label)}</option>`).join("");
  } catch {
    // نبود دسته‌بندی (مثلاً Migration هنوز اجرا نشده) نباید فرم محصول را مختل کند.
    select.innerHTML = `<option value="">— بدون دسته —</option>`;
  }
}

// =========================
// بارگذاری لیست
// =========================

async function loadProducts(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");
  if (!container) return;

  container.innerHTML = '<p class="loading">در حال بارگذاری محصولات...</p>';

  const q = document.getElementById("products-search")?.value.trim() || "";
  const active = document.getElementById("products-active-filter")?.value || "";

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);
  if (q) params.set("q", q);
  if (active) params.set("active", active);

  try {
    const data = await fetchAdmin(`/products?${params.toString()}`);
    currentPage = data.page || page;
    lastPagination = data;
    renderProducts(data.products || []);
    renderPagination(paginationContainer, data, (targetPage) => loadProducts(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

let productsCache = [];

function renderProducts(products) {
  productsCache = products;
  const container = document.getElementById("list-container");
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = '<p class="loading">محصولی یافت نشد.</p>';
    return;
  }

  container.innerHTML = products.map((product) => {
    const image = getProductDisplayImage(product);
    const isActive = Number(product.active) === 1;
    const hasDiscount = product.compare_at_price && Number(product.compare_at_price) > Number(product.price);

    return `
      <div class="product-admin-item">
        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(product.name)}"
          class="product-admin-image"
          onerror="this.onerror=null; this.src='/assets/products/placeholder.svg';"
        >
        <div class="product-admin-info">
          <strong>${escapeHtml(product.name)}</strong>
          ${product.brand || product.model ? `<span>${escapeHtml([product.brand, product.model].filter(Boolean).join(" — "))}</span>` : ""}
          ${product.category_id ? `<span>دسته: ${escapeHtml(getCategoryNameById(product.category_id))}</span>` : ""}
          <span>قیمت: ${formatPrice(product.price)} تومان ${hasDiscount ? `<s style="color:#999;">${formatPrice(product.compare_at_price)}</s>` : ""}</span>
          <span>موجودی: ${formatPrice(product.stock)}</span>
          <span class="badge ${isActive ? "gray" : "red"}">${isActive ? "فعال" : "غیرفعال"}</span>
        </div>
        <button type="button" class="secondary-button" onclick="editProduct(${Number(product.id)})">ویرایش</button>
      </div>
    `;
  }).join("");
}

// =========================
// فرم محصول
// =========================

function clearForm() {
  const form = document.getElementById("product-form");
  if (!form) return;

  form.reset();

  const idInput = document.getElementById("product-id");
  if (idInput) idInput.value = "";

  const title = document.getElementById("form-title");
  if (title) title.textContent = "افزودن محصول";

  const editor = document.getElementById("product-description-editor");
  if (editor) editor.innerHTML = "";

  editingProductId = null;
  productImages = [];
  productSpecs = [];

  renderImageList();
  renderSpecsList();

  const relationsSection = document.getElementById("relations-section");
  if (relationsSection) relationsSection.style.display = "none";

  const shippingRatesSection = document.getElementById("shipping-rates-section");
  if (shippingRatesSection) shippingRatesSection.style.display = "none";
  shippingRatesCache = [];
}

function editProduct(id) {
  const product = productsCache.find((item) => Number(item.id) === Number(id));
  if (!product) return;

  editingProductId = Number(product.id);

  document.getElementById("product-id").value = product.id;
  document.getElementById("product-name").value = product.name || "";
  document.getElementById("product-slug").value = product.slug || "";
  document.getElementById("product-brand").value = product.brand || "";
  document.getElementById("product-model").value = product.model || "";
  document.getElementById("product-sku").value = product.sku || "";
  document.getElementById("product-category").value = product.category_id != null ? String(product.category_id) : "";
  document.getElementById("product-description-editor").innerHTML = product.description || "";
  document.getElementById("product-price").value = product.price || 0;
  document.getElementById("product-compare-price").value = product.compare_at_price ?? "";
  document.getElementById("product-stock").value = product.stock || 0;
  document.getElementById("product-shipping-cost").value = product.shipping_cost ?? "";
  document.getElementById("product-shipping-method").value = product.shipping_method || "";
  document.getElementById("product-shipping-time").value = product.shipping_time || "";
  document.getElementById("product-shipping-class").value =
    product.shipping_class_id != null ? String(product.shipping_class_id) : "";
  document.getElementById("product-weight").value = product.weight_grams ?? "";
  document.getElementById("product-length").value = product.length_cm ?? "";
  document.getElementById("product-width").value = product.width_cm ?? "";
  document.getElementById("product-height").value = product.height_cm ?? "";
  document.getElementById("product-warranty-months").value = product.warranty_months ?? "";
  document.getElementById("product-warranty-provider").value = product.warranty_provider || "";
  document.getElementById("product-return-days").value = product.return_days ?? "";
  document.getElementById("product-active").checked = Number(product.active) === 1;

  productImages = (product.images || [])
    .map((item) => ({ image: item.image, alt: item.alt || "" }))
    .filter((item) => item.image);

  productSpecs = (product.specs || []).map((item) => ({ label: item.label, value: item.value }));

  document.getElementById("form-title").textContent = "ویرایش محصول";

  renderImageList();
  renderSpecsList();

  const relationsSection = document.getElementById("relations-section");
  if (relationsSection) {
    relationsSection.style.display = "block";
    loadProductRelations(editingProductId);
  }

  const shippingRatesSection = document.getElementById("shipping-rates-section");
  if (shippingRatesSection) {
    shippingRatesSection.style.display = "block";
    loadProductShippingRates(editingProductId);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =========================
// قواعد ارسال اختصاصی محصول (گسترش shipping_methods، بدون سیستم موازی)
// =========================

let shippingRatesCache = [];

async function loadProductShippingRates(productId) {
  const container = document.getElementById("shipping-rates-list");
  if (!container) return;
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const data = await fetchAdmin(`/admin/products/${productId}/shipping-rates`);
    shippingRatesCache = data.rates || [];
    renderShippingRatesList();
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderShippingRatesList() {
  const container = document.getElementById("shipping-rates-list");
  if (!container) return;

  if (shippingRatesCache.length === 0) {
    container.innerHTML = '<p class="loading">هنوز روش ارسالی در پنل مدیریت تعریف نشده است.</p>';
    return;
  }

  container.innerHTML = shippingRatesCache.map((rate, index) => `
    <div style="display:flex; align-items:center; gap:10px; padding:9px 11px; background:#f5f8f7; border:1px solid #dbe3e1; border-radius:8px; margin-bottom:8px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:6px; min-width:160px;">
        <input type="checkbox" ${rate.is_allowed ? "checked" : ""} onchange="updateShippingRateAllowed(${index}, this.checked)" style="width:auto;">
        ${escapeHtml(rate.name)}${!rate.method_active ? " (غیرفعال)" : ""}
      </label>
      <span style="font-size:12px; color:#71817e;">پیش‌فرض: ${Number(rate.default_cost).toLocaleString("fa-IR")} تومان</span>
      <input
        type="number"
        min="0"
        placeholder="هزینه اختصاصی (اختیاری)"
        value="${rate.custom_cost != null ? rate.custom_cost : ""}"
        style="flex:1; min-width:160px; border:1px solid #cbd6d3; border-radius:8px; padding:7px 9px; font-size:12px;"
        oninput="updateShippingRateCost(${index}, this.value)"
        ${rate.is_allowed ? "" : "disabled"}
      >
    </div>
  `).join("");
}

function updateShippingRateAllowed(index, checked) {
  if (shippingRatesCache[index]) {
    shippingRatesCache[index].is_allowed = checked;
    renderShippingRatesList();
  }
}

function updateShippingRateCost(index, value) {
  if (shippingRatesCache[index]) {
    shippingRatesCache[index].custom_cost = value === "" ? null : Number(value);
  }
}

async function saveProductShippingRates() {
  if (!editingProductId) return;

  try {
    await fetchAdmin(`/admin/products/${editingProductId}/shipping-rates`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rates: shippingRatesCache.map((r) => ({
          shipping_method_id: r.shipping_method_id,
          is_allowed: r.is_allowed,
          custom_cost: r.custom_cost,
        })),
      }),
    });
    showToast("قواعد ارسال این محصول ذخیره شد.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// =========================
// تصاویر (هر ردیف: مسیر تصویر + متن جایگزین/alt)
// =========================

function renderImageList() {
  const container = document.getElementById("image-list");
  if (!container) return;

  if (productImages.length === 0) {
    container.innerHTML = '<p class="loading">هنوز عکسی اضافه نشده است.</p>';
    return;
  }

  container.innerHTML = productImages.map((item, index) => `
    <div style="display:flex; align-items:center; gap:8px; padding:9px 11px; background:#f5f8f7; border:1px solid #dbe3e1; border-radius:8px; margin-bottom:8px;">
      <span style="min-width:0; overflow-wrap:anywhere; color:#48615e; font-size:13px; flex:1;">${index + 1}. ${escapeHtml(item.image)}</span>
      <input
        type="text"
        placeholder="متن جایگزین تصویر (alt)"
        value="${escapeAttribute(item.alt || "")}"
        style="flex:1; border:1px solid #cbd6d3; border-radius:8px; padding:7px 9px; font-size:12px;"
        oninput="updateImageAlt(${index}, this.value)"
      >
      <button type="button" class="secondary-button" onclick="removeProductImage(${index})">حذف</button>
    </div>
  `).join("");
}

function updateImageAlt(index, value) {
  if (productImages[index]) productImages[index].alt = value;
}

function removeProductImage(index) {
  productImages.splice(index, 1);
  renderImageList();
}

// =========================
// پیش‌نمایش Technical Formatter در فرم ویرایش محصول
// -------------------------------------------------------------------------
// این پیش‌نمایش فقط نمایشی است و از همان Endpoint متکی بر Technical
// Formatter مرکزی (src/technical-format.js) استفاده می‌کند. مقدار inputها
// (برند/مدل/Label/Value مشخصات) همیشه همان متن خام تایپ/بارگذاری‌شده باقی
// می‌ماند و دقیقاً همان چیزی است که هنگام ذخیره ارسال می‌شود — این تابع
// هرگز value هیچ inputای را تغییر نمی‌دهد.
// =========================

let technicalPreviewTimer = null;

function scheduleTechnicalPreviewRefresh() {
  clearTimeout(technicalPreviewTimer);
  technicalPreviewTimer = setTimeout(refreshTechnicalPreview, 300);
}

function setPreviewText(el, formattedText, rawText) {
  if (!el) return;
  // اگر فرمت‌شده دقیقاً همان خام باشد (چیز فنی‌ای برای فرمت شدن نبود)،
  // پیش‌نمایش خالی می‌ماند تا فرم شلوغ نشود.
  if (!formattedText || formattedText === rawText) {
    el.textContent = "";
    return;
  }
  el.textContent = `پیش‌نمایش: ${formattedText}`;
}

function clearTechnicalPreview() {
  setPreviewText(document.getElementById("product-brand-preview"), "", "");
  setPreviewText(document.getElementById("product-model-preview"), "", "");
  for (let index = 0; index < productSpecs.length; index++) {
    setPreviewText(document.getElementById(`spec-preview-label-${index}`), "", "");
    setPreviewText(document.getElementById(`spec-preview-value-${index}`), "", "");
  }
}

async function refreshTechnicalPreview() {
  const brandRaw = document.getElementById("product-brand")?.value || "";
  const modelRaw = document.getElementById("product-model")?.value || "";

  const texts = [brandRaw, modelRaw];
  for (const spec of productSpecs) {
    texts.push(spec.label || "", spec.value || "");
  }

  if (!texts.some((text) => text && text.trim())) {
    clearTechnicalPreview();
    return;
  }

  try {
    const data = await fetchAdmin("/admin/technical-format-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    const formatted = data.formatted || [];

    setPreviewText(document.getElementById("product-brand-preview"), formatted[0], brandRaw);
    setPreviewText(document.getElementById("product-model-preview"), formatted[1], modelRaw);

    productSpecs.forEach((spec, index) => {
      const labelFormatted = formatted[2 + index * 2];
      const valueFormatted = formatted[2 + index * 2 + 1];
      setPreviewText(document.getElementById(`spec-preview-label-${index}`), labelFormatted, spec.label || "");
      setPreviewText(document.getElementById(`spec-preview-value-${index}`), valueFormatted, spec.value || "");
    });
  } catch (error) {
    // پیش‌نمایش کاملاً جانبی و اختیاری است؛ اگر ناموفق شود، فرم بدون آن
    // (فقط با داده خام در inputها) به کار عادی خودش ادامه می‌دهد.
  }
}

// =========================
// مشخصات فنی (label/value قابل افزودن/حذف/ترتیب)
// =========================

function renderSpecsList() {
  const container = document.getElementById("specs-list");
  if (!container) return;

  if (productSpecs.length === 0) {
    container.innerHTML = '<p class="loading">هنوز مشخصه‌ای اضافه نشده است.</p>';
  } else {
    container.innerHTML = productSpecs.map((spec, index) => `
      <div class="spec-row-wrap">
        <div class="spec-row">
          <input type="text" placeholder="مشخصه (مثلاً: برند)" value="${escapeAttribute(spec.label)}" oninput="updateSpec(${index}, 'label', this.value)">
          <input type="text" placeholder="مقدار" value="${escapeAttribute(spec.value)}" oninput="updateSpec(${index}, 'value', this.value)">
          <button type="button" class="secondary-button" onclick="moveSpec(${index}, -1)" ${index === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="secondary-button" onclick="moveSpec(${index}, 1)" ${index === productSpecs.length - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="danger-button" onclick="removeSpec(${index})">حذف</button>
        </div>
        <small class="tech-format-preview" id="spec-preview-label-${index}"></small>
        <small class="tech-format-preview" id="spec-preview-value-${index}"></small>
      </div>
    `).join("");
  }

  // بعد از هر بازسازی لیست (بارگذاری اولیه/افزودن/جابه‌جایی/حذف ردیف/خالی‌شدن
  // با clearForm)، پیش‌نمایش فرمت‌شده دوباره محاسبه می‌شود تا هرگز پیش‌نمایش
  // محصول قبلی باقی نماند؛ خودِ inputها هرگز از این مسیر دست نمی‌خورند.
  refreshTechnicalPreview();
}

function updateSpec(index, field, value) {
  if (productSpecs[index]) productSpecs[index][field] = value;
  scheduleTechnicalPreviewRefresh();
}

function moveSpec(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= productSpecs.length) return;
  [productSpecs[index], productSpecs[targetIndex]] = [productSpecs[targetIndex], productSpecs[index]];
  renderSpecsList();
}

function removeSpec(index) {
  productSpecs.splice(index, 1);
  renderSpecsList();
}

// =========================
// ویرایشگر ساده معرفی محصول (RTE)
// =========================

function setupRichTextToolbar() {
  const editor = document.getElementById("product-description-editor");
  if (!editor) return;

  document.querySelectorAll("[data-rte-cmd]").forEach((button) => {
    button.addEventListener("click", () => {
      editor.focus();
      const cmd = button.dataset.rteCmd;
      const value = button.dataset.rteValue || undefined;
      document.execCommand(cmd, false, value);
    });
  });

  document.getElementById("rte-link-button")?.addEventListener("click", () => {
    const url = prompt("آدرس لینک را وارد کنید:", "https://");
    if (!url) return;
    editor.focus();
    document.execCommand("createLink", false, url);
  });

  // جدول فنی ساده (بخش ۸ دستور) — یک جدول ۲×۳ پیش‌فرض در محل نشانگر درج
  // می‌شود؛ مدیر می‌تواند بعداً سطر/ستون را مستقیم در همان جدول ویرایش کند
  // (مرورگرها امکان افزودن ردیف/سلول با Tab و Enter داخل جدول را می‌دهند).
  document.getElementById("rte-table-button")?.addEventListener("click", () => {
    editor.focus();
    const tableHtml =
      '<table class="content-table"><thead><tr><th>عنوان مشخصه</th><th>مقدار</th></tr></thead>' +
      "<tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>";
    document.execCommand("insertHTML", false, tableHtml);
  });
}

// =========================
// ذخیره محصول
// =========================

async function saveProduct(event) {
  event.preventDefault();

  const name = document.getElementById("product-name")?.value.trim();
  const slug = document.getElementById("product-slug")?.value.trim();
  const brand = document.getElementById("product-brand")?.value.trim();
  const model = document.getElementById("product-model")?.value.trim();
  const sku = document.getElementById("product-sku")?.value.trim();
  const categoryIdRaw = document.getElementById("product-category")?.value;
  const description = document.getElementById("product-description-editor")?.innerHTML.trim();
  const price = Number(document.getElementById("product-price")?.value);
  const comparePriceRaw = document.getElementById("product-compare-price")?.value;
  const stock = Number(document.getElementById("product-stock")?.value);
  const shippingCostRaw = document.getElementById("product-shipping-cost")?.value;
  const shippingMethod = document.getElementById("product-shipping-method")?.value.trim();
  const shippingTime = document.getElementById("product-shipping-time")?.value.trim();
  const shippingClassRaw = document.getElementById("product-shipping-class")?.value;
  const weightRaw = document.getElementById("product-weight")?.value;
  const lengthRaw = document.getElementById("product-length")?.value;
  const widthRaw = document.getElementById("product-width")?.value;
  const heightRaw = document.getElementById("product-height")?.value;
  const warrantyMonthsRaw = document.getElementById("product-warranty-months")?.value;
  const warrantyProvider = document.getElementById("product-warranty-provider")?.value.trim();
  const returnDaysRaw = document.getElementById("product-return-days")?.value;
  const active = document.getElementById("product-active")?.checked;

  if (!name || !slug) {
    showToast("نام محصول و شناسه محصول الزامی است.", "error");
    return;
  }

  const payload = {
    name, slug, brand, model, sku, description, price, stock, active,
    category_id: categoryIdRaw ? Number(categoryIdRaw) : null,
    compare_at_price: comparePriceRaw ? Number(comparePriceRaw) : null,
    shipping_cost: shippingCostRaw ? Number(shippingCostRaw) : null,
    shipping_method: shippingMethod || null,
    shipping_time: shippingTime || null,
    shipping_class_id: shippingClassRaw ? Number(shippingClassRaw) : null,
    weight_grams: weightRaw ? Number(weightRaw) : null,
    length_cm: lengthRaw ? Number(lengthRaw) : null,
    width_cm: widthRaw ? Number(widthRaw) : null,
    height_cm: heightRaw ? Number(heightRaw) : null,
    warranty_months: warrantyMonthsRaw ? Number(warrantyMonthsRaw) : null,
    warranty_provider: warrantyProvider || null,
    return_days: returnDaysRaw ? Number(returnDaysRaw) : null,
    images: productImages,
    specs: productSpecs.filter((spec) => spec.label.trim() && spec.value.trim()),
  };
  if (editingProductId) payload.id = editingProductId;

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showToast("در حال ذخیره...", "info", 1500);

  try {
    await fetchAdmin("/products", {
      method: editingProductId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    showToast(editingProductId ? "محصول با موفقیت ویرایش شد." : "محصول با موفقیت ثبت شد.", "success");
    clearForm();
    await loadProducts(1);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

// =========================
// روابط محصول (مرتبط/مشابه/مکمل) — فقط هنگام ویرایش یک محصول موجود
// =========================

const RELATION_TYPES = [
  { key: "related", label: "محصولات مرتبط" },
  { key: "similar", label: "محصولات مشابه" },
  { key: "complementary", label: "محصولات مکمل / همراه" },
];

let relationsSearchTimers = {};

async function loadProductRelations(productId) {
  const groupsContainer = document.getElementById("relations-groups");
  const coPurchasedContainer = document.getElementById("co-purchased-list");
  if (!groupsContainer) return;

  groupsContainer.innerHTML = '<p class="loading">در حال بارگذاری روابط...</p>';

  try {
    const data = await fetchAdmin(`/admin/product-relations?product_id=${productId}`);
    renderRelationsGroups(productId, data.relations || {});
    renderCoPurchased(data.co_purchased || []);
  } catch (error) {
    groupsContainer.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
    if (coPurchasedContainer) coPurchasedContainer.innerHTML = "";
  }
}

function renderRelationsGroups(productId, relations) {
  const container = document.getElementById("relations-groups");
  if (!container) return;

  container.innerHTML = RELATION_TYPES.map((type) => {
    const items = relations[type.key] || [];
    return `
      <div class="relation-group" data-relation-type="${type.key}">
        <h4>${escapeHtml(type.label)}</h4>
        <div class="relation-chips" id="relation-chips-${type.key}">
          ${items.length === 0
            ? '<span style="font-size:12px; color:#8a9995;">هنوز افزوده نشده</span>'
            : items.map((item) => `
                <span class="relation-chip">
                  ${escapeHtml(item.name)}
                  <button type="button" data-remove-relation="${item.id}" data-relation-type="${type.key}" title="حذف">×</button>
                </span>
              `).join("")}
        </div>
        <div class="relation-search">
          <input type="text" placeholder="جست‌وجوی محصول برای افزودن..." data-relation-search="${type.key}">
          <div class="relation-search-results" id="relation-search-results-${type.key}" style="display:none;"></div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-remove-relation]").forEach((button) => {
    button.addEventListener("click", () => {
      removeProductRelation(productId, Number(button.dataset.removeRelation), button.dataset.relationType);
    });
  });

  container.querySelectorAll("[data-relation-search]").forEach((input) => {
    const relationType = input.dataset.relationSearch;

    input.addEventListener("input", () => {
      clearTimeout(relationsSearchTimers[relationType]);
      const query = input.value.trim();
      const resultsBox = document.getElementById(`relation-search-results-${relationType}`);

      if (!query) {
        resultsBox.style.display = "none";
        resultsBox.innerHTML = "";
        return;
      }

      relationsSearchTimers[relationType] = setTimeout(async () => {
        try {
          const data = await fetchAdmin(`/admin/products/search?q=${encodeURIComponent(query)}&exclude_id=${productId}`);
          const results = data.products || [];

          if (results.length === 0) {
            resultsBox.innerHTML = '<button type="button" disabled>محصولی پیدا نشد</button>';
          } else {
            resultsBox.innerHTML = results.map((product) => `
              <button type="button" data-add-relation="${product.id}" data-relation-type="${relationType}">
                ${escapeHtml(product.name)} ${product.active ? "" : "(غیرفعال)"}
              </button>
            `).join("");
          }
          resultsBox.style.display = "block";

          resultsBox.querySelectorAll("[data-add-relation]").forEach((button) => {
            button.addEventListener("click", async () => {
              await addProductRelation(productId, Number(button.dataset.addRelation), button.dataset.relationType);
              input.value = "";
              resultsBox.style.display = "none";
              resultsBox.innerHTML = "";
            });
          });
        } catch (error) {
          resultsBox.innerHTML = `<button type="button" disabled>${escapeHtml(error.message)}</button>`;
          resultsBox.style.display = "block";
        }
      }, 300);
    });
  });
}

async function addProductRelation(productId, relatedProductId, relationType) {
  try {
    await fetchAdmin("/admin/product-relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, related_product_id: relatedProductId, relation_type: relationType }),
    });
    showToast("رابطه با موفقیت افزوده شد.", "success");
    await loadProductRelations(productId);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function removeProductRelation(productId, relatedProductId, relationType) {
  try {
    await fetchAdmin(
      `/admin/product-relations?product_id=${productId}&related_product_id=${relatedProductId}&relation_type=${relationType}`,
      { method: "DELETE" }
    );
    await loadProductRelations(productId);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderCoPurchased(list) {
  const container = document.getElementById("co-purchased-list");
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '<p class="loading">هنوز داده کافی از سفارش‌های واقعی برای این محصول وجود ندارد.</p>';
    return;
  }

  container.innerHTML = list.map((item) => `
    <div class="co-purchased-row">
      <span>${escapeHtml(item.name)}</span>
      <span>${Number(item.times_together).toLocaleString("fa-IR")} بار همراه خریداری شده</span>
    </div>
  `).join("");
}

// =========================
// شروع
// =========================

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("products");
  setupRichTextToolbar();
  loadCategoriesForSelect();
  loadShippingClassesForSelect();

  document.getElementById("refresh-products")?.addEventListener("click", () => loadProducts(currentPage));
  document.getElementById("cancel-edit")?.addEventListener("click", clearForm);

  document.getElementById("add-image")?.addEventListener("click", () => {
    const input = document.getElementById("product-image");
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    productImages.push({ image: value, alt: "" });
    input.value = "";
    renderImageList();
  });

  document.getElementById("product-brand")?.addEventListener("input", scheduleTechnicalPreviewRefresh);
  document.getElementById("product-model")?.addEventListener("input", scheduleTechnicalPreviewRefresh);

  document.getElementById("add-spec-row")?.addEventListener("click", () => {
    productSpecs.push({ label: "", value: "" });
    renderSpecsList();
  });

  document.getElementById("product-form")?.addEventListener("submit", saveProduct);
  document.getElementById("save-shipping-rates")?.addEventListener("click", saveProductShippingRates);

  document.getElementById("products-search-button")?.addEventListener("click", () => loadProducts(1));
  document.getElementById("products-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadProducts(1);
    }
  });
  document.getElementById("products-active-filter")?.addEventListener("change", () => loadProducts(1));

  clearForm();
  loadProducts(1);
});
