const API_BASE = "/api/store";

let editingProductId = null;
let productImages = [];
let products = [];
let orders = [];
let adminToken = "";

const STATUS_LABELS = {
  pending: "در انتظار بررسی",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال شده",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
};


// =========================
// Helpers
// =========================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}


function formatPrice(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}


function formatDate(value) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("fa-IR");
  } catch {
    return String(value);
  }
}


// =========================
// Product Image Path
// =========================

function getProductImageUrl(image) {
  if (!image) return "";

  const value =
    String(image).trim();

  if (!value) return "";

  // اگر مسیر کامل اینترنتی باشد
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  // اگر مسیر از قبل با / شروع شده باشد
  if (value.startsWith("/")) {
    return value;
  }

  // اگر مسیر assets/products باشد
  if (
    value.startsWith("assets/")
  ) {
    return "/" + value;
  }

  // اگر مسیر products/... باشد
  if (
    value.startsWith("products/")
  ) {
    return "/assets/" + value;
  }

  // حالت معمول:
  // فقط نام فایل در D1 ذخیره شده است
  return "/assets/products/" + value;
}


// =========================
// Products
// =========================

async function loadProducts() {
  const container =
    document.getElementById(
      "products-list"
    );

  if (!container) return;

  container.innerHTML =
    '<p class="loading">در حال بارگذاری محصولات...</p>';

  try {
    const response =
      await fetch(
        `${API_BASE}/products`
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.message ||
        "خطا در دریافت محصولات."
      );
    }

    products =
      data.products || [];

    renderProducts();

  } catch (error) {
    container.innerHTML =
      `<p class="loading">${escapeHtml(
        error.message
      )}</p>`;
  }
}


function renderProducts() {
  const container =
    document.getElementById(
      "products-list"
    );

  if (!container) return;

  if (products.length === 0) {
    container.innerHTML =
      '<p class="loading">هنوز محصولی ثبت نشده است.</p>';
    return;
  }

  container.innerHTML =
    products.map(
      product => {

        const image =
          getProductImageUrl(
            product.image
          );

        return `
          <div class="product-admin-item">

            ${
              image
                ? `
                  <img
                    src="${escapeHtml(image)}"
                    alt="${escapeHtml(product.name)}"
                    class="product-admin-image"
                    onerror="this.style.display='none';"
                  >
                `
                : `
                  <div class="product-admin-image"></div>
                `
            }

            <div class="product-admin-info">

              <strong>
                ${escapeHtml(
                  product.name
                )}
              </strong>

              <span>
                قیمت:
                ${formatPrice(
                  product.price
                )}
                تومان
              </span>

              <span>
                موجودی:
                ${formatPrice(
                  product.stock
                )}
              </span>

            </div>

            <button
              type="button"
              class="secondary-button"
              onclick="editProduct(${Number(product.id)})"
            >
              ویرایش
            </button>

          </div>
        `;
      }
    ).join("");
}


// =========================
// Product Form
// =========================

function clearForm() {
  const form =
    document.getElementById(
      "product-form"
    );

  if (!form) return;

  form.reset();

  const idInput =
    document.getElementById(
      "product-id"
    );

  if (idInput) {
    idInput.value = "";
  }

  const title =
    document.getElementById(
      "form-title"
    );

  if (title) {
    title.textContent =
      "افزودن محصول";
  }

  editingProductId = null;
  productImages = [];

  renderImageList();
}


function editProduct(id) {
  const product =
    products.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!product) return;

  editingProductId =
    Number(product.id);

  const idInput =
    document.getElementById(
      "product-id"
    );

  const nameInput =
    document.getElementById(
      "product-name"
    );

  const slugInput =
    document.getElementById(
      "product-slug"
    );

  const descriptionInput =
    document.getElementById(
      "product-description"
    );

  const priceInput =
    document.getElementById(
      "product-price"
    );

  const stockInput =
    document.getElementById(
      "product-stock"
    );

  const activeInput =
    document.getElementById(
      "product-active"
    );

  if (idInput)
    idInput.value =
      product.id;

  if (nameInput)
    nameInput.value =
      product.name || "";

  if (slugInput)
    slugInput.value =
      product.slug || "";

  if (descriptionInput)
    descriptionInput.value =
      product.description || "";

  if (priceInput)
    priceInput.value =
      product.price || 0;

  if (stockInput)
    stockInput.value =
      product.stock || 0;

  if (activeInput)
    activeInput.checked =
      Number(product.active) === 1;

  productImages =
    (product.images || [])
      .map(item => item.image)
      .filter(Boolean);

  const title =
    document.getElementById(
      "form-title"
    );

  if (title) {
    title.textContent =
      "ویرایش محصول";
  }

  renderImageList();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


