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

function fillTapinConfigForm(config) {
  const c = config || {};
  const setVal = (id, value, fallback) => {
    const el = document.getElementById(id);
    if (el) el.value = value != null ? String(value) : fallback;
  };
  setVal("tapin-product-type-id", c.product_type_id, "1");
  setVal("tapin-packing-type-id", c.packing_type_id, "2");
  setVal("tapin-payment-type", c.payment_type, "10");
  setVal("tapin-delivery-type", c.delivery_type, "10");
  setVal("tapin-pickup-type", c.pickup_type, "20");
  setVal("tapin-origin-city", c.origin_city, "اصفهان");
  setVal("tapin-service-type-local", c.service_type_local, "7");
  setVal("tapin-service-type-domestic", c.service_type_domestic, "2");
}

function readTapinConfigForm() {
  return {
    product_type_id: Number(document.getElementById("tapin-product-type-id").value),
    packing_type_id: Number(document.getElementById("tapin-packing-type-id").value),
    payment_type: Number(document.getElementById("tapin-payment-type").value),
    delivery_type: Number(document.getElementById("tapin-delivery-type").value),
    pickup_type: Number(document.getElementById("tapin-pickup-type").value),
    origin_city: document.getElementById("tapin-origin-city").value.trim(),
    service_type_local: Number(document.getElementById("tapin-service-type-local").value) || 7,
    service_type_domestic: Number(document.getElementById("tapin-service-type-domestic").value) || 2,
  };
}

async function loadProviders() {
  const container = document.getElementById("providers-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  try {
    const data = await fetchAdmin("/admin/shipping-providers");
    renderProviders(data.providers || []);
    document.getElementById("mode-select").value = data.shipping_calculation_mode || "internal";

    const tapin = (data.providers || []).find((p) => p.code === "tapin");
    const tapinCard = document.getElementById("tapin-config-card");
    if (tapin && tapinCard) {
      tapinCard.style.display = "";
      fillTapinConfigForm(tapin.config);
    }
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

  document.getElementById("save-tapin-config")?.addEventListener("click", async () => {
    const config = readTapinConfigForm();
    try {
      await fetchAdmin("/admin/shipping-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "tapin", config }),
      });
      showToast("تنظیمات Tapin ذخیره شد.", "success");
      loadProviders();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});
