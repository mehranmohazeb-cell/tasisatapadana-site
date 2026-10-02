// =========================
// مسیر ارسال (Routing) — /admin/shipping/routing/
// =========================
const ROUTE_LABEL = { freight: "باربری (پس‌کرایه)", normal: "عادی" };
let routingState = { classes: [] };

function routeSelect(id, value, handler, withEmpty) {
  const opts = (withEmpty ? [["", "بدون Override"]] : []).concat([["normal", "عادی"], ["freight", "باربری"]]);
  return `<select onchange="${handler}(${id}, this.value)">` +
    opts.map(([v, l]) => `<option value="${v}" ${String(value || "") === v ? "selected" : ""}>${l}</option>`).join("") + "</select>";
}

async function loadRouting() {
  const filter = document.getElementById("filter-select").value;
  const q = document.getElementById("search-input").value.trim();
  try {
    const data = await fetchAdmin(`/admin/shipping-routing?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(q)}`);
    routingState.classes = data.classes || [];
    document.getElementById("migration-warning").style.display = data.columns_ready ? "none" : "block";
    document.getElementById("totals-line").textContent =
      `کل محصولات: ${data.totals.products} | باربری: ${data.totals.freight} | دارای هشدار: ${data.totals.flagged} | دارای Override: ${data.totals.overridden}`;

    document.getElementById("classes-container").innerHTML = routingState.classes.length === 0
      ? '<p class="loading">Shipping Classای ثبت نشده است.</p>'
      : routingState.classes.map((c) => `
        <div class="shipping-method-row">
          <strong>${escapeHtml(c.name)}</strong>
          ${routeSelect(c.id, c.route_policy || "normal", "setClassRoute", false)}
        </div>`).join("");

    document.getElementById("products-container").innerHTML = (data.products || []).length === 0
      ? '<p class="loading">محصولی یافت نشد.</p>'
      : data.products.map((p) => `
        <div class="shipping-method-row" style="flex-wrap:wrap; gap:8px;">
          <div style="min-width:220px; flex:1;">
            <strong>${escapeHtml(p.name)}</strong>
            <span class="shipping-badge">${escapeHtml(p.shipping_class_name || "بدون کلاس")}</span>
            <span class="shipping-badge ${p.effective_route_outside_isfahan === "freight" ? "" : "inactive"}">خارج اصفهان: ${ROUTE_LABEL[p.effective_route_outside_isfahan]}</span>
            <div style="font-size:12px; color:#71817e;">${escapeHtml(p.route_reason_label)}</div>
            ${p.flag_labels.length ? `<div style="font-size:12px; color:#a23b3b;">هشدار: ${p.flag_labels.map(escapeHtml).join("، ")}</div>` : ""}
          </div>
          <div>${routeSelect(p.id, p.override, "setProductOverride", true)}</div>
        </div>`).join("");
    initHelpTooltips(document.body);
  } catch (error) {
    document.getElementById("products-container").innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
  loadAudit();
}

async function loadAudit() {
  const box = document.getElementById("audit-container");
  try {
    const data = await fetchAdmin("/admin/shipping-routing/audit?limit=30");
    const rows = data.audit || [];
    box.innerHTML = rows.length === 0 ? '<p class="loading">تغییری ثبت نشده است.</p>' : rows.map((a) => `
      <div class="shipping-method-row" style="font-size:13px;">
        ${a.entity_type === "product" ? "محصول" : "کلاس"} #${a.entity_id}:
        ${escapeHtml(a.old_value || "—")} ← ${escapeHtml(a.new_value || "—")}
        <span style="color:#71817e;">${typeof formatDate === "function" ? escapeHtml(formatDate(a.changed_at)) : escapeHtml(a.changed_at)}</span>
      </div>`).join("");
  } catch (error) {
    box.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

async function setClassRoute(id, value) {
  try {
    await fetchAdmin("/admin/shipping-routing/class", { method: "PUT", body: JSON.stringify({ id, route_policy: value }) });
    showToast("مسیر کلاس ذخیره شد.", "success");
    loadRouting();
  } catch (error) { showToast(error.message, "error"); loadRouting(); }
}

async function setProductOverride(productId, value) {
  try {
    await fetchAdmin("/admin/shipping-routing/product", { method: "PUT", body: JSON.stringify({ product_id: productId, override: value || null }) });
    showToast("ذخیره شد.", "success");
    loadRouting();
  } catch (error) { showToast(error.message, "error"); loadRouting(); }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-routing");
  document.getElementById("refresh-btn").addEventListener("click", loadRouting);
  document.getElementById("filter-select").addEventListener("change", loadRouting);
  document.getElementById("search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") loadRouting(); });
  loadRouting();
});
