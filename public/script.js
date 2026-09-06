/**
 * تنظیمات تماس — تنها جایی که باید شماره واقعی را وارد کنید
 * با تغییر همین دو مقدار، تمام دکمه‌های تماس و واتساپ در کل سایت
 * (هدر، Hero، بخش تماس فوری و فوتر) به‌روزرسانی می‌شوند.
 */
const CONTACT_CONFIG = {
  // شماره تلفن به همان شکلی که باید نمایش داده شود، مثال: '0311xxxxxxx'
  phone: '09139029945',

  // شماره واتساپ همراه با کد کشور و بدون + یا صفر ابتدایی، مثال ایران: '98912xxxxxxx'
  whatsapp: '989139029945',
};

document.addEventListener('DOMContentLoaded', () => {
  applyContactInfo();
  setupMobileMenu();
  setupFooterYear();
  loadStoreProducts();
});

function applyContactInfo() {
  document.querySelectorAll('[data-phone-link]').forEach((el) => {
    el.setAttribute('href', `tel:${CONTACT_CONFIG.phone}`);
  });

  document.querySelectorAll('[data-whatsapp-link]').forEach((el) => {
    el.setAttribute('href', `https://wa.me/${CONTACT_CONFIG.whatsapp}`);
  });

  document.querySelectorAll('[data-phone-text]').forEach((el) => {
    el.textContent = CONTACT_CONFIG.phone;
  });
}

function setupMobileMenu() {
  const menuToggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mainNav');

  if (!menuToggle || !nav) return;

  menuToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuToggle.classList.toggle('active', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuToggle.classList.remove('active');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function setupFooterYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}
async function loadStoreProducts() {
  const container = document.getElementById('storeProducts');

  if (!container) return;

  try {
    const response = await fetch('/api/store/products');

    if (!response.ok) {
      throw new Error('خطا در دریافت محصولات');
    }

    const data = await response.json();

    if (!data.ok || !Array.isArray(data.products)) {
      throw new Error('اطلاعات محصولات معتبر نیست');
    }

    if (data.products.length === 0) {
      container.innerHTML =
        '<p class="store-status">در حال حاضر محصولی برای نمایش وجود ندارد.</p>';
      return;
    }

    container.innerHTML = data.products
      .map((product) => {
        const image = product.image
          ? `<img class="store-card-image" src="${product.image}" alt="${product.name}" loading="lazy">`
          : '';

        const price = Number(product.price || 0).toLocaleString('fa-IR');

        return `
          <article class="store-card">
            ${image}

            <div class="store-card-content">
              <h3>${product.name}</h3>

              ${
                product.description
                  ? `<p class="store-card-description">${product.description}</p>`
                  : ''
              }

              <div class="store-card-price">
                ${price} تومان
              </div>

              <div class="store-card-stock">
                موجودی: ${Number(product.stock || 0).toLocaleString('fa-IR')}
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  } catch (error) {
    console.error('Store API error:', error);

    container.innerHTML =
      '<p class="store-status">امکان دریافت محصولات وجود ندارد.</p>';
  }
}
