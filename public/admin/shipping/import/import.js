// =========================
// Import تعرفه ارسال — /admin/shipping/import/
// =========================

let lastCsvText = "";
let lastFilename = "";

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود."));
    reader.readAsText(file, "utf-8");
  });
}

function renderPreview(preview) {
  const container = document.getElementById("preview-container");
  const errorsHtml = (preview.invalid_rows || [])
    .map((row) => `
      <div class="error-row">
        ردیف ${row.row_number}: ${row.errors.map(escapeHtml).join("، ")}
      </div>
    `)
    .join("");

  const unrecognizedHtml = preview.columns_unrecognized?.length
    ? `<p style="font-size:12px; color:#8a6100;">ستون‌های شناسایی‌نشده (نادیده گرفته شدند): ${preview.columns_unrecognized.map(escapeHtml).join("، ")}</p>`
    : "";

  container.innerHTML = `
    <div class="preview-stats">
      <div class="preview-stat"><b>${preview.row_count}</b>تعداد کل ردیف‌ها</div>
      <div class="preview-stat" style="color:#1c7a4f;"><b>${preview.valid_row_count}</b>ردیف معتبر</div>
      <div class="preview-stat" style="color:#a23b3b;"><b>${preview.error_row_count}</b>ردیف خطادار</div>
    </div>
    ${unrecognizedHtml}
    ${errorsHtml ? `<h3 style="font-size:14px;">خطاهای ردیفی</h3>${errorsHtml}` : ""}
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("shipping");
  renderShippingSubNav("shipping-import");
  loadVersions();

  document.getElementById("refresh-versions")?.addEventListener("click", loadVersions);

  document.getElementById("preview-btn")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("csv-file");
    const file = fileInput.files?.[0];
    if (!file) {
      showToast("ابتدا یک فایل CSV انتخاب کنید.", "error");
      return;
    }

    try {
      lastCsvText = await readFileAsText(file);
      lastFilename = file.name;

      const data = await fetchAdmin("/admin/shipping-table-rates/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: lastFilename, csv_text: lastCsvText }),
      });

      renderPreview(data.preview);
      document.getElementById("commit-btn").disabled = data.preview.valid_row_count === 0;
      if (data.preview.valid_row_count === 0) {
        showToast("هیچ ردیف معتبری برای Import پیدا نشد.", "error");
      } else {
        showToast(`پیش‌نمایش آماده شد: ${data.preview.valid_row_count} ردیف معتبر.`, "success");
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.getElementById("commit-btn")?.addEventListener("click", async () => {
    if (!lastCsvText) {
      showToast("ابتدا پیش‌نمایش بگیرید.", "error");
      return;
    }
    const versionLabel = document.getElementById("version-label").value.trim();
    const source = document.getElementById("version-source").value;

    if (!confirm("ردیف‌های معتبر این فایل به Table Rateهای فعلی اضافه می‌شوند (بدون حذف تعرفه‌های قبلی). ادامه می‌دهید؟")) {
      return;
    }

    try {
      const data = await fetchAdmin("/admin/shipping-table-rates/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: lastFilename,
          csv_text: lastCsvText,
          source,
          version_label: versionLabel,
        }),
      });
      showToast(data.message, "success");
      document.getElementById("commit-btn").disabled = true;
      document.getElementById("preview-container").innerHTML = "";
      document.getElementById("csv-file").value = "";
      lastCsvText = "";
      loadVersions();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
});

async function loadVersions() {
  const container = document.getElementById("versions-container");
  container.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  try {
    const data = await fetchAdmin("/admin/shipping-tariff-versions");
    const versions = data.versions || [];
    if (versions.length === 0) {
      container.innerHTML = '<p class="loading">هنوز هیچ Import ثبت نشده است.</p>';
      return;
    }
    container.innerHTML = versions
      .map((v) => `
        <div class="version-row">
          <div>
            <strong>${escapeHtml(v.version_label)}</strong>
            <span class="${v.status === "active" ? "badge-active" : "badge-archived"}">${v.status === "active" ? "فعال" : "آرشیو"}</span>
            <br>
            <span style="color:#71817e;">
              منبع: ${escapeHtml(v.source)} | ${v.valid_row_count} معتبر از ${v.row_count} | ${new Date(v.uploaded_at).toLocaleString("fa-IR")}
            </span>
          </div>
          <div>
            ${v.status === "active" ? `<button class="secondary-button archive-version" data-id="${v.id}" type="button">آرشیو</button>` : ""}
          </div>
        </div>
      `)
      .join("");

    container.querySelectorAll(".archive-version").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("این نسخه آرشیو شود؟ (ردیف‌های Table Rate آن حذف نمی‌شوند، فقط برچسب متادیتای نسخه تغییر می‌کند)")) return;
        try {
          await fetchAdmin("/admin/shipping-tariff-versions/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: Number(btn.dataset.id) }),
          });
          showToast("آرشیو شد.", "success");
          loadVersions();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}
