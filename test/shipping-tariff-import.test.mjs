// =========================================================================
// تست کوچک و متمرکز — Import/Tariff ↔ Schema واقعی shipping_tariff_versions
//
// Schema این تست دقیقاً همان خروجی PRAGMA table_info واقعی روی D1
// Production است (نه فرض/حدس):
//   id INTEGER pk, provider_code TEXT NOT NULL, version_name TEXT NOT NULL,
//   status TEXT NOT NULL DEFAULT 'draft', source TEXT, notes TEXT,
//   raw_content TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
// (توجه: هیچ ستونی به نام version_label/filename/content_type/checksum/
// row_count/valid_row_count/error_row_count/uploaded_at/activated_at/
// created_by در Production وجود ندارد).
//
// این تست دقیقاً همان Queryهایی را اجرا می‌کند که src/index.js برای
// Import/Tariff استفاده می‌کند (کپی‌شده از همان Endpointها)، تا ثابت شود:
//   - INSERT دیگر به ستون‌های Ghost اشاره نمی‌کند و روی Schema واقعی
//     موفق است (نه فقط خالی از خطای "version_label").
//   - SELECT هم فقط از ستون‌های واقعی می‌خواند و پاسخ را دقیقاً به همان
//     شکل قبلی (version_label/row_count/valid_row_count/uploaded_at/...)
//     برای سازگاری با UI موجود بازسازی می‌کند.
//   - هیچ داده‌ای (filename/checksum/آمار ردیف‌ها) در این نگاشت گم نمی‌شود.
//
// علاوه بر این، یک محافظ Regression ساده: کد منبع را می‌خواند و مطمئن
// می‌شود که "version_label" دیگر در هیچ Query SQL این دو Endpoint به‌عنوان
// نام ستون فیزیکی ظاهر نمی‌شود.
//
// اجرا: node test/shipping-tariff-import.test.mjs
// =========================================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    }
  })();
}

// node:sqlite برمی‌گرداند {lastInsertRowid, changes}؛ برای شبیه‌سازی دقیق
// شکل واقعی D1 ({ meta: { last_row_id, changes } })، همان‌جا نگاشت می‌شود.
function toD1RunResult(sqliteResult) {
  return {
    success: true,
    meta: { last_row_id: sqliteResult.lastInsertRowid, changes: sqliteResult.changes },
  };
}

function wrapD1(sqliteDb) {
  return {
    prepare(sql) {
      return {
        bind: (...args) => ({
          first: async () => sqliteDb.prepare(sql).get(...args) ?? null,
          all: async () => ({ results: sqliteDb.prepare(sql).all(...args) }),
          run: async () => toD1RunResult(sqliteDb.prepare(sql).run(...args)),
        }),
        first: async () => sqliteDb.prepare(sql).get() ?? null,
        all: async () => ({ results: sqliteDb.prepare(sql).all() }),
        run: async () => toD1RunResult(sqliteDb.prepare(sql).run()),
      };
    },
  };
}

// دقیقاً همان Schema واقعی گزارش‌شده (PRAGMA table_info روی Production).
function makeRealTariffVersionsDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE shipping_tariff_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_code TEXT NOT NULL,
      version_name  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      source        TEXT,
      notes         TEXT,
      raw_content   TEXT,
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return wrapD1(db);
}

// همان منطق ساخت INSERT در Endpoint POST .../import/commit (کپی مستقیم).
async function insertTariffVersionLikeCommitEndpoint(env, { source, versionName, notes, csvText }) {
  return env.DB
    .prepare(
      "INSERT INTO shipping_tariff_versions " +
      "(provider_code, version_name, status, source, notes, raw_content) " +
      "VALUES (?, ?, 'active', ?, ?, ?)"
    )
    .bind(source, versionName, source, notes, csvText)
    .run();
}

// همان منطق SELECT + بازسازی شکل قبلی پاسخ در Endpoint
// GET /api/store/admin/shipping-tariff-versions (کپی مستقیم).
async function listTariffVersionsLikeEndpoint(env) {
  const result = await env.DB
    .prepare(
      "SELECT id, version_name, provider_code, source, status, notes, created_at, updated_at " +
      "FROM shipping_tariff_versions ORDER BY created_at DESC, id DESC"
    )
    .all();
  return (result.results || []).map((row) => {
    let notes = {};
    try {
      notes = row.notes ? JSON.parse(row.notes) : {};
    } catch {
      notes = {};
    }
    return {
      id: row.id,
      version_label: row.version_name,
      provider_code: row.provider_code,
      source: row.source,
      status: row.status,
      filename: notes.filename ?? null,
      content_type: notes.content_type ?? null,
      checksum: notes.checksum ?? null,
      row_count: notes.row_count ?? 0,
      valid_row_count: notes.valid_row_count ?? 0,
      error_row_count: notes.error_row_count ?? 0,
      uploaded_at: notes.uploaded_at || row.created_at,
      activated_at: null,
      created_by: null,
    };
  });
}

console.log("\n[شیپینگ] Import/Tariff ↔ Schema واقعی shipping_tariff_versions (بدون ستون version_label)\n");

