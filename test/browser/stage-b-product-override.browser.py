#!/usr/bin/env python3
"""
تست مرورگر واقعی (Chromium + Playwright) برای Stage B — Route Override در فرم محصول.
Worker واقعی + D1 آزمایشی (node:sqlite) پشت سرور آزمایشی؛ UI واقعی public/admin.
فقط لیست محصولات (GET /api/store/products)، ذخیرهٔ خود محصول (POST/PUT همان مسیر) و دستهٔ‌بندی‌ها شبیه‌سازی می‌شوند.
اجرا:  python3 test/browser/stage-b-product-override.browser.py [پوشهٔ اسکرین‌شات]
نیازمند: playwright (pip) + Chromium.
"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
if SHOTS: os.makedirs(SHOTS, exist_ok=True)

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  ✓ {name}")
    else: failed += 1; print(f"  ✗ {name} {extra}")

def sql(q):
    return json.load(urllib.request.urlopen(f"{BASE}/__test/sql?q=" + urllib.parse.quote(q)))
def execsql(q):
    urllib.request.urlopen(f"{BASE}/__test/exec?q=" + urllib.parse.quote(q)).read()

srv = subprocess.Popen(["node", "--no-warnings", os.path.join(ROOT, "test/browser/stage-b-server.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
line = srv.stdout.readline()
assert "READY" in line, line

PRODUCTS = None
def product_rows():
    rows = sql("SELECT id,name,weight_grams,length_cm,width_cm,height_cm,shipping_class_id,packaging_profile_id,package_length_cm,package_width_cm,package_height_cm,package_weight_grams,shipping_cost,shipping_method,shipping_time FROM products ORDER BY id")
    out = []
    for r in rows:
        out.append({**r, "slug": f"p{r['id']}", "brand": "", "model": "", "sku": f"SKU{r['id']}", "category_id": None, "description": "<p>x</p>",
                    "price": 1000, "compare_price": None, "stock": 5, "active": 1, "image": "", "images": [], "specs": [], "gallery": []})
    return out

def run():
    global PRODUCTS
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 1400}, locale="fa-IR")
        ctx.add_init_script("sessionStorage.setItem('apadana_admin_token','adm')")
        page = ctx.new_page()
        page_errors, requests = [], []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("request", lambda r: requests.append((r.method, r.url, r.post_data)))
        main_saves = []

        def products_route(route):
            req = route.request
            if req.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "products": product_rows(), "page": 1, "total": 6, "total_pages": 1, "limit": 20}))
            else:
                main_saves.append((req.method, req.post_data))
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "message": "ok"}))
        page.route(lambda u: u.split("?")[0].endswith("/api/store/products"), products_route)
        page.route(lambda u: u.split("?")[0].endswith("/api/store/admin/categories"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "categories": []})))

        page.goto(f"{BASE}/admin/products/")
        page.wait_for_selector("#product-form", state="attached")
        page.wait_for_function("typeof editProduct === 'function'")
        page.evaluate("loadProducts(1)")
        page.wait_for_function("typeof productsCache !== 'undefined' && productsCache.length >= 6")

        def open_product(pid):
            page.evaluate(f"editProduct({pid})")
            page.wait_for_selector("#product-route-override", timeout=8000)

        def summary_text():
            return page.inner_text("#shipping-summary-body")
        def sel_value(): return page.eval_on_selector("#product-route-override", "e => e.value")
        def db_override(pid): return sql(f"SELECT shipping_route_override v, typeof(shipping_route_override) t FROM products WHERE id={pid}")[0]
        def shot(name):
            if SHOTS:
                page.locator("#shipping-summary-box").scroll_into_view_if_needed()
                page.locator("#shipping-summary-box").screenshot(path=os.path.join(SHOTS, name))

        print("— نمایش و جایگاه کنترل —")
        open_product(1)
        box = page.locator("#shipping-summary-box")
        txt = summary_text()
        check("کنترل Override داخل بلوک «خلاصهٔ حمل» قرار دارد", box.locator("#product-route-override").count() == 1)
        check("عنوان بلوک فارسی و روشن است", "خلاصهٔ حمل و Override مسیر این محصول" in box.inner_text())
        order = [txt.find(s) for s in ["۱) ماهیت و سیاست حمل", "۲) استثنای مدیریتی", "۳) مشخصات فیزیکی", "۴) برآورد بسته‌بندی", "۵) نتیجهٔ Routing"]]
        check("پنج گروه جدا و به ترتیب (کلاس / Override / فیزیکی / بسته‌بندی / نتیجه)", all(o >= 0 for o in order) and order == sorted(order), str(order))
        check("چهار مفهوم جدا: Shipping Class، Route Policy کلاس، Override، مسیر مؤثر", all(s in txt for s in ["Shipping Class", "Route Policy کلاس", "مسیر مؤثر خارج از اصفهان", "دلیل مسیر"]))
        opts = page.eval_on_selector_all("#product-route-override option", "els => els.map(e => [e.value, e.textContent.trim()])")
        check("سه حالت: پیش‌فرض کلاس / عادی / باربری", [o[0] for o in opts] == ["", "normal", "freight"], str(opts))
        check("برچسب‌ها فارسی و گزینهٔ پیش‌فرض نتیجهٔ Policy کلاس را نشان می‌دهد", opts[0][1] == "پیش‌فرض کلاس (عادی)" and opts[1][1] == "عادی" and opts[2][1].startswith("باربری"), str(opts))
        check("NULL در D1 ← گزینهٔ «پیش‌فرض کلاس» انتخاب است", sel_value() == "" and db_override(1)["t"] == "null")
        check("اجزا: دکمهٔ ذخیره غیرفعال و پیام «ذخیره نشده» پنهان", page.is_disabled("#save-route-override") and not page.is_visible("#route-override-unsaved"))
        check("جهت RTL", page.eval_on_selector("#shipping-summary-box", "e => getComputedStyle(e).direction") == "rtl")
        check("مسیر مؤثر از Server: عادی؛ دلیل: Shipping Class محصول", "عادی" in txt and "Shipping Class محصول: عادی" in txt)
        shot("01-null-default.png")

        print("— Unsaved —")
        weight_db_before = sql("SELECT * FROM products WHERE id=1")[0]
        page.select_option("#product-route-override", "freight")
        check("پس از تغییر: پیام «ذخیره نشده» نمایش داده می‌شود و دکمه فعال", page.is_visible("#route-override-unsaved") and page.is_enabled("#save-route-override"))
        txt = summary_text()
        check("بدون Save مسیر مؤثر همچنان مقدار ذخیره‌شدهٔ Server (عادی) است، نه حدس مرورگر", "مسیر مؤثر خارج از اصفهان" in txt and "باربری (پس‌کرایه)" not in page.inner_text("#shipping-summary-body").split("۵) نتیجهٔ Routing")[1].split("هشدارهای")[0])
        check("بدون Save چیزی در D1 تغییر نکرده", db_override(1)["v"] is None and not any(m == "PUT" and "shipping-routing/product" in u for m, u, _ in requests))
        shot("02-unsaved.png")
        page.select_option("#product-route-override", "")
        check("بازگشت به مقدار ذخیره‌شده، وضعیت Unsaved را پاک می‌کند", not page.is_visible("#route-override-unsaved") and page.is_disabled("#save-route-override"))
        page.select_option("#product-route-override", "freight")

        print("— ذخیرهٔ موفق —")
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Override مدیریتی محصول: باربری')")
        puts = [(m, u, d) for m, u, d in requests if m == "PUT" and u.endswith("/api/store/admin/shipping-routing/product")]
        check("از همان Endpoint موجود با بدنهٔ درست ذخیره شد", len(puts) == 1 and json.loads(puts[0][2]) == {"product_id": 1, "override": "freight"}, str(puts))
        check("هیچ درخواستی به Endpoint ذخیرهٔ محصول نرفت (فقط Override)", len(main_saves) == 0)
        check("D1: freight", db_override(1)["v"] == "freight")
        txt = summary_text()
        check("Summary از Server بازخوانی شد: مسیر مؤثر باربری + دلیل Override", "باربری (پس‌کرایه)" in txt and "Override مدیریتی محصول: باربری" in txt)
        check("Route Policy کلاس همچنان «عادی» و کلاس همان (جدا از Override)", "پکیج و آبگرمکن" in txt and sql("SELECT route_policy FROM shipping_classes WHERE id=2")[0]["route_policy"] == "normal")
        check("Unsaved پاک و گزینهٔ انتخاب‌شده freight", sel_value() == "freight" and not page.is_visible("#route-override-unsaved") and page.is_disabled("#save-route-override"))
        check("داخل اصفهان همچنان پیک رایگان (از منطق Routing)", "پیک موتوری رایگان" in txt)
        row_after = sql("SELECT * FROM products WHERE id=1")[0]
        row_after.pop("shipping_route_override"); w = dict(weight_db_before); w.pop("shipping_route_override")
        check("هیچ ستون دیگر محصول (کلاس، Packaging، وزن/ابعاد، shipping_cost/method/time) تغییر نکرد", row_after == w)
        audit = sql("SELECT old_value,new_value FROM shipping_route_audit WHERE entity_type='product' AND entity_id=1")
        check("Audit: NULL → freight", audit == [{"old_value": None, "new_value": "freight"}], str(audit))
        shot("03-saved-freight.png")

        print("— برگشت به «پیش‌فرض کلاس» (NULL) —")
        page.select_option("#product-route-override", "")
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Shipping Class محصول: عادی')")
        check("D1: واقعاً NULL (نه رشتهٔ خالی)", db_override(1) == {"v": None, "t": "null"})
        check("انتخاب پس از بازخوانی: پیش‌فرض کلاس", sel_value() == "")

        print("— محصول دارای Override و کلاس باربری —")
        open_product(2)
        opts = page.eval_on_selector_all("#product-route-override option", "els => els.map(e => e.textContent.trim())")
        txt = summary_text()
        check("Override ذخیره‌شده (عادی) در کنترل نمایش داده می‌شود", sel_value() == "normal")
        check("گزینهٔ پیش‌فرض کلاس، Policy واقعی کلاس (باربری) را نشان می‌دهد", opts[0] == "پیش‌فرض کلاس (باربری (پس‌کرایه))", str(opts))
        check("مسیر مؤثر عادی با وجود Policy کلاس باربری (Override اولویت دارد) و دلیل Override", "Override مدیریتی محصول: عادی" in txt)
        shot("04-override-vs-class.png")

        print("— مقدار نامعتبر D1 —")
        execsql("UPDATE products SET shipping_route_override='fragile' WHERE id=3")
        open_product(3)
        check("مقدار نامعتبر قابل تشخیص است (گزینه + هشدار قرمز)", sel_value() == "__invalid__" and page.is_visible("#route-override-invalid") and "fragile" in page.inner_text("#product-route-override"))
        check("دکمهٔ ذخیره غیرفعال؛ و D1 بی‌صدا اصلاح نشد", page.is_disabled("#save-route-override") and db_override(3)["v"] == "fragile")
        shot("05-invalid.png")
        page.select_option("#product-route-override", "normal")
        page.click("#save-route-override")
        page.wait_for_function("!document.querySelector('#route-override-invalid') || document.querySelector('#route-override-invalid').style.display==='none'")
        check("اصلاح فقط با اقدام صریح مدیر (انتخاب معتبر + ذخیره)", db_override(3)["v"] == "normal")

        print("— شکست ذخیره —")
        open_product(4)
        def fail_route(route):
            route.fulfill(status=500, content_type="application/json", body=json.dumps({"ok": False, "error": "X", "message": "خطای آزمایشی سرور"}))
        page.route("**/api/store/admin/shipping-routing/product", fail_route)
        page.select_option("#product-route-override", "freight")
        page.click("#save-route-override")
        page.wait_for_selector("#route-override-error", state="visible", timeout=5000)
        err = page.inner_text("#route-override-error")
        check("خطا واضح نمایش داده می‌شود", "ذخیرهٔ Override انجام نشد" in err and "خطای آزمایشی سرور" in err, err)
        check("وضعیت Unsaved و مقدار انتخاب‌شده حفظ می‌شود", page.is_visible("#route-override-unsaved") and sel_value() == "freight" and page.is_enabled("#save-route-override"))
        txt = summary_text().split("۵) نتیجهٔ Routing")[1].split("هشدارهای")[0]
        check("هیچ موفقیت فرضی: مسیر مؤثر همان مقدار قبلی Server (عادی) و D1 بدون تغییر", "باربری (پس‌کرایه)" not in txt and db_override(4)["v"] is None)
        shot("06-save-failed.png")
        page.unroute("**/api/store/admin/shipping-routing/product", fail_route)
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Override مدیریتی محصول: باربری')")
        check("تلاش مجدد پس از رفع خطا موفق می‌شود", db_override(4)["v"] == "freight")

        print("— تعامل با «ذخیرهٔ محصول» —")
        open_product(5)
        page.select_option("#product-route-override", "freight")
        dialogs = []
        def on_dialog(d): dialogs.append(d.message); d.dismiss()
        page.once("dialog", on_dialog)
        page.evaluate("document.getElementById('product-form').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_timeout(400)
        check("با Override ذخیره‌نشده، هشدار تأیید نمایش داده می‌شود", len(dialogs) == 1 and "ذخیره نشده" in dialogs[0])
        check("با رد تأیید، ذخیرهٔ محصول انجام نمی‌شود و Override در D1 تغییر نکرد", len(main_saves) == 0 and db_override(5)["v"] is None)
        page.once("dialog", lambda d: d.accept())
        page.evaluate("document.getElementById('product-form').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_timeout(600)
        check("با تأیید، فقط ذخیرهٔ محصول انجام می‌شود و Override در D1 بی‌صدا ذخیره نمی‌شود", len(main_saves) == 1 and db_override(5)["v"] is None)

        print("— سازگاری با Stage A و صفحهٔ Routing —")
        open_product(6)
        page.fill("#product-weight", "123")
        check("پیام «تغییرات این فرم هنوز ذخیره نشده» Stage A همچنان کار می‌کند", page.is_visible("#shipping-summary-stale"))
        # Stage C: سه فیلد قدیمی عمداً از فرم حذف شدند (در Stage B هنوز وجود داشتند). جزئیات: stage-c-legacy-fields.browser.py
        check("(Stage C) سه فیلد قدیمی ارسال دیگر در فرم نیستند", all(page.locator(s).count() == 0 for s in ["#product-shipping-cost", "#product-shipping-method", "#product-shipping-time"]))
        page.evaluate("clearForm()")
        check("پاک‌کردن فرم، وضعیت Override را ریست می‌کند", page.evaluate("routeOverrideState") is None and page.locator("#product-route-override").count() == 0)

        page2 = ctx.new_page(); page2.on("pageerror", lambda e: page_errors.append(str(e)))
        page2.goto(f"{BASE}/admin/shipping/routing/")
        page2.wait_for_selector("#products-container .shipping-method-row", timeout=8000)
        t2 = page2.inner_text("body")
        check("صفحهٔ Routing قدیمی هنوز کار می‌کند و یادداشت Override را دارد", "Override هر محصول از داخل" in t2 and "رادیاتور پنلی" in t2)
        rows = page2.locator("#products-container .shipping-method-row")
        row5 = [rows.nth(i) for i in range(rows.count()) if "کالا با کلاس بدون policy" in rows.nth(i).inner_text()]
        row4 = [rows.nth(i) for i in range(rows.count()) if "کالای بدون کلاس" in rows.nth(i).inner_text()]
        check("Override ذخیره‌شده از فرم محصول (freight) در همان صفحهٔ Routing قدیمی انتخاب‌شده است", len(row4) == 1 and row4[0].locator("select").input_value() == "freight")
        check("محصولی که Override نداشت در صفحهٔ Routing «بدون Override» می‌ماند", len(row5) == 1 and row5[0].locator("select").input_value() in ("", "none"))
        check("هیچ خطای JavaScript کنترل‌نشده‌ای رخ نداد", not page_errors, str(page_errors))
        browser.close()

try:
    run()
finally:
    srv.terminate()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
