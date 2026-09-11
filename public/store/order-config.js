/*
  تأسیسات آپادانا — تنظیمات سفارش
  این فایل برای توسعه آینده نگهداری می‌شود.
*/

window.ORDER_CONFIG = {
  requiredAddressFields: [
    "province",
    "city",
    "street",
    "sub_street",
    "alley",
    "plaque",
    "postal_code"
  ],

  optionalAddressFields: [
    "unit",
    "latitude",
    "longitude"
  ],

  postalCodeLength: 10,

  statuses: {
    review: "در حال بررسی",
    confirmed: "تأیید شده",
    preparing: "در حال آماده‌سازی",
    shipped: "ارسال شده",
    completed: "تکمیل شده"
  }
};
