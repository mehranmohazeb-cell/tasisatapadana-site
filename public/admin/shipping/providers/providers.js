// =========================
// Providerهای ارسال + حالت محاسبه — /admin/shipping/providers/
// =========================

function renderProviders(providers) {
  const container = document.getElementById("providers-container");
  container.innerHTML = providers
    .map((p) => {
      const isInternal = p.code === "internal";
      return `
        <div class="provider-row" data-code="${p.code}">
          <div>
            <strong>${escapeHtml(p.name)}</strong>
            <span class="provider-badge ${p.status}">${p.status === "active" ? "فعال" : "غیرفعال"}</span>
            <br>
            <span style="color:#71817e; font-size:12px;">
              نوع: ${p.type === "internal" ? "داخلی" : "آنلاین"} |
              حالت: ${p.mode === "quote" ? "استعلام" : "غیرفعال"} |
              Fallback: ${escapeHtml(p.fallback_provider_code || "—")}
            </span>
          </div>
          <div style="display:flex; gap:8px;">
            ${
              isInternal
                ? '<span style="font-size:12px; color:#71817e;">همیشه فعال</span>'
                : `<button class="secondary-button toggle-status" type="button">${p.status === "active" ? "غیرفعال کردن" : "فعال کردن"}</button>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".toggle-status").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".provider-row");
      const code = row.dataset.code;
      const current = providers.find((p) => p.code === code);
      const nextStatus = current.status === "active" ? "disabled" : "active";
      try {
        await fetchAdmin("/admin/shipping-providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, status: nextStatus }),
        });
        showToast("وضعیت Provider به‌روزرسانی شد.", "success");
        loadProviders();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

async function loadProviders() {
  const container = document.getElementById("providers-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  try {
    const data = await fetchAdmin("/admin/shipping-providers");
    renderProviders(data.providers || []);
    document.getElementById("mode-select").value = data.shipping_calculation_mode || "internal";
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-providers");
  loadProviders();

  document.getElementById("refresh-providers")?.addEventListener("click", loadProviders);

  document.getElementById("save-mode")?.addEventListener("click", async () => {
    const mode = document.getElementById("mode-select").value;
    try {
      await fetchAdmin("/admin/shipping-calculation-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      showToast("حالت محاسبه ارسال ذخیره شد.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
