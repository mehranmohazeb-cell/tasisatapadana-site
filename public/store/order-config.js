/*
  تأسیسات آپادانا — تنظیمات سفارش
  این فایل تنظیمات مشترک بین checkout.html، track-order.html و my-orders.html است.
  در صورت تغییر وضعیت‌های سفارش، حتماً STATUS_LABELS در src/index.js هم به‌روزرسانی شود.
*/

window.ORDER_CONFIG = {
  requiredAddressFields: [
    "province",
    "city",
    "street",
    "plaque",
    "postal_code"
  ],

  optionalAddressFields: [
    "sub_street",
    "alley",
    "unit",
    "address_note",
    "latitude",
    "longitude"
  ],

  postalCodeLength: 10,

  // شماره موبایل ایران: 09xxxxxxxxx
  mobilePattern: /^09\d{9}$/,

  statuses: {
    pending: "در حال بررسی",
    confirmed: "تأیید شده",
    preparing: "در حال آماده‌سازی",
    shipped: "ارسال شده",
    completed: "تکمیل شده",
    cancelled: "لغو شده"
  },

  paymentStatuses: {
    unpaid: "پرداخت‌نشده (پرداخت در محل)",
    paid: "پرداخت‌شده",
    failed: "پرداخت ناموفق",
    refunded: "بازگشت وجه"
  }
};

// تبدیل ارقام فارسی/عربی به انگلیسی، برای فیلدهایی مثل کد پستی و موبایل
window.normalizeDigits = function normalizeDigits(value) {
  return String(value ?? "").replace(/[۰-۹٠-٩]/g, function (ch) {
    const persian = "۰۱۲۳۴۵۶۷۸۹";
    const arabic = "٠١٢٣٤٥٦٧٨٩";
    let index = persian.indexOf(ch);
    if (index === -1) index = arabic.indexOf(ch);
    return index === -1 ? ch : String(index);
  });
};
