const API_BASE = "/api/store";

let products = [];

async function loadProducts() {
  const grid = document.getElementById("products-grid");

  try {
    const response = await fetch(`${API_BASE}/products`);

    if (!response.ok) {
      throw new Error("خطا در دریافت محصولات");
    }

    const data = await response.json();

    products = data.products || [];

    if (!Array.isArray(products) || products.length === 0) {
      grid.innerHTML =
        `<p class="loading">در حال حاضر محصولی برای نمایش وجود ندارد.</p>`;
      return;
    }

    renderProducts(products);

  } catch (error) {
    console.error(error);

    grid.innerHTML =
      `<p class="loading">دریافت محصولات با مشکل مواجه شد.</p>`;
  }
}

function renderProducts(items) {
  const grid = document.getElementById("products-grid");

  grid.innerHTML = items.map(product => {

    const image = product.image || "/assets/placeholder.svg";
    const title = escapeHtml(product.name || "محصول");
    const price = formatPrice(product.price);

    return `
      <article class="product-card">

        <a
          href="product.html?slug=${encodeURIComponent(product.slug)}"
          class="product-link"
        >

          <img
            class="product-image"
            src="${escapeHtml(image)}"
            alt="${title}"
            loading="lazy"
          >

          <div class="product-content">

            <h3 class="product-title">${title}</h3>

            <div class="product-price">
              ${price}
            </div>

          </div>

        </a>

        <div class="product-content">

          <button
            class="product-button"
            type="button"
            onclick="addToCart('${escapeAttribute(product.id)}')"
          >
            افزودن به سبد خرید
          </button>

        </div>

      </article>
    `;

  }).join("");
}

function formatPrice(value) {
  return `${Number(value || 0).toLocaleString("fa-IR")} تومان`;
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

function addToCart(id) {
  const product = products.find(
    item => String(item.id) === String(id)
  );

  if (!product) return;

  const cart = JSON.parse(
    localStorage.getItem("tasisat_apadana_cart") || "[]"
  );

  const existing = cart.find(
    item => String(item.id) === String(product.id)
  );

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image || "",
      quantity: 1
    });
  }

  localStorage.setItem(
    "tasisat_apadana_cart",
    JSON.stringify(cart)
  );

  updateCartCount();

  alert("محصول به سبد خرید اضافه شد.");
}

function updateCartCount() {
  const cart = JSON.parse(
    localStorage.getItem("tasisat_apadana_cart") || "[]"
  );

  const count = cart.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  const element = document.getElementById("cart-count");

  if (element) {
    element.textContent = count.toLocaleString("fa-IR");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();

  if (document.getElementById("products-grid")) {
    loadProducts();
  }
});
