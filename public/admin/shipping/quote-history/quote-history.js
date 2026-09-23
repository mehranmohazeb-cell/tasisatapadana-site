// =========================
// تاریخچه استعلام آنلاین — /admin/shipping/quote-history/
// =========================

async function loadHistory() {
  const container = document.getElementById("history-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  try {
    const data = await fetchAdmin("/admin/shipping-quote-history?limit=100");
    const history = data.history || [];
    if (history.length === 0) {
      container.innerHTML = '<p class="loading">هنوز هیچ استعلام آنلاینی ثبت نشده است.</p>';
      return;
    }
    container.innerHTML = history
      .map((q) => `
        <div class="quote-row">
          <div>
            <strong>${escapeHtml(q.provider_code)}</strong>
            ${q.available ? "" : '<span style="color:#a23b3b;">(ناموفق)</span>'}
            — مقصد: ${escapeHtml(q.destination_city || "—")}
            ${q.weight_grams != null ? ` | وزن: ${q.weight_grams} گرم` : ""}
            ${q.quoted_cost != null ? ` | هزینه: ${Number(q.quoted_cost).toLocaleString("fa-IR")} تومان` : ""}
            <br>
            <span style="color:#71817e; font-size:12px;">${new Date(q.quoted_at).toLocaleString("fa-IR")}</span>
          </div>
        </div>
      `)
      .join("");
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-quote-history");
  loadHistory();
  document.getElementById("refresh-history")?.addEventListener("click", loadHistory);
});
