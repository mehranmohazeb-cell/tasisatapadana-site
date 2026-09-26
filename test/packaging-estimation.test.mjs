// =========================================================================
// تست‌های واقعی سیستم تخمین بسته‌بندی — node:sqlite برای اجرای واقعی
// Migration، و تست مستقیم توابع خالص src/packaging-estimation.js.
// این فایل بخشی از دیپلوی نیست؛ فقط برای اجرای محلی تست است.
//   node test/packaging-estimation.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateProductPackage,
  computeVolumetricWeightGrams,
  computeChargeableWeightGrams,
  buildShipmentPackages,
  chargeableWeightForDivisor,
  resolveEffectiveProfile,
  BUILTIN_FALLBACK_PROFILE,
  DEFAULT_VOLUMETRIC_DIVISOR,
} from "../src/packaging-estimation.js";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

// =========================================================================
// بخش ۱ — اجرای واقعی Migration روی یک نسخه synthetic از جداول موجود
// (دقیقاً همان ستون‌هایی که Migrationهای قبلی پروژه واقعی ایجاد کرده‌اند،
// تا مطمئن شویم packaging-estimation.sql روی معماری واقعی بدون خطا اعمال می‌شود).
// =========================================================================
console.log("\n[۱] اجرای واقعی Migration روی schema synthetic معادل پروژه واقعی");

const db = new DatabaseSync(":memory:");

db.exec(`
  CREATE TABLE shipping_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, updated_at TEXT
  );

  CREATE TABLE shipping_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL DEFAULT 0,
    cost_type TEXT NOT NULL DEFAULT 'prepaid',
    active INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'all',
    allowed_city TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, updated_at TEXT
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT,
    shipping_class_id INTEGER,
    weight_grams INTEGER,
    length_cm REAL, width_cm REAL, height_cm REAL,
    shipping_cost INTEGER, shipping_method TEXT, shipping_time TEXT
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_code TEXT,
    shipping_cost INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0
  );
`);

const migrationSql = readFileSync(new URL("../database/packaging-estimation.sql", import.meta.url), "utf8");

test("Migration بدون خطا روی schema واقعی اجرا می‌شود", () => {
  db.exec(migrationSql);
});

test("۵ Packaging Profile نمونه Seed شده‌اند", () => {
  const rows = db.prepare("SELECT code FROM packaging_profiles ORDER BY id").all();
  const codes = rows.map((r) => r.code);
  assert.deepEqual(codes, ["GENERIC", "SMALL_PART", "FACTORY_PACKAGED", "BULKY", "FRAGILE"]);
});

test("دقیقاً یک Profile پیش‌فرض سیستم (is_default=1) وجود دارد", () => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM packaging_profiles WHERE is_default = 1").get();
  assert.equal(row.c, 1);
});

test("ستون‌های جدید products/shipping_classes/shipping_methods/orders ایجاد شده‌اند", () => {
  const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  for (const col of [
    "packaging_profile_id", "package_length_cm", "package_width_cm",
    "package_height_cm", "package_weight_grams", "packaging_confidence",
  ]) {
    assert.ok(productCols.includes(col), `products.${col} باید وجود داشته باشد`);
  }

  const classCols = db.prepare("PRAGMA table_info(shipping_classes)").all().map((c) => c.name);
  assert.ok(classCols.includes("default_packaging_profile_id"));

  const methodCols = db.prepare("PRAGMA table_info(shipping_methods)").all().map((c) => c.name);
  assert.ok(methodCols.includes("volumetric_divisor"));

  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  for (const col of ["actual_shipping_cost", "shipping_cost_variance", "shipping_cost_recorded_at"]) {
    assert.ok(orderCols.includes(col), `orders.${col} باید وجود داشته باشد`);
  }
});

test("اجرای دوباره Migration (Idempotent برای بخش‌های INSERT OR IGNORE) روی جدول Profile خطا نمی‌دهد", () => {
  // ALTER TABLE های تکراری خطا می‌دهند (رفتار طبیعی SQLite)، بنابراین این
  // تست فقط بخش ایمن (INSERT OR IGNORE) را دوباره اجرا می‌کند.
  db.exec(`
    INSERT OR IGNORE INTO packaging_profiles (code, name) VALUES ('GENERIC', 'تکراری - نباید اضافه شود');
  `);
  const row = db.prepare("SELECT COUNT(*) AS c FROM packaging_profiles WHERE code = 'GENERIC'").get();
  assert.equal(row.c, 1);
});

// =========================================================================
// بخش ۲ — سناریوهای بخش ۲۸ دستور توسعه، روی توابع خالص estimation.
// =========================================================================
console.log("\n[۲] سناریوهای بخش ۲۸ دستور — تست توابع خالص محاسباتی");

