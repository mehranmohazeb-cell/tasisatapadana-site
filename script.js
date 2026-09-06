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
