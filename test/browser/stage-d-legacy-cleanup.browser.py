#!/usr/bin/env python3
"""
تست مرورگر واقعی (Chromium + Playwright) برای Stage D — پاکسازی نهایی Legacy Shipping.
Worker واقعی + D1 آزمایشی (از stage-c-server.mjs)؛ Product Admin، صفحهٔ عمومی SSR و فایل‌های استاتیک واقعی‌اند.
(تنها شبیه‌سازی: دسته‌بندی‌های ادمین.)
اجرا:  python3 test/browser/stage-d-legacy-cleanup.browser.py [پوشهٔ اسکرین‌شات]
"""
import json, os, subprocess, sys, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 8795
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
KEYS = ["shipping_cost", "shipping_method", "shipping_time"]
LEGACY_TEXTS = ["هزینه ارسال:", "روش ارسال:", "زمان ارسال:", "پست پیشتاز", "۳ روز کاری", "روش-قدیمی-تست", "زمان-قدیمی-تست", "۹۸۷٬۶۵۴", "987654"]

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  ✓ {name}")
    else: failed += 1; print(f"  ✗ {name} {extra}")
def sql(q): return json.load(urllib.request.urlopen(f"{BASE}/__test/sql?q=" + urllib.parse.quote(q)))

# پورت جدا از Stage C؛ همان سرور آزمایشی
srv = subprocess.Popen(["node", "--no-warnings", os.path.join(ROOT, "test/browser/stage-c-server.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert "READY" in srv.stdout.readline()

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 1500}, locale="fa-IR")
        ctx.add_init_script("sessionStorage.setItem('apadana_admin_token','adm')")
        errors = []

        print("— Static asset —")
        r = ctx.request.get(f"{BASE}/store/product.html.bak")
        check("/store/product.html.bak دیگر سرو نمی‌شود (۴۰۴)", r.status == 404, str(r.status))
        check("فایل در سورس/Build وجود ندارد", not os.path.exists(os.path.join(ROOT, "public/store/product.html.bak")))
        css = ctx.request.get(f"{BASE}/store/store.css").text()
        check("CSS سرو‌شده: .product-shipping-info نیست", "product-shipping-info" not in css)
        check("CSS سرو‌شده: قواعد برآوردگر ارسال هست", ".shipping-estimator {" in css and ".shipping-estimator select {" in css)
        check("صفحهٔ اصلی محصول همچنان سرو می‌شود", ctx.request.get(f"{BASE}/store/product.html").status == 200)

        print("— Product Admin —")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(("admin", str(e))))
        gets = []
        def on_resp(resp):
            if resp.request.method == "GET" and resp.url.split("?")[0].endswith("/api/store/products") and resp.status == 200:
                gets.append(resp)
        page.on("response", on_resp)
        page.route("**/api/store/admin/categories", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "categories": []})))
        page.goto(f"{BASE}/admin/products/")
        page.wait_for_selector("#product-form", state="attached")
        page.wait_for_function("typeof editProduct === 'function'")
        page.evaluate("loadProducts(1)")
        page.wait_for_function("typeof productsCache !== 'undefined' && productsCache.length >= 2", timeout=8000)
        check("GET ادمین محصولات (از خود UI) انجام و موفق شد", len(gets) >= 1)
        body = gets[-1].json()
        check("پاسخ GET واقعی ادمین: هیچ‌یک از سه کلید قدیمی نیست", all(k not in pr for pr in body["products"] for k in KEYS) and len(body["products"]) == 2)
        check("پاسخ GET: داده‌ی قدیمی (مقدار) هم نشت نمی‌کند", all(t not in json.dumps(body, ensure_ascii=False) for t in ["روش-قدیمی-تست", "زمان-قدیمی-تست", "987654"]))
        check("لیست محصولات ادمین در UI رندر می‌شود (سالم)", "پکیج تست" in page.inner_text("body"))
        page.evaluate("editProduct(1)")
        page.wait_for_selector("#product-route-override", timeout=8000)
        check("فرم ادمین: سه فیلد قدیمی نیست", all(page.locator(f"#product-{k.replace('_','-')}").count() == 0 for k in KEYS))
        check("فرم ادمین: Shipping Class انتخاب‌شده", page.eval_on_selector("#product-shipping-class", "e => e.options[e.selectedIndex].textContent") == "پکیج و آبگرمکن")
        txt = page.inner_text("#shipping-summary-body")
        check("Shipping Summary: Class / Policy / مسیر مؤثر / دلیل / فیزیکی / Packaging", all(t in txt for t in ["Shipping Class", "Route Policy کلاس", "مسیر مؤثر خارج از اصفهان", "دلیل مسیر", "۴۶ × ۲۴ × ۶۹", "FACTORY_PACKAGED"]))
        check("Override سه‌حالته + دکمهٔ ذخیرهٔ جدا", page.eval_on_selector_all("#product-route-override option", "els => els.map(e => e.value)") == ["", "normal", "freight"] and page.locator("#save-route-override").count() == 1)
        if SHOTS: page.locator("#shipping-summary-box").scroll_into_view_if_needed(); page.screenshot(path=os.path.join(SHOTS, "d1-admin.png"))

        print("— Override جدا (Stage B) بعد از حذف فیلدها از GET —")
        start = page.eval_on_selector("#product-route-override", "e => e.value")
        check("مقدار اولیهٔ Override از Server = پیش‌فرض کلاس (NULL)", start == "" and sql("SELECT shipping_route_override v FROM products WHERE id=1")[0]["v"] is None)
        page.select_option("#product-route-override", "freight")
        check("Unsaved نمایش داده می‌شود", page.is_visible("#route-override-unsaved") and page.is_enabled("#save-route-override"))
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Override مدیریتی محصول: باربری')", timeout=8000)
        check("Save Override: freight در D1 و مسیر مؤثر باربری از Server", sql("SELECT shipping_route_override v FROM products WHERE id=1")[0]["v"] == "freight" and "باربری (پس‌کرایه)" in page.inner_text("#shipping-summary-body"))
        page.select_option("#product-route-override", "")
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Shipping Class محصول: عادی')", timeout=8000)
        row = sql("SELECT shipping_route_override v, shipping_cost c, shipping_method m, shipping_time t FROM products WHERE id=1")[0]
        check("برگشت به پیش‌فرض کلاس: NULL واقعی در D1", row["v"] is None)
        check("ستون‌های قدیمی با ذخیرهٔ Override دست نخوردند", (row["c"], row["m"], row["t"]) == (987654, "روش-قدیمی-تست", "زمان-قدیمی-تست"))

        print("— Product Save با فرم فعلی —")
        page.fill("#product-name", "پکیج تست — Stage D")
        page.evaluate("document.getElementById('product-form').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_timeout(900)
        row = sql("SELECT name, shipping_cost c, shipping_method m, shipping_time t FROM products WHERE id=1")[0]
        check("Save محصول انجام شد", row["name"] == "پکیج تست — Stage D", str(row))
        check("داده‌ی Legacy در D1 بعد از Save تغییر نکرد", (row["c"], row["m"], row["t"]) == (987654, "روش-قدیمی-تست", "زمان-قدیمی-تست"), str(row))
        cols = [c["name"] for c in sql("PRAGMA table_info(products)")]
        check("ستون‌های قدیمی هنوز در schema هستند", all(k in cols for k in KEYS))

        print("— صفحهٔ عمومی محصول —")
        for slug, label in [("pkg-test", "دارای داده‌ی قدیمی"), ("rad-test", "بدون داده‌ی قدیمی")]:
            pub = ctx.new_page()
            pub.on("pageerror", lambda e, s=slug: errors.append((s, str(e))))
            pub.goto(f"{BASE}/store/product/{slug}")
            pub.wait_for_selector("#shipping-estimator-container", state="attached", timeout=10000)
            pub.wait_for_timeout(1500)
            visible = pub.inner_text("body")
            dom = pub.evaluate("() => { const c = document.documentElement.cloneNode(true); c.querySelectorAll('script,style').forEach(e => e.remove()); return c.outerHTML; }")
            check(f"[{label}] متن/مقدار قدیمی نمایش داده نمی‌شود", all(t not in visible and t not in dom for t in LEGACY_TEXTS))
            check(f"[{label}] بلوک قدیمی (.product-shipping-info) نیست", pub.locator(".product-shipping-info").count() == 0)
            check(f"[{label}] برآوردگر واقعی ارسال هست", "برآورد هزینه ارسال" in visible and pub.locator("#shipping-estimator-container select").count() >= 1)
            border = pub.evaluate("() => { const e = document.querySelector('#shipping-estimator-container .shipping-estimator'); return e ? getComputedStyle(e).borderTopWidth + '|' + getComputedStyle(e).textAlign : null }")
            check(f"[{label}] CSS برآوردگر هنوز اعمال می‌شود (کادر ۱px)", border is not None and border.startswith("1px"), str(border))
            if SHOTS: pub.screenshot(path=os.path.join(SHOTS, f"d2-public-{slug}.png"))
            pub.close()

        check("هیچ خطای JavaScript کنترل‌نشده‌ای رخ نداد", not errors, str(errors))
        browser.close()

try:
    run()
finally:
    srv.terminate()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
