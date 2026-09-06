const API_BASE = "/api";

let products = [];

async function loadProducts() {
  const grid = document.getElementById("products-grid");

  try {
    const response = await fetch(${API_BASE}/products);

    if (!response.ok) {
      throw new Error("خطا در دریافت محصولات");
    }

    products = await response.json();

    if (!Array.isArray(products) || products.length === 0) {
      grid.innerHTML = 
        <p class="loading">
          در حال حاضر محصولی برای نمایش وجود ندارد.
        </p>
      ;
      return;
    }

    renderProducts(products);
  } catch (error) {
    console.error(error);

    grid.innerHTML = 
      <p class="loading">
        دریافت محصولات با مشکل مواجه شد.
      </p>
    ;
  }
}

function renderProducts(items) {
  const grid = document.getElementById("products-grid");

  grid.innerHTML = items.map(product => {
    const image = product.image || "../assets/placeholder.svg";
    const title = escapeHtml(product.name || "محصول");
    const price = formatPrice(product.price);

    return 
      <article class="product-card">
        <a href="product.html?id=${encodeURIComponent(product.id)}">
          <img
            class="product-image"
            src="${image}"
            alt="${title}"
            loading="lazy"
          >
        </a>

        <div class="product-content">
          <h3 class="product-title">${title}</h3>

          <div class="product-price">
            ${price}
          </div>

          <button
            class="product-button"
            type="button"
            onclick="addToCart('${escapeAttribute(product.id)}')"
          >
            افزودن به سبد خرید
          </button>
        </div>
      </article>
    ;
  }).join("");
}

function formatPrice(price) {
  if (price === null || price === undefined || price === "") {
    return "تماس بگیرید";
  }

  const number = Number(price);

  if (Number.isNaN(number)) {
    return escapeHtml(String(price));
  }

  return ${number.toLocaleString("fa-IR")} تومان;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem("apadana_cart")) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("apadana_cart", JSON.stringify(cart));
  updateCartCount();
}

function addToCart(productId) {
  const cart = getCart();
  const existing = cart.find(item => String(item.id) === String(productId));

  if (existing) {
    existing.quantity += 1;
  } else {
    const product = products.find(
      item => String(item.id) === String(productId)
    );

    if (!product) return;

    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image || "../assets/placeholder.svg",
      quantity: 1
    });
  }

  saveCart(cart);
  alert("محصول به سبد خرید اضافه شد.");
}

function updateCartCount() {
  const element = document.getElementById("cart-count");
  if (!element) return;

  const cart = getCart();

  const count = cart.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

  element.textContent = count.toLocaleString("fa-IR");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();

  if (document.getElementById("products-grid")) {
    loadProducts();
  }
});
