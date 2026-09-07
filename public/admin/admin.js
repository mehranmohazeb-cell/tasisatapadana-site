const API_BASE = "/api/store";

let products = [];

async function loadProducts() {
const container = document.getElementById("products-list");

container.innerHTML =
'<p class="loading">در حال بارگذاری محصولات...</p>';

try {
const response = await fetch("${API_BASE}/products");

if (!response.ok) {
  throw new Error("خطا در دریافت محصولات");
}

const data = await response.json();

products = data.products || [];

if (!Array.isArray(products) || products.length === 0) {
  container.innerHTML =
    '<p class="loading">هنوز محصولی ثبت نشده است.</p>';
  return;
}

renderProducts();

} catch (error) {
console.error(error);

container.innerHTML =
  '<p class="loading">دریافت محصولات با مشکل مواجه شد.</p>';

}
}

function renderProducts() {
const container = document.getElementById("products-list");

container.innerHTML = products.map(product => `
<div class="product-row">
<div>
<strong>${escapeHtml(product.name)}</strong>
<div>
قیمت:
${Number(product.price || 0).toLocaleString("fa-IR")}
تومان
</div>
<div>
موجودی:
${Number(product.stock || 0).toLocaleString("fa-IR")}
</div>
</div>

  <button
    type="button"
    class="secondary-button"
    onclick="editProduct('${escapeAttribute(product.id)}')"
  >
    ویرایش
  </button>
</div>

`).join("");
}

function editProduct(id) {
const product = products.find(
item => String(item.id) === String(id)
);

if (!product) return;

document.getElementById("product-id").value = product.id;
document.getElementById("name").value = product.name || "";
document.getElementById("slug").value = product.slug || "";
document.getElementById("description").value =
product.description || "";
document.getElementById("price").value =
product.price || 0;
document.getElementById("stock").value =
product.stock || 0;
document.getElementById("image").value =
product.image || "";

document.getElementById("active").checked =
product.active !== 0;

window.scrollTo({
top: 0,
behavior: "smooth"
});
}

function clearForm() {
document.getElementById("product-form").reset();
document.getElementById("product-id").value = "";
document.getElementById("active").checked = true;
}

async function createProduct(event) {
event.preventDefault();

const product = {
name: document.getElementById("name").value.trim(),
slug: document.getElementById("slug").value.trim(),
description: document.getElementById("description").value.trim(),
price: Number(document.getElementById("price").value),
stock: Number(document.getElementById("stock").value),
image: document.getElementById("image").value.trim(),
active: document.getElementById("active").checked
};

if (!product.name || !product.slug) {
alert("نام محصول و شناسه محصول الزامی است.");
return;
}

const token = prompt("رمز مدیریت را وارد کنید:");

if (!token) {
return;
}

try {
const response = await fetch("${API_BASE}/products", {
method: "POST",
headers: {
"Content-Type": "application/json",
"X-Admin-Token": token
},
body: JSON.stringify(product)
});

const data = await response.json();

if (!response.ok) {
  if (response.status === 401) {
    alert("رمز مدیریت صحیح نیست.");
  } else {
    alert(data.message || "ثبت محصول انجام نشد.");
  }
  return;
}

alert("محصول با موفقیت ثبت شد.");

clearForm();
await loadProducts();

} catch (error) {
console.error(error);
alert("ارتباط با سرور برقرار نشد.");
}
}

function escapeHtml(value) {
return String(value ?? "")
.replace(/&/g, "&")
.replace(/</g, "<")
.replace(/>/g, ">")
.replace(/"/g, """)
.replace(/'/g, "'");
}

function escapeAttribute(value) {
return String(value ?? "")
.replace(/\/g, "\\")
.replace(/'/g, "\'");
}

document.addEventListener("DOMContentLoaded", () => {
loadProducts();

document
.getElementById("refresh-products")
.addEventListener("click", loadProducts);

document
.getElementById("cancel-edit")
.addEventListener("click", clearForm);

document
.getElementById("product-form")
.addEventListener("submit", createProduct);
});
