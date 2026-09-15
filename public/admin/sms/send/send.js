// =========================
// ارسال دستی پیامک — /admin/sms/send/
// =========================

let templatesCache = [];

async function loadTemplatesIntoSelect() {
  const select = document.getElementById("send-template");

  try {
    const data = await fetchAdmin("/admin/sms/templates");
    templatesCache = (data.templates || []).filter((t) => t.allow_manual_send);

    if (templatesCache.length === 0) {
      select.innerHTML = '<option value="">هیچ قالبی برای ارسال دستی موجود نیست.</option>';
      return;
    }

    select.innerHTML = '<option value="">— انتخاب قالب —</option>' + templatesCache.map((t) => `
      <option value="${escapeHtml(t.event_type)}" ${!t.enabled ? "disabled" : ""}>
        ${escapeHtml(t.title)} (${escapeHtml(t.category_label)})${!t.enabled ? " — غیرفعال" : ""}
      </option>
    `).join("");
  } catch (error) {
    select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
  }
}

function renderVariableFields(eventType) {
  const container = document.getElementById("send-variables-fields");
  const wrapper = document.getElementById("send-variables-container");
  const template = templatesCache.find((t) => t.event_type === eventType);

  document.getElementById("send-preview-container").style.display = "none";

  if (!template || !template.variables || template.variables.length === 0) {
    wrapper.style.display = "none";
    container.innerHTML = "";
    return;
  }

  wrapper.style.display = "block";
  container.innerHTML = template.variables.map((name) => `
    <div style="margin-bottom:10px;">
      <label style="font-size:13px; font-weight:700; color:#244848; display:block; margin-bottom:5px;">${escapeHtml(name)}</label>
      <input data-variable="${escapeHtml(name)}" type="text" style="width:100%; border:1px solid #cbd6d3; border-radius:8px; padding:9px 11px;">
    </div>
  `).join("");
}

function collectVariables() {
  const variables = {};
  document.querySelectorAll("[data-variable]").forEach((input) => {
    variables[input.dataset.variable] = input.value.trim();
  });
  return variables;
}

function buildPreviewText(template, variables) {
  // پیش‌نمایش تقریبی؛ متن دقیق قالب در پنل SMS.ir است، اما این خلاصه به مدیر
  // نشان می‌دهد چه مقادیری برای کدام متغیر ارسال خواهد شد.
  const lines = [`قالب: ${template.title}`, `شماره: ${document.getElementById("send-mobile").value.trim()}`];
  for (const name of template.variables || []) {
    lines.push(`${name} = ${variables[name] || "(خالی)"}`);
  }
  return lines.join("\n");
}

function handlePreview() {
  const eventType = document.getElementById("send-template").value;
  const template = templatesCache.find((t) => t.event_type === eventType);

  if (!template) {
    showToast("ابتدا یک قالب انتخاب کنید.", "error");
    return;
  }

  const variables = collectVariables();
  const previewContainer = document.getElementById("send-preview-container");
  const previewText = document.getElementById("send-preview-text");

  previewText.textContent = buildPreviewText(template, variables);
  previewContainer.style.display = "block";
}

async function submitSend(event) {
  event.preventDefault();

  const mobile = document.getElementById("send-mobile").value.trim();
  const eventType = document.getElementById("send-template").value;
  const variables = collectVariables();

  if (!eventType) {
    showToast("یک قالب انتخاب کنید.", "error");
    return;
  }

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showToast("در حال ارسال...", "info", 1500);

  try {
    await fetchAdmin("/admin/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, event_type: eventType, variables }),
    });

    showToast("پیامک با موفقیت ارسال شد.", "success");
    document.getElementById("send-form").reset();
    document.getElementById("send-variables-container").style.display = "none";
    document.getElementById("send-preview-container").style.display = "none";
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-send");

  loadTemplatesIntoSelect();

  document.getElementById("send-template")?.addEventListener("change", (event) => {
    renderVariableFields(event.target.value);
  });

  document.getElementById("preview-button")?.addEventListener("click", handlePreview);
  document.getElementById("send-form")?.addEventListener("submit", submitSend);
});
