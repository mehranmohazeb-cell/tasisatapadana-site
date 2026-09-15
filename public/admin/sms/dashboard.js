// =========================
// داشبورد پیامک — /admin/sms/
// =========================

function renderStatBox(value, label) {
  return `
    <div class="stat-box">
      <div class="stat-value">${Number(value || 0).toLocaleString("fa-IR")}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `;
}

async function loadSmsSummary() {
  const statsContainer = document.getElementById("sms-stats");
  const listContainer = document.getElementById("list-container");

  try {
    const data = await fetchAdmin("/admin/sms/summary");

    statsContainer.innerHTML = [
      renderStatBox(data.today_count, "پیامک امروز"),
      renderStatBox(data.month_count, "پیامک این ماه"),
      renderStatBox(data.sent_count, "موفق"),
      renderStatBox(data.failed_count, "ناموفق"),
      renderStatBox(data.pending_count, "در انتظار"),
      renderStatBox(data.active_templates_count, "قالب‌های فعال"),
      renderStatBox(data.total_templates_count, "تعداد کل قالب‌ها"),
      renderStatBox(data.customers_with_consent_count, "مشتریان دارای رضایت تبلیغاتی"),
    ].join("");

    if (data.success_rate_percent != null) {
      statsContainer.innerHTML += renderStatBox(data.success_rate_percent + "٪", "درصد موفقیت");
    }

    if (data.most_used_template) {
      const title = data.most_used_template;
      statsContainer.innerHTML += `
        <div class="stat-box">
          <div class="stat-value" style="font-size:15px;">${escapeHtml(title)}</div>
          <div class="stat-label">پرکاربردترین قالب</div>
        </div>
      `;
    }

    const messages = data.last_messages || [];
    if (messages.length === 0) {
      listContainer.innerHTML = '<p class="loading">هنوز پیامکی ثبت نشده است.</p>';
    } else {
      listContainer.innerHTML = messages.map((m) => `
        <div class="ticket-admin-item" style="cursor:default;">
          <div class="ticket-admin-info">
            <strong>${escapeHtml(m.event_type)}</strong>
            <span>${escapeHtml(m.customer_name || "-")} — ${escapeHtml(m.mobile)}</span>
            <span>${escapeHtml(formatDate(m.created_at))}</span>
          </div>
          <span class="badge ${m.status === "sent" ? "gray" : "red"}">${escapeHtml(smsStatusLabel(m.status))}</span>
        </div>
      `).join("");
    }
  } catch (error) {
    statsContainer.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
    listContainer.innerHTML = "";
  }
}

async function loadSmsStatus() {
  const container = document.getElementById("sms-status");

  try {
    const data = await fetchAdmin("/admin/sms/status");

    container.innerHTML = [
      renderStatBox(data.secret_configured ? "متصل" : "تنظیم‌نشده", "وضعیت SMS_IR_API_KEY"),
      renderStatBox(data.active_templates_count, "قالب‌های فعال"),
      renderStatBox(data.total_templates_count, "تعداد کل قالب‌ها"),
    ].join("");

    if (data.last_sent) {
      container.innerHTML += `
        <div class="stat-box">
          <div class="stat-value" style="font-size:14px;">${escapeHtml(data.last_sent.event_type)}</div>
          <div class="stat-label">آخرین ارسال موفق — ${escapeHtml(formatDate(data.last_sent.sent_at))}</div>
        </div>
      `;
    }

    if (data.last_error) {
      container.innerHTML += `
        <div class="stat-box">
          <div class="stat-value" style="font-size:14px;color:#a23b3b;">${escapeHtml(data.last_error.event_type)}</div>
          <div class="stat-label">آخرین خطا — ${escapeHtml(formatDate(data.last_error.created_at))}</div>
        </div>
      `;
    }
  } catch (error) {
    container.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function smsStatusLabel(status) {
  const labels = { sent: "ارسال شد", failed: "ناموفق", skipped_no_template: "بدون قالب" };
  return labels[status] || status;
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage("sms");
  renderSmsSubNav("sms-dashboard");

  loadSmsSummary();
  loadSmsStatus();

  document.getElementById("refresh-summary")?.addEventListener("click", () => {
    loadSmsSummary();
    loadSmsStatus();
  });
});
