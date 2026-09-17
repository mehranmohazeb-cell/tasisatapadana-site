// =========================
// مدیریت محصولات — /admin/products/
// =========================

let editingProductId = null;
let productImages = []; // [{ image, alt }]
let productSpecs = []; // [{ label, value }]
let currentPage = 1;
const PAGE_LIMIT = 20;
let lastPagination = { page: 1, total_pages: 1, total: 0 };

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
  document.getElementById("product-description-editor").innerHTML = product.description || "";
  document.getElementById("product-price").value = product.price || 0;
  document.getElementById("product-compare-price").value = product.compare_at_price ?? "";
  document.getElementById("product-stock").value = product.stock || 0;
  document.getElementById("product-shipping-cost").value = product.shipping_cost ?? "";
  document.getElementById("product-shipping-method").value = product.shipping_method || "";
  document.getElementById("product-shipping-time").value = product.shipping_time || "";
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
  window.scrollTo({ top: 0, behavior: "smooth" });
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
// مشخصات فنی (label/value قابل افزودن/حذف/ترتیب)
// =========================

function renderSpecsList() {
  const container = document.getElementById("specs-list");
  if (!container) return;

  if (productSpecs.length === 0) {
    container.innerHTML = '<p class="loading">هنوز مشخصه‌ای اضافه نشده است.</p>';
    return;
  }

  container.innerHTML = productSpecs.map((spec, index) => `
    <div class="spec-row">
      <input type="text" placeholder="مشخصه (مثلاً: برند)" value="${escapeAttribute(spec.label)}" oninput="updateSpec(${index}, 'label', this.value)">
      <input type="text" placeholder="مقدار" value="${escapeAttribute(spec.value)}" oninput="updateSpec(${index}, 'value', this.value)">
      <button type="button" class="secondary-button" onclick="moveSpec(${index}, -1)" ${index === 0 ? "disabled" : ""}>▲</button>
      <button type="button" class="secondary-button" onclick="moveSpec(${index}, 1)" ${index === productSpecs.length - 1 ? "disabled" : ""}>▼</button>
      <button type="button" class="danger-button" onclick="removeSpec(${index})">حذف</button>
    </div>
  `).join("");
}

function updateSpec(index, field, value) {
  if (productSpecs[index]) productSpecs[index][field] = value;
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
  const description = document.getElementById("product-description-editor")?.innerHTML.trim();
  const price = Number(document.getElementById("product-price")?.value);
  const comparePriceRaw = document.getElementById("product-compare-price")?.value;
  const stock = Number(document.getElementById("product-stock")?.value);
  const shippingCostRaw = document.getElementById("product-shipping-cost")?.value;
  const shippingMethod = document.getElementById("product-shipping-method")?.value.trim();
  const shippingTime = document.getElementById("product-shipping-time")?.value.trim();
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
    compare_at_price: comparePriceRaw ? Number(comparePriceRaw) : null,
    shipping_cost: shippingCostRaw ? Number(shippingCostRaw) : null,
    shipping_method: shippingMethod || null,
    shipping_time: shippingTime || null,
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
// شروع
// =========================

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("products");
  setupRichTextToolbar();

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

  document.getElementById("add-spec-row")?.addEventListener("click", () => {
    productSpecs.push({ label: "", value: "" });
    renderSpecsList();
  });

  document.getElementById("product-form")?.addEventListener("submit", saveProduct);

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