function renderImageList() {
  const container =
    document.getElementById(
      "image-list"
    );

  if (!container) return;

  if (
    productImages.length === 0
  ) {
    container.innerHTML =
      '<p class="loading">هنوز عکسی اضافه نشده است.</p>';
    return;
  }

  container.innerHTML =
    productImages.map(
      (image, index) => `
        <div class="image-admin-item">

          <span>
            ${index + 1}.
            ${escapeHtml(image)}
          </span>

          <button
            type="button"
            class="secondary-button"
            onclick="removeProductImage(${index})"
          >
            حذف
          </button>

        </div>
      `
    ).join("");
}


function removeProductImage(index) {
  productImages.splice(
    index,
    1
  );

  renderImageList();
}


// =========================
// Save Product
// =========================

async function saveProduct(event) {
  event.preventDefault();

  const name =
    document.getElementById(
      "product-name"
    )?.value.trim();

  const slug =
    document.getElementById(
      "product-slug"
    )?.value.trim();

  const description =
    document.getElementById(
      "product-description"
    )?.value.trim();

  const price =
    Number(
      document.getElementById(
        "product-price"
      )?.value
    );

  const stock =
    Number(
      document.getElementById(
        "product-stock"
      )?.value
    );

  const active =
    document.getElementById(
      "product-active"
    )?.checked;

  if (!name || !slug) {
    alert(
      "نام محصول و شناسه محصول الزامی است."
    );
    return;
  }

  const payload = {
    name,
    slug,
    description,
    price,
    stock,
    active,
    images:
      productImages,
  };

  if (editingProductId) {
    payload.id =
      editingProductId;
  }

  if (!adminToken) {
    adminToken =
      prompt(
        "رمز مدیریت را وارد کنید:"
      ) || "";
  }

  if (!adminToken) {
    return;
  }

  try {
    const response =
      await fetch(
        `${API_BASE}/products`,
        {
          method:
            editingProductId
              ? "PUT"
              : "POST",

          headers: {
            "Content-Type":
              "application/json",
            "X-Admin-Token":
              adminToken,
          },

          body:
            JSON.stringify(
              payload
            ),
        }
      );

    const data =
      await response.json();

    if (
      response.status === 401
    ) {
      adminToken = "";

      throw new Error(
        "رمز مدیریت صحیح نیست."
      );
    }

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.message ||
        "خطا در ذخیره محصول."
      );
    }

    alert(
      editingProductId
        ? "محصول با موفقیت ویرایش شد."
        : "محصول با موفقیت ثبت شد."
    );

    clearForm();

    await loadProducts();

  } catch (error) {
    alert(
      error.message
    );
  }
}


// =========================
// Orders
// =========================

async function loadOrders() {
  const container =
    document.getElementById(
      "orders-list"
    );

  if (!container) return;

  container.innerHTML =
    '<p class="loading">در حال بارگذاری سفارش‌ها...</p>';

  if (!adminToken) {
    adminToken =
      prompt(
        "رمز مدیریت را وارد کنید:"
      ) || "";
  }

  if (!adminToken) {
    container.innerHTML =
      '<p class="loading">ورود به مدیریت لغو شد.</p>';
    return;
  }

  try {
    const response =
      await fetch(
        `${API_BASE}/orders`,
        {
          method: "GET",
          headers: {
            "X-Admin-Token":
              adminToken,
          },
        }
      );

    const data =
      await response.json();

    if (
      response.status === 401
    ) {
      adminToken = "";

      throw new Error(
        "رمز مدیریت صحیح نیست."
      );
    }

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.message ||
        "خطا در دریافت سفارش‌ها."
      );
    }

    orders =
      data.orders || [];

    renderOrders();

  } catch (error) {
    container.innerHTML =
      `<p class="loading">${escapeHtml(
        error.message
      )}</p>`;
  }
}


function renderOrders() {
  const container =
    document.getElementById(
      "orders-list"
    );

  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML =
      '<p class="loading">هنوز سفارشی ثبت نشده است.</p>';
    return;
  }

  container.innerHTML =
    orders.map(
      order => {

        const status =
          order.status ||
          "pending";

        return `
          <div class="order-admin-item">

            <div class="order-admin-main">

              <div>

                <strong>
                  سفارش شماره
                  ${Number(order.id)}
                </strong>

                <span>
                  مشتری:
                  ${escapeHtml(
                    order.customer_name
                  )}
                </span>

                <span>
                  مبلغ:
                  ${formatPrice(
                    order.total
                  )}
                  تومان
                </span>

                <span>
                  تاریخ:
                  ${escapeHtml(
                    formatDate(
                      order.created_at
                    )
                  )}
                </span>

              </div>

              <div class="order-status-box">

                <label>
                  وضعیت سفارش
                </label>

                <select
                  class="order-status-select"
                  onchange="changeOrderStatus(${Number(order.id)}, this.value)"
                >

                  ${Object.entries(
                    STATUS_LABELS
                  ).map(
                    ([value, label]) => `
                      <option
                        value="${value}"
                        ${
                          value === status
                            ? "selected"
                            : ""
                        }
                      >
                        ${label}
                      </option>
                    `
                  ).join("")}

                </select>

                <small>
                  وضعیت فعلی:
                  ${escapeHtml(
                    STATUS_LABELS[status] ||
                    status
                  )}
                </small>

              </div>

              <button
                type="button"
                class="secondary-button"
                onclick="showOrderDetails(${Number(order.id)})"
              >
                جزئیات
              </button>

            </div>

          </div>
        `;
      }
    ).join("");
}


