#!/usr/bin/env python3
"""
تست مرورگر واقعی (Chromium + Playwright) برای Stage C — حذف نمایش فیلدهای قدیمی ارسال.
Worker واقعی + D1 آزمایشی؛ هم Product Admin و هم صفحهٔ عمومی SSR محصول (/store/product/:slug) واقعی‌اند.
(تنها شبیه‌سازی: دستهٔ‌بندی‌های ادمین.)
اجرا:  python3 test/browser/stage-c-legacy-fields.browser.py [پوشهٔ اسکرین‌شات]
"""
import json, os, subprocess, sys, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 8797
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
if SHOTS: os.makedirs(SHOTS, exist_ok=True)

LEGACY_TEXTS = ["هزینه ارسال:", "روش ارسال:", "زمان ارسال:", "پست پیشتاز", "۳ روز کاری", "روش-قدیمی-تست", "زمان-قدیمی-تست", "۹۸۷٬۶۵۴", "987654"]

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  ✓ {name}")
    else: failed += 1; print(f"  ✗ {name} {extra}")
def sql(q): return json.load(urllib.request.urlopen(f"{BASE}/__test/sql?q=" + urllib.parse.quote(q)))

srv = subprocess.Popen(["node", "--no-warnings", os.path.join(ROOT, "test/browser/stage-c-server.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert "READY" in srv.stdout.readline()

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 1500}, locale="fa-IR")
        ctx.add_init_script("sessionStorage.setItem('apadana_admin_token','adm')")
        errors = []

        # ---------------- Product Admin ----------------
        print("— Product Admin —")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(("admin", str(e))))
        page.route("**/api/store/admin/categories", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "categories": []})))
        page.goto(f"{BASE}/admin/products/")
        page.wait_for_selector("#product-form", state="attached")
        page.wait_for_function("typeof editProduct === 'function'")
        page.evaluate("loadProducts(1)")
        page.wait_for_function("typeof productsCache !== 'undefined' && productsCache.length >= 2", timeout=8000)
        page.evaluate("editProduct(1)")
        page.wait_for_selector("#product-route-override", timeout=8000)

        form_text = page.inner_text("#product-form")
        for fid in ["product-shipping-cost", "product-shipping-method", "product-shipping-time"]:
            check(f"فیلد قدیمی #{fid} در DOM نیست", page.locator(f"#{fid}").count() == 0)
        check("هیچ ورودی با placeholder قدیمی («پیش‌فرض فروشگاه: رایگان/پست پیشتاز/…») نیست",
              page.locator("input[placeholder*='پیش‌فرض فروشگاه']").count() == 0)
        for t in ["هزینه ارسال (تومان)", "پیش‌فرض فروشگاه", "متن نمایشی قدیمی"]:
            check(f"متن/برچسب قدیمی «{t}» در فرم نیست", t not in form_text)
        check("صفحهٔ ادمین هیچ مقدار قدیمی D1 را نمایش نمی‌دهد", all(t not in page.content() for t in ["روش-قدیمی-تست", "زمان-قدیمی-تست", "987654"]))

        check("Shipping Class باقی است و مقدار محصول انتخاب شده", page.eval_on_selector("#product-shipping-class", "e => e.options[e.selectedIndex].textContent") == "پکیج و آبگرمکن")
        txt = page.inner_text("#shipping-summary-body")
        check("خلاصهٔ حمل: Route Policy کلاس", "Route Policy کلاس" in txt and "عادی" in txt)
        check("خلاصهٔ حمل: مشخصات فیزیکی (۳۶٬۰۰۰ گرم، ۴۶ × ۲۴ × ۶۹)", "۳۶" in txt and "۴۶ × ۲۴ × ۶۹" in txt)
        check("خلاصهٔ حمل: Packaging Profile مؤثر", "FACTORY_PACKAGED" in txt)
        check("خلاصهٔ حمل: مسیر مؤثر و دلیل مسیر", "مسیر مؤثر خارج از اصفهان" in txt and "دلیل مسیر" in txt)
        check("خلاصهٔ حمل: هشدارهای اطلاعات حمل", "هشدارهای اطلاعات حمل" in txt)
        check("Route Override: سه گزینه و دکمهٔ ذخیرهٔ جدا باقی است",
              page.eval_on_selector_all("#product-route-override option", "els => els.map(e => e.value)") == ["", "normal", "freight"] and page.locator("#save-route-override").count() == 1)
        check("وزن/ابعاد/Packaging در فرم باقی است", all(page.locator(s).count() == 1 for s in ["#product-weight", "#product-length", "#product-width", "#product-height", "#product-packaging-profile", "#product-package-weight"]))
        if SHOTS: page.locator("#shipping-summary-box").scroll_into_view_if_needed(); page.screenshot(path=os.path.join(SHOTS, "c1-admin-form-no-legacy.png"), full_page=False)

        print("— رفتار Override (Stage B) بعد از حذف فیلدها —")
        page.select_option("#product-route-override", "freight")
        check("Unsaved: پیام و فعال‌شدن دکمه", page.is_visible("#route-override-unsaved") and page.is_enabled("#save-route-override"))
        page.click("#save-route-override")
        page.wait_for_function("document.querySelector('#shipping-summary-body').innerText.includes('Override مدیریتی محصول: باربری')", timeout=8000)
        check("Save Override جدا: D1=freight و مسیر مؤثر از Server (باربری)", sql("SELECT shipping_route_override v FROM products WHERE id=1")[0]["v"] == "freight" and "باربری (پس‌کرایه)" in page.inner_text("#shipping-summary-body"))
        before = sql("SELECT shipping_cost,shipping_method,shipping_time FROM products WHERE id=1")[0]
        check("ذخیرهٔ Override ستون‌های قدیمی را دست نزد", before == {"shipping_cost": 987654, "shipping_method": "روش-قدیمی-تست", "shipping_time": "زمان-قدیمی-تست"})

        print("— ذخیرهٔ واقعی محصول (PUT) از فرم جدید —")
        page.fill("#product-name", "پکیج تست ویرایش‌شده")
        # تأییدیه Override ذخیره‌نشده فقط وقتی dirty است؛ اینجا dirty نیست
        page.evaluate("document.getElementById('product-form').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_function("document.querySelector('.toast, #toast, [class*=toast]') !== null || true")
        page.wait_for_timeout(800)
        row = sql("SELECT name,shipping_cost,shipping_method,shipping_time,shipping_route_override FROM products WHERE id=1")[0]
        check("ذخیرهٔ محصول انجام شد", row["name"] == "پکیج تست ویرایش‌شده", str(row))
        check("داده‌های قدیمی D1 بعد از ذخیرهٔ محصول از فرم جدید حفظ شد (نه NULL)", (row["shipping_cost"], row["shipping_method"], row["shipping_time"]) == (987654, "روش-قدیمی-تست", "زمان-قدیمی-تست"), str(row))
        check("Override مستقل ماند (freight)", row["shipping_route_override"] == "freight")

        # ---------------- Public Product (SSR واقعی + JS) ----------------
        print("— صفحهٔ عمومی محصول (SSR + JavaScript) —")
        for slug, label in [("pkg-test", "محصول با داده قدیمی ارسال"), ("rad-test", "محصول بدون داده ارسال (NULL)")]:
            pub = ctx.new_page()
            pub.on("pageerror", lambda e, s=slug: errors.append((s, str(e))))
            ssr_html = pub.request.get(f"{BASE}/store/product/{slug}").text()
            ssr_part = ssr_html[ssr_html.index('id="product-detail"'): ssr_html.index('id="product-detail"') + 5000]
            check(f"[{label}] HTML خام SSR: بلوک قدیمی ارسال تزریق نشده", all(t not in ssr_part for t in LEGACY_TEXTS) and "product-shipping-info" not in ssr_html)
            check(f"[{label}] SSR: JSON-LD معتبر و بدون ارسال قدیمی", '"@type":"Product"' in ssr_html and "shippingDetails" not in ssr_html and "987654" not in ssr_html)
            pub.goto(f"{BASE}/store/product/{slug}")
            pub.wait_for_selector("#product-detail", state="attached")
            pub.wait_for_selector("#shipping-estimator-container", state="attached", timeout=10000)
            pub.wait_for_timeout(1500)
            body = pub.inner_text("body")
            # DOM رندرشده بدون <script>/<style>: کامنت‌های داخل کد JS (مثل توضیح تابع shippingCostLabel) نمایش به مشتری نیستند.
            html = pub.evaluate("() => { const c = document.documentElement.cloneNode(true); c.querySelectorAll('script,style').forEach(e => e.remove()); return c.outerHTML; }")
            for t in LEGACY_TEXTS:
                check(f"[{label}] DOM رندرشدهٔ نهایی (پس از JS) شامل «{t}» نیست", t not in body and t not in html)
            check(f"[{label}] المان .product-shipping-info وجود ندارد", pub.locator(".product-shipping-info").count() == 0)
            check(f"[{label}] برآوردگر واقعی ارسال (شهر) همچنان نمایش داده می‌شود", "برآورد هزینه ارسال" in body)
            check(f"[{label}] اطلاعات معتبر دیگر نمایش داده می‌شود (نام و قیمت)", ("پکیج تست" in body or "رادیاتور تست" in body) and "تومان" in body)
            if SHOTS: pub.screenshot(path=os.path.join(SHOTS, f"c2-public-{slug}.png"), full_page=False)
            pub.close()

        check("هیچ خطای JavaScript کنترل‌نشده‌ای رخ نداد", not errors, str(errors))
        browser.close()

try:
    run()
finally:
    srv.terminate()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