const genericProfile = db.prepare("SELECT * FROM packaging_profiles WHERE code = 'GENERIC'").get();
const smallPartProfile = db.prepare("SELECT * FROM packaging_profiles WHERE code = 'SMALL_PART'").get();
const factoryProfile = db.prepare("SELECT * FROM packaging_profiles WHERE code = 'FACTORY_PACKAGED'").get();
const bulkyProfile = db.prepare("SELECT * FROM packaging_profiles WHERE code = 'BULKY'").get();
const fragileProfile = db.prepare("SELECT * FROM packaging_profiles WHERE code = 'FRAGILE'").get();

// ۱. پکیج سنگین و بزرگ (FACTORY_PACKAGED)
test("۱) پکیج سنگین/بزرگ: تخمین = ابعاد واقعی + تلرانس (نه یک عدد ثابت)", () => {
  const product = { weight_grams: 32000, length_cm: 60, width_cm: 40, height_cm: 70 };
  const est = estimateProductPackage(product, factoryProfile);
  assert.equal(est.source, "ESTIMATED");
  assert.equal(est.lengthCm, 60 + factoryProfile.length_tolerance_cm);
  assert.ok(est.weightGrams > 32000);
});

// ۲. آبگرمکن (FACTORY_PACKAGED، مقدار کوچک‌تر)
test("۲) آبگرمکن: تخمین منطقی و بدون گزاف‌گویی", () => {
  const product = { weight_grams: 12000, length_cm: 40, width_cm: 40, height_cm: 55 };
  const est = estimateProductPackage(product, factoryProfile);
  assert.ok(est.weightGrams < 14000, "وزن تخمینی نباید غیرمنطقی گزاف باشد");
});

// ۳. رادیاتور (BULKY، ارسال جداگانه)
test("۳) رادیاتور (BULKY): require_separate_shipment فعال است", () => {
  assert.equal(Number(bulkyProfile.require_separate_shipment), 1);
});

// ۴. شیرآلات کوچک (SMALL_PART) بدون بسته‌بندی کارخانه‌ای
test("۴) شیرآلات کوچک: از حداقل ابعاد سرویس حمل استفاده می‌شود، نه +۱۰cm ثابت", () => {
  const product = { weight_grams: 350, length_cm: 8, width_cm: 5, height_cm: 4 };
  const est = estimateProductPackage(product, smallPartProfile);
  // چون ابعاد واقعی+تلرانس کوچک‌تر از حداقل بسته سرویس حمل است، حداقل اعمال می‌شود
  assert.equal(est.lengthCm, smallPartProfile.min_package_length_cm);
  assert.notEqual(smallPartProfile.length_tolerance_cm, 10, "نباید از تلرانس ثابت +۱۰ استفاده شود");
});

// ۵. شلنگ (SMALL_PART، کالای کشیده)
test("۵) شلنگ: طول واقعی بزرگ‌تر از حداقل، حداقل اعمال نمی‌شود", () => {
  const product = { weight_grams: 900, length_cm: 25, width_cm: 15, height_cm: 10 };
  const est = estimateProductPackage(product, smallPartProfile);
  assert.equal(est.lengthCm, 25 + smallPartProfile.length_tolerance_cm);
});

// ۶. قطعه کوچک بدون بسته‌بندی و بدون تلرانس ثابت سراسری
test("۶) قطعه کوچک: پروفایل‌های متفاوت، تلرانس‌های متفاوت (نه یک عدد سراسری)", () => {
  const product = { weight_grams: 500, length_cm: 10, width_cm: 10, height_cm: 10 };
  const smallEst = estimateProductPackage(product, smallPartProfile);
  const bulkyEst = estimateProductPackage(product, bulkyProfile);
  assert.notEqual(smallEst.lengthCm, bulkyEst.lengthCm);
});

// ۷. محصول بدون ابعاد
test("۷) محصول بدون ابعاد: هرگز صفر، به CONSERVATIVE سقوط می‌کند", () => {
  const product = { weight_grams: 4000 };
  const est = estimateProductPackage(product, factoryProfile);
  assert.equal(est.source, "CONSERVATIVE");
  assert.equal(est.incomplete, true);
  assert.ok(est.lengthCm > 0 && est.widthCm > 0 && est.heightCm > 0);
});

