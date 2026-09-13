// =========================
// مدیریت محصولات — /admin/products/
// =========================

let editingProductId = null;
let productImages = [];
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
    const image = getProductImageUrl(product.image);
    const isActive = Number(product.active) === 1;

    return `
      <div class="product-admin-item">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" class="product-admin-image" onerror="this.style.display='none';">`
            : `<div class="product-admin-image"></div>`
        }
        <div class="product-admin-info">
          <strong>${escapeHtml(product.name)}</strong>
          <span>قیمت: ${formatPrice(product.price)} تومان</span>
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

  editingProductId = null;
  productImages = [];

  renderImageList();
}

function editProduct(id) {
  const product = productsCache.find((item) => Number(item.id) === Number(id));
  if (!product) return;

  editingProductId = Number(product.id);

  document.getElementById("product-id").value = product.id;
  document.getElementById("product-name").value = product.name || "";
  document.getElementById("product-slug").value = product.slug || "";
  document.getElementById("product-description").value = product.description || "";
  document.getElementById("product-price").value = product.price || 0;
  document.getElementById("product-stock").value = product.stock || 0;
  document.getElementById("product-active").checked = Number(product.active) === 1;

  productImages = (product.images || []).map((item) => item.image).filter(Boolean);

  document.getElementById("form-title").textContent = "ویرایش محصول";

  renderImageList();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderImageList() {
  const container = document.getElementById("image-list");
  if (!container) return;

  if (productImages.length === 0) {
    container.innerHTML = '<p class="loading">هنوز عکسی اضافه نشده است.</p>';
    return;
  }

  container.innerHTML = productImages.map((image, index) => `
    <div class="image-admin-item" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 11px; background:#f5f8f7; border:1px solid #dbe3e1; border-radius:8px; margin-bottom:8px;">
      <span style="min-width:0; overflow-wrap:anywhere; color:#48615e; font-size:13px;">${index + 1}. ${escapeHtml(image)}</span>
      <button type="button" class="secondary-button" onclick="removeProductImage(${index})">حذف</button>
    </div>
  `).join("");
}

function removeProductImage(index) {
  productImages.splice(index, 1);
  renderImageList();
}

async function saveProduct(event) {
  event.preventDefault();

  const name = document.getElementById("product-name")?.value.trim();
  const slug = document.getElementById("product-slug")?.value.trim();
  const description = document.getElementById("product-description")?.value.trim();
  const price = Number(document.getElementById("product-price")?.value);
  const stock = Number(document.getElementById("product-stock")?.value);
  const active = document.getElementById("product-active")?.checked;

  if (!name || !slug) {
    showToast("نام محصول و شناسه محصول الزامی است.", "error");
    return;
  }

  const payload = { name, slug, description, price, stock, active, images: productImages };
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

  document.getElementById("refresh-products")?.addEventListener("click", () => loadProducts(currentPage));
  document.getElementById("cancel-edit")?.addEventListener("click", clearForm);

  document.getElementById("add-image")?.addEventListener("click", () => {
    const input = document.getElementById("product-image");
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    productImages.push(value);
    input.value = "";
    renderImageList();
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
