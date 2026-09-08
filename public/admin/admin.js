const API_BASE = "/api/store";

const IMAGE_BASE_PATH = "/assets/products/";

let products = [];

async function loadProducts() {
  const container = document.getElementById("products-list");

  container.innerHTML =
    '<p class="loading">در حال بارگذاری محصولات...</p>';

  try {
    const response = await fetch(`${API_BASE}/products`);

    if (!response.ok) {
      throw new Error("خطا در دریافت محصولات");
    }

    const data = await response.json();

    products = data.products || [];

    if (!Array.isArray(products) || products.length === 0) {
      container.innerHTML =
        '<p class="loading">هنوز محصولی ثبت نشده است.</p>';
      return;
    }

    renderProducts();
  } catch (error) {
    console.error(error);

    container.innerHTML =
      '<p class="loading">دریافت محصولات با مشکل مواجه شد.</p>';
  }
}

function renderProducts() {
  const container = document.getElementById("products-list");

  container.innerHTML = products.map(product => `
    <div class="product-row">
      <div>
        <strong>${escapeHtml(product.name)}</strong>

        <div>
          قیمت:
          ${Number(product.price || 0).toLocaleString("fa-IR")}
          تومان
        </div>

        <div>
          موجودی:
          ${Number(product.stock || 0).toLocaleString("fa-IR")}
        </div>

        <div>
          تصاویر:
          ${(product.images || []).length.toLocaleString("fa-IR")}
        </div>
      </div>

      <button
        type="button"
        class="secondary-button"
        onclick="editProduct('${escapeAttribute(product.id)}')"
      >
        ویرایش
      </button>
    </div>
  `).join("");
}

function editProduct(id) {
  const product = products.find(
    item => String(item.id) === String(id)
  );

  if (!product) return;

  document.getElementById("product-id").value = product.id;
  document.getElementById("name").value = product.name || "";
  document.getElementById("slug").value = product.slug || "";
  document.getElementById("description").value =
    product.description || "";
  document.getElementById("price").value =
    product.price || 0;
  document.getElementById("stock").value =
    product.stock || 0;

  const imageFields =
    document.getElementById("image-fields");

  imageFields.innerHTML = "";

  let images = [];

  if (Array.isArray(product.images) && product.images.length > 0) {
    images = product.images.map(item => item.image || "");
  } else if (product.image) {
    images = [product.image];
  }

  if (images.length === 0) {
    addImageField();
  } else {
    images.forEach(image => {
      addImageField(image);
    });
  }

  document.getElementById("active").checked =
    product.active !== 0;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function addImageField(value = "") {
  const container =
    document.getElementById("image-fields");

  const wrapper = document.createElement("div");

  wrapper.className = "image-field";

  const input = document.createElement("input");

  input.type = "text";
  input.className = "product-image-input";
  input.placeholder = "مثلاً: test-product.jpeg";
  input.value = getImageFileName(value);

  wrapper.appendChild(input);

  container.appendChild(wrapper);
}

function getImageFileName(value) {
  const image = String(value || "").trim();

  if (image.startsWith(IMAGE_BASE_PATH)) {
    return image.substring(IMAGE_BASE_PATH.length);
  }

  return image;
}

function getImagePaths() {
  const inputs = document.querySelectorAll(
    ".product-image-input"
  );

  return Array.from(inputs)
    .map(input => buildImagePath(input.value))
    .filter(Boolean);
}

function clearForm() {
  document.getElementById("product-form").reset();

  document.getElementById("product-id").value = "";

  document.getElementById("active").checked = true;

  const imageFields =
    document.getElementById("image-fields");

  imageFields.innerHTML = "";

  addImageField();
}

function buildImagePath(fileName) {
  const value = String(fileName || "").trim();

  if (!value) {
    return "";
  }

  if (value.startsWith(IMAGE_BASE_PATH)) {
    return value;
  }

  return IMAGE_BASE_PATH + value.replace(/^\/+/, "");
}

async function createProduct(event) {
  event.preventDefault();

  const productId =
    document.getElementById("product-id").value.trim();

  const product = {
    name: document.getElementById("name").value.trim(),
    description:
      document.getElementById("description").value.trim(),
    price: Number(
      document.getElementById("price").value
    ),
    stock: Number(
      document.getElementById("stock").value
    ),
    image: "",
    images: getImagePaths(),
    active:
      document.getElementById("active").checked
  };

  product.image = product.images[0] || "";

  if (!product.name) {
    alert("نام محصول الزامی است.");
    return;
  }

  if (!productId) {
    const slug =
      document.getElementById("slug").value.trim();

    if (!slug) {
      alert("شناسه محصول الزامی است.");
      return;
    }

    product.slug = slug;
  }

  const token = prompt("رمز مدیریت را وارد کنید:");

  if (!token) {
    return;
  }

  const isEditing = !!productId;

  if (isEditing) {
    product.id = Number(productId);
  }

  try {
    const response = await fetch(
      `${API_BASE}/products`,
      {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": token
        },
        body: JSON.stringify(product)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        alert("رمز مدیریت صحیح نیست.");
      } else {
        alert(
          data.message ||
          "عملیات انجام نشد."
        );
      }

      return;
    }

    alert(
      isEditing
        ? "محصول با موفقیت ویرایش شد."
        : "محصول با موفقیت ثبت شد."
    );

    clearForm();

    await loadProducts();

  } catch (error) {
    console.error(error);

    alert("ارتباط با سرور برقرار نشد.");
  }
}

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

document.addEventListener(
  "DOMContentLoaded",
  () => {

    loadProducts();

    document
      .getElementById("refresh-products")
      .addEventListener(
        "click",
        loadProducts
      );

    document
      .getElementById("cancel-edit")
      .addEventListener(
        "click",
        clearForm
      );

    document
      .getElementById("add-image")
      .addEventListener(
        "click",
        () => addImageField()
      );

    document
      .getElementById("product-form")
      .addEventListener(
        "submit",
        createProduct
      );

    clearForm();
  }
);