// ۸. محصول بدون وزن
test("۸) محصول بدون وزن: هرگز صفر، حداقل وزن Profile اعمال می‌شود", () => {
  const product = { length_cm: 20, width_cm: 20, height_cm: 20 };
  const est = estimateProductPackage(product, smallPartProfile);
  assert.equal(est.source, "CONSERVATIVE");
  assert.ok(est.weightGrams >= smallPartProfile.min_shipping_weight_grams);
  assert.notEqual(est.weightGrams, 0);
});

// ۹. چند قطعه کوچک در یک سفارش — باید در یک بسته مشترک تجمیع شوند
test("۹) چند قطعه کوچک (SMALL_PART, ترکیب‌پذیر): یک بسته 'combined'، نه چند بسته جدا", () => {
  const items = [
    { productId: 1, quantity: 1, product: { weight_grams: 300, length_cm: 8, width_cm: 5, height_cm: 4 }, profile: smallPartProfile },
    { productId: 2, quantity: 2, product: { weight_grams: 900, length_cm: 25, width_cm: 15, height_cm: 10 }, profile: smallPartProfile },
    { productId: 3, quantity: 1, product: { weight_grams: 150, length_cm: 6, width_cm: 6, height_cm: 6 }, profile: smallPartProfile },
  ];
  const { packages } = buildShipmentPackages(items);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].kind, "combined");
  assert.deepEqual(packages[0].productIds.sort(), [1, 2, 3]);
});

// ۱۰. محصول بزرگ + قطعات کوچک — باید جدا از هم بسته‌بندی شوند
test("۱۰) محصول بزرگ (BULKY) + قطعات کوچک: دو بسته جدا، نه یک بسته ترکیبی", () => {
  const items = [
    { productId: 10, quantity: 1, product: { weight_grams: 35000, length_cm: 55, width_cm: 40, height_cm: 65 }, profile: bulkyProfile },
    { productId: 11, quantity: 1, product: { weight_grams: 300, length_cm: 8, width_cm: 5, height_cm: 4 }, profile: smallPartProfile },
  ];
  const { packages } = buildShipmentPackages(items);
  assert.equal(packages.length, 2);
  const kinds = packages.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["combined", "separate"]);
});

// ۱۱. محصولی با Override (بخش ۱۲ دستور)
test("۱۱) محصول با Override واقعی: تخمین نادیده گرفته می‌شود، مقدار واقعی استفاده می‌شود", () => {
  const product = {
    weight_grams: 5000, length_cm: 30, width_cm: 20, height_cm: 15, // این‌ها باید نادیده گرفته شوند
    package_length_cm: 33, package_width_cm: 23, package_height_cm: 18, package_weight_grams: 5400,
  };
  const est = estimateProductPackage(product, factoryProfile);
  assert.equal(est.source, "REAL");
  assert.equal(est.lengthCm, 33);
  assert.equal(est.weightGrams, 5400);
});

// ۱۲. وزن حجمی بیشتر از وزن واقعی
test("۱۲) وزن حجمی > وزن واقعی: Chargeable Weight = وزن حجمی", () => {
  const volumetric = computeVolumetricWeightGrams(60, 60, 60, 5000); // حجم بزرگ، وزن سبک
  const chargeable = computeChargeableWeightGrams(2000, volumetric);
  assert.equal(chargeable, volumetric);
  assert.ok(volumetric > 2000);
});

// ۱۳. وزن واقعی بیشتر از وزن حجمی
test("۱۳) وزن واقعی > وزن حجمی: Chargeable Weight = وزن واقعی", () => {
  const volumetric = computeVolumetricWeightGrams(20, 15, 10, 5000); // حجم کوچک
  const chargeable = computeChargeableWeightGrams(9000, volumetric); // فلزی سنگین
  assert.equal(chargeable, 9000);
  assert.ok(volumetric < 9000);
});

// ۱۴. کالای دارای ارسال جداگانه
test("۱۴) کالای require_separate_shipment: حتی اگر allow_combine=1 باشد، جدا می‌ماند", () => {
  const forcedSeparateProfile = { ...smallPartProfile, allow_combine_with_other_items: 1, require_separate_shipment: 1 };
  const items = [
    { productId: 1, quantity: 1, product: { weight_grams: 300, length_cm: 8, width_cm: 5, height_cm: 4 }, profile: forcedSeparateProfile },
    { productId: 2, quantity: 1, product: { weight_grams: 300, length_cm: 8, width_cm: 5, height_cm: 4 }, profile: smallPartProfile },
  ];
  const { packages } = buildShipmentPackages(items);
  assert.equal(packages.length, 2);
});

