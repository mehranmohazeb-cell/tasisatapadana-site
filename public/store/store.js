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
    setupProductSearch();

  } catch (error) {
    console.error(error);

    grid.innerHTML =
      `<p class="loading">دریافت محصولات با مشکل مواجه شد.</p>`;
  }
}

/* =========================================================
   جستجوی محصول (کاملاً سمت کلاینت، روی داده‌های همین صفحه)
   ========================================================= */

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[إأآا]/g, "ا")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterProducts(query) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return products;
  }

  return products.filter((product) => {
    const haystack = normalizeSearchText(
      [product.name, product.brand, product.description].filter(Boolean).join(" ")
    );
    return haystack.includes(normalizedQuery);
  });
}

function setupProductSearch() {
  const input = document.getElementById("product-search");
  const emptyMessage = document.getElementById("product-search-empty");

  if (!input) return;

  input.addEventListener("input", () => {
    const filtered = filterProducts(input.value);

    if (filtered.length === 0) {
      document.getElementById("products-grid").innerHTML = "";
      if (emptyMessage) {
        emptyMessage.textContent = "محصولی با این عبارت پیدا نشد.";
        emptyMessage.hidden = false;
      }
      return;
    }

    if (emptyMessage) emptyMessage.hidden = true;
    renderProducts(filtered);
  });
}

/* =========================================================
   مسیر صحیح تصویر محصول — دقیقاً همان منطق صفحه جزئیات محصول
   (product.html → getProductImageUrl) تا نتیجه هر دو مسیر یکسان
   و سازگار با ساختار فعلی تصاویر باشد.
   ========================================================= */

function getProductImageUrl(image) {
  if (!image) {
    return "/assets/products/placeholder.svg";
  }

  const value = String(image).trim();

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  if (value.startsWith("/")) {
    return value;
  }

  if (value.startsWith("assets/")) {
    return "/" + value;
  }

  if (value.startsWith("products/")) {
    return "/assets/" + value;
  }

  return "/assets/products/" + value;
}

// انتخاب تصویر اصلی محصول از فیلد تکی «image» یا (در صورت نبود) از اولین
// آیتم آرایه «images» — همان اولویتی که renderProducts همیشه استفاده
// می‌کرده، فقط این‌بار در یک تابع مشترک تا addToCart هم از همان نتیجه
// استفاده کند.
function getPrimaryProductImage(product) {
  let raw = product.image || "";

  if (!raw && Array.isArray(product.images) && product.images.length > 0) {
    raw = product.images[0].image || "";
  }

  return getProductImageUrl(raw);
}

function renderProducts(items) {
  const grid = document.getElementById("products-grid");

  grid.innerHTML = items.map(product => {

    const image = getPrimaryProductImage(product);

    const title = escapeHtml(product.name || "محصول");
    const price = formatPrice(product.price);

    // بررسی موجودی — دقیقاً همان منطقی که صفحه جزئیات محصول استفاده می‌کند:
    // stock عددی بزرگ‌تر از صفر باشد. اگر ناموجود است، دکمه غیرفعال و متن
    // «موجودی تمام شده» به‌جای «افزودن به سبد خرید» نمایش داده می‌شود.
    const inStock = Number(product.stock) > 0;

    return `
      <article class="product-card">

        <a
          href="product/${encodeURIComponent(product.slug)}"
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
            ${inStock ? `onclick="addToCart('${escapeAttribute(product.id)}')"` : "disabled"}
          >
            ${inStock ? "افزودن به سبد خرید" : "موجودی تمام شده"}
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

  // بررسی مجدد موجودی همین‌جا (نه فقط در رندر کارت) — جلوی افزودن دستی از
  // طریق کنسول مرورگر یا وضعیت قدیمی صفحه را هم می‌گیرد. تصمیم نهایی و
  // واقعی همیشه در Backend هنگام ثبت سفارش گرفته می‌شود.
  if (!(Number(product.stock) > 0)) {
    alert("این محصول در حال حاضر ناموجود است.");
    return;
  }

  const cart = JSON.parse(
    localStorage.getItem("tasisat_apadana_cart") || "[]"
  );

  const existing = cart.find(
    item => String(item.id) === String(product.id)
  );

  if (existing) {
    if (existing.quantity + 1 > Number(product.stock)) {
      alert("موجودی این محصول کافی نیست.");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      // قبلاً اینجا مقدار خام product.image ذخیره می‌شد (بدون عبور از همان
      // منطق resolve که renderProducts استفاده می‌کند)؛ همین باعث می‌شد
      // مسیر نسبی تصویر در سبد خرید نادرست/شکسته باشد. با
      // getPrimaryProductImage همیشه همان مسیر واقعی و صحیحی که در کارت
      // فروشگاه دیده می‌شود، در سبد هم ذخیره می‌شود.
      image: getPrimaryProductImage(product),
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