// =========================
// Change Order Status
// =========================

async function changeOrderStatus(
  orderId,
  newStatus
) {
  const order =
    orders.find(
      item =>
        Number(item.id) ===
        Number(orderId)
    );

  if (!order) return;

  const oldStatus =
    order.status ||
    "pending";

  if (
    newStatus ===
    oldStatus
  ) {
    return;
  }

  const newLabel =
    STATUS_LABELS[newStatus] ||
    newStatus;

  const confirmed =
    confirm(
      `وضعیت سفارش شماره ${orderId} به «${newLabel}» تغییر کند؟`
    );

  if (!confirmed) {
    renderOrders();
    return;
  }

  if (!adminToken) {
    adminToken =
      prompt(
        "رمز مدیریت را وارد کنید:"
      ) || "";
  }

  if (!adminToken) {
    renderOrders();
    return;
  }

  try {
    const response =
      await fetch(
        `${API_BASE}/orders/${Number(orderId)}`,
        {
          method: "PUT",

          headers: {
            "Content-Type":
              "application/json",

            "X-Admin-Token":
              adminToken,
          },

          body:
            JSON.stringify({
              status:
                newStatus,
            }),
        }
      );

    const data =
      await response.json();

    if (
      response.status === 401
    ) {
      adminToken = "";

      throw new Error(
        "رمز مدیریت صحیح نیست."
      );
    }

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.message ||
        "تغییر وضعیت سفارش انجام نشد."
      );
    }

    order.status =
      newStatus;

    renderOrders();

    alert(
      "وضعیت سفارش با موفقیت تغییر کرد."
    );

  } catch (error) {
    alert(
      error.message
    );

    renderOrders();
  }
}


// =========================
// Order Details
// =========================

function showOrderDetails(id) {
  const order =
    orders.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!order) {
    alert(
      "اطلاعات سفارش پیدا نشد."
    );
    return;
  }

  const items =
    Array.isArray(order.items)
      ? order.items
      : [];

  const itemsText =
    items.length
      ? items.map(
          item =>
            `${item.product_name} × ` +
            `${Number(
              item.quantity || 0
            ).toLocaleString("fa-IR")} — ` +
            `${Number(
              item.price || 0
            ).toLocaleString("fa-IR")} تومان`
        ).join("\n")
      : "بدون کالا";

  const statusLabel =
    STATUS_LABELS[
      order.status
    ] ||
    order.status ||
    "-";

  alert(
    "سفارش شماره " +
    order.id +

    "\n\nنام مشتری: " +
    order.customer_name +

    "\nشماره تماس: " +
    order.customer_phone +

    "\nآدرس: " +
    order.customer_address +

    "\n\nوضعیت: " +
    statusLabel +

    "\n\nکالاها:\n" +
    itemsText +

    "\n\nمبلغ کل: " +
    Number(
      order.total || 0
    ).toLocaleString("fa-IR") +
    " تومان"
  );
}


// =========================
// Start
// =========================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const refreshProducts =
      document.getElementById(
        "refresh-products"
      );

    if (refreshProducts) {
      refreshProducts.addEventListener(
        "click",
        loadProducts
      );
    }

    const cancelEdit =
      document.getElementById(
        "cancel-edit"
      );

    if (cancelEdit) {
      cancelEdit.addEventListener(
        "click",
        clearForm
      );
    }

    const addImage =
      document.getElementById(
        "add-image"
      );

    if (addImage) {
      addImage.addEventListener(
        "click",
        () => {

          const input =
            document.getElementById(
              "product-image"
            );

          if (!input) return;

          const value =
            input.value.trim();

          if (!value) return;

          productImages.push(
            value
          );

          input.value = "";

          renderImageList();
        }
      );
    }

    const productForm =
      document.getElementById(
        "product-form"
      );

    if (productForm) {
      productForm.addEventListener(
        "submit",
        saveProduct
      );
    }

    const refreshOrders =
      document.getElementById(
        "refresh-orders"
      );

    if (refreshOrders) {
      refreshOrders.addEventListener(
        "click",
        loadOrders
      );
    }

    clearForm();

    loadProducts();

    loadOrders();
  }
); 