await test('ایجاد نسخه جدید (Import commit) بدون خطای "no such column: version_label" موفق است', async () => {
  const env = { DB: makeRealTariffVersionsDb() };
  const notes = JSON.stringify({
    filename: "tariff-autumn.csv",
    content_type: "text/csv",
    checksum: "abc123",
    row_count: 10,
    valid_row_count: 9,
    error_row_count: 1,
    uploaded_at: "2026-09-27T00:00:00.000Z",
  });
  const result = await insertTariffVersionLikeCommitEndpoint(env, {
    source: "manual",
    versionName: "تعرفه پاییز ۱۴۰۴",
    notes,
    csvText: "method,class,cost\n1,2,50000\n",
  });
  assert.ok(result.meta?.last_row_id > 0, "انتظار درج موفق با last_row_id معتبر بود");
});

await test("Load لیست نسخه‌ها بدون خطا کار می‌کند و همان شکل قبلی پاسخ (version_label و بقیه) را برمی‌گرداند", async () => {
  const env = { DB: makeRealTariffVersionsDb() };
  await insertTariffVersionLikeCommitEndpoint(env, {
    source: "tapin",
    versionName: "نسخه ۲ - Tapin - 1404/07/01",
    notes: JSON.stringify({
      filename: "tapin-export.csv",
      content_type: "text/csv",
      checksum: "def456",
      row_count: 20,
      valid_row_count: 20,
      error_row_count: 0,
      uploaded_at: "2026-09-27T01:00:00.000Z",
    }),
    csvText: "method,class,cost\n1,2,70000\n",
  });

  const versions = await listTariffVersionsLikeEndpoint(env);
  assert.equal(versions.length, 1);
  const v = versions[0];
  assert.equal(v.version_label, "نسخه ۲ - Tapin - 1404/07/01");
  assert.equal(v.provider_code, "tapin");
  assert.equal(v.source, "tapin");
  assert.equal(v.status, "active");
  assert.equal(v.filename, "tapin-export.csv");
  assert.equal(v.checksum, "def456");
  assert.equal(v.row_count, 20);
  assert.equal(v.valid_row_count, 20);
  assert.equal(v.error_row_count, 0);
  assert.ok(v.uploaded_at, "uploaded_at باید مقداری داشته باشد");
});

await test('provider_code (NOT NULL در Production) هرگز خالی/NULL درج نمی‌شود', async () => {
  const env = { DB: makeRealTariffVersionsDb() };
  const result = await insertTariffVersionLikeCommitEndpoint(env, {
    source: "manual",
    versionName: "Import بدون منبع خاص",
    notes: "{}",
    csvText: "method,class,cost\n1,2,10000\n",
  });
  const row = await env.DB
    .prepare("SELECT provider_code FROM shipping_tariff_versions WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first();
  assert.ok(row.provider_code, "provider_code نباید خالی باشد (ستون NOT NULL در Production)");
});

await test('کد منبع (src/index.js) دیگر "version_label" را به‌عنوان ستون فیزیکی shipping_tariff_versions درخواست نمی‌کند', () => {
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  // فقط بخش‌های مربوط به دو Endpoint Import/Tariff را بررسی می‌کنیم (نه کل فایل).
  const commitStart = source.indexOf("/api/store/admin/shipping-table-rates/import/commit");
  const versionsStart = source.indexOf("/api/store/admin/shipping-tariff-versions", commitStart);
  const versionsSectionEnd = source.indexOf("/api/store/admin/shipping-tariff-versions/archive", versionsStart);
  const relevantSection = source.slice(commitStart, versionsSectionEnd > 0 ? versionsSectionEnd : undefined);

  // "version_label" هنوز مجاز است به‌عنوان نام فیلد JSON درخواست/پاسخ API
  // (سازگاری با UI، طبق دستور صریح)، اما نباید داخل هیچ رشته SQL
  // (بعد از "INSERT INTO shipping_tariff_versions" یا
  // "SELECT ... FROM shipping_tariff_versions") ظاهر شود.
  const sqlInsertMatch = relevantSection.match(/INSERT INTO shipping_tariff_versions[\s\S]*?VALUES/);
  const sqlSelectMatch = relevantSection.match(/SELECT [\s\S]*?FROM shipping_tariff_versions/);
  assert.ok(sqlInsertMatch, "INSERT INTO shipping_tariff_versions باید در کد پیدا شود");
  assert.ok(sqlSelectMatch, "SELECT ... FROM shipping_tariff_versions باید در کد پیدا شود");
  assert.doesNotMatch(sqlInsertMatch[0], /version_label/, "INSERT نباید دیگر version_label را به‌عنوان ستون داشته باشد");
  assert.doesNotMatch(sqlSelectMatch[0], /version_label/, "SELECT نباید دیگر version_label را به‌عنوان ستون داشته باشد");
  assert.match(sqlInsertMatch[0], /version_name/, "INSERT باید از ستون واقعی version_name استفاده کند");
  assert.match(sqlSelectMatch[0], /version_name/, "SELECT باید از ستون واقعی version_name استفاده کند");
});

console.log(`\n# نتیجه: ${passed} موفق، ${failed} ناموفق (از مجموع ${passed + failed})`);
if (failed > 0) process.exit(1);
