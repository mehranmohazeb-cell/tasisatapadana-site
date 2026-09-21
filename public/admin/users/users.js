// =========================
// مدیریت کاربران — /admin/users/
// =========================

let usersCache = [];
let currentPage = 1;
const PAGE_LIMIT = 20;

async function loadUsers(page = currentPage) {
  const container = document.getElementById("list-container");
  const paginationContainer = document.getElementById("pagination-container");

  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  const params = new URLSearchParams();
  params.set("page", page);
  params.set("limit", PAGE_LIMIT);

  const q = document.getElementById("filter-search")?.value.trim();
  const active = document.getElementById("filter-active")?.value;

  if (q) params.set("q", q);
  if (active) params.set("active", active);

  try {
    const data = await fetchAdmin(`/admin/customers?${params.toString()}`);
    currentPage = data.page || page;
    usersCache = data.customers || [];
    renderUsers();
    renderPagination(paginationContainer, data, (targetPage) => loadUsers(targetPage));
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function renderUsers() {
  const container = document.getElementById("list-container");

  if (usersCache.length === 0) {
    container.innerHTML = '<p class="loading">کاربری یافت نشد.</p>';
    return;
  }

  container.innerHTML = usersCache.map((u) => {
    const isActive = Number(u.is_active) !== 0;
    return `
      <div class="product-admin-item" style="grid-template-columns: 1fr auto;">
        <div class="product-admin-info">
          <strong>${escapeHtml(u.full_name)}</strong>
          <span>${escapeHtml(u.phone)} ${u.phone_verified ? "(شماره تأییدشده)" : ""}</span>
          <span>تاریخ ثبت‌نام: ${escapeHtml(formatDate(u.created_at))}</span>
          <span style="color:${isActive ? "#1c7a4f" : "#a23b3b"}; font-weight:700;">
            وضعیت: ${isActive ? "فعال" : "غیرفعال"}
          </span>
        </div>
        <button
          type="button"
          class="${isActive ? "secondary-button" : "primary-button"}"
          onclick="toggleUserActive(${Number(u.id)}, ${isActive ? "false" : "true"})"
        >
          ${isActive ? "غیرفعال‌کردن حساب" : "فعال‌کردن مجدد"}
        </button>
      </div>
    `;
  }).join("");
}

async function toggleUserActive(customerId, makeActive) {
  if (!makeActive) {
    const confirmed = confirm("این حساب غیرفعال شود؟ کاربر بلافاصله از حساب خود خارج می‌شود و تا فعال‌سازی مجدد نمی‌تواند وارد شود.");
    if (!confirmed) return;
  }

  try {
    await fetchAdmin(`/admin/customers/${customerId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: makeActive }),
    });
    showToast(makeActive ? "حساب فعال شد." : "حساب غیرفعال شد.", "success");
    loadUsers(currentPage);
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("users");

  loadUsers(1);

  document.getElementById("refresh-users")?.addEventListener("click", () => loadUsers(currentPage));
  document.getElementById("filter-active")?.addEventListener("change", () => loadUsers(1));
  document.getElementById("filter-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadUsers(1);
    }
  });
});