// ۱۴-الف. ارسال جداگانه برای quantity>1 — هر واحد باید بسته مستقل داشته باشد.
test("۱۴-الف) require_separate_shipment با تعداد ۳: سه بسته مستقل", () => {
  const forcedSeparateProfile = { ...smallPartProfile, allow_combine_with_other_items: 1, require_separate_shipment: 1 };
  const product = { weight_grams: 1000, length_cm: 20, width_cm: 10, height_cm: 10 };
  const estimate = estimateProductPackage(product, forcedSeparateProfile);
  const { packages } = buildShipmentPackages([
    { productId: 7, quantity: 3, product, profile: forcedSeparateProfile },
  ]);
  assert.equal(packages.length, 3);
  for (const pkg of packages) {
    assert.equal(pkg.productIds[0], 7);
    assert.equal(pkg.weightGrams, estimate.weightGrams);
    assert.equal(pkg.volumeCm3, estimate.lengthCm * estimate.widthCm * estimate.heightCm);
    assert.equal(pkg.separateShipment, true);
  }
});

// ۱۵. Shipping Class بدون Packaging Profile اختصاصی — به Profile عمومی سقوط می‌کند
test("۱۵) بدون Profile اختصاصی: resolveEffectiveProfile به Profile پیش‌فرض سیستم سقوط می‌کند", () => {
  const profilesById = new Map(
    [genericProfile, smallPartProfile, factoryProfile, bulkyProfile, fragileProfile].map((p) => [p.id, p])
  );
  const product = { packaging_profile_id: null };
  const resolved = resolveEffectiveProfile(product, profilesById, null);
  assert.equal(resolved.code, "GENERIC");
});

// ۱۶. داده‌های غیرعادی (وزن منفی/رشته نامعتبر) — نباید کرش کند یا صفر برگرداند
test("۱۶) داده‌های غیرعادی (وزن منفی، ابعاد رشته‌ای نامعتبر): بدون کرش، بدون صفر", () => {
  const product = { weight_grams: -500, length_cm: "abc", width_cm: 0, height_cm: null };
  const est = estimateProductPackage(product, factoryProfile);
  assert.equal(est.incomplete, true);
  assert.ok(est.weightGrams > 0);
  assert.ok(est.lengthCm > 0);
});

// ضریب وزن حجمی وابسته به روش ارسال (بخش ۹) — یک عدد عمومی سراسری نیست
test("۱۷) ضریب وزن حجمی متفاوت بین دو روش ارسال، نتیجه متفاوت می‌دهد", () => {
  const items = [
    { productId: 1, quantity: 1, product: { weight_grams: 1000, length_cm: 50, width_cm: 50, height_cm: 50 }, profile: factoryProfile },
  ];
  const { packages } = buildShipmentPackages(items);
  const weightWithDivisorA = chargeableWeightForDivisor(packages, 4000); // پست (فرضی)
  const weightWithDivisorB = chargeableWeightForDivisor(packages, 8000); // باربری (فرضی)
  assert.notEqual(weightWithDivisorA, weightWithDivisorB);
  assert.ok(weightWithDivisorA > weightWithDivisorB, "ضریب کوچک‌تر = وزن حجمی بزرگ‌تر");
});

// ۱۸. مسیر فعلی checkout/shipping-methods — پوشش‌داده‌شده به‌صورت غیرمستقیم:
// چون resolveShippingOptionsForCart از buildCartShipmentPackages به‌صورت
// Fail-Safe fallback می‌کند (اگر جدول‌ها نباشند)، رفتار قدیمی حفظ می‌شود؛
// این ادعا به‌صورت مستقیم در src/index.js با try/catch اطراف فراخوانی
// buildCartShipmentPackages و try/catch اطراف SELECT ستون‌های جدید تضمین
// شده (قابل مشاهده در دیف کد، تست end-to-end با Wrangler نیازمند محیط
// واقعی Cloudflare است که در این Sandbox در دسترس نیست).
test("۱۸) Fallback: Profile داده‌نشده => BUILTIN_FALLBACK_PROFILE استفاده می‌شود و صفر برنمی‌گرداند", () => {
  const product = { weight_grams: 1000, length_cm: 20, width_cm: 20, height_cm: 20 };
  const est = estimateProductPackage(product, null);
  assert.equal(est.source, "ESTIMATED");
  assert.ok(est.weightGrams > 0);
  assert.equal(BUILTIN_FALLBACK_PROFILE.code, "BUILTIN_FALLBACK");
});

test("پیش‌فرض ضریب وزن حجمی سیستم مستند و مثبت است", () => {
  assert.ok(DEFAULT_VOLUMETRIC_DIVISOR > 0);
});

// =========================================================================
console.log(`\nنتیجه: ${passed} موفق، ${failed} ناموفق (از مجموع ${passed + failed})`);
if (failed > 0) process.exit(1);
