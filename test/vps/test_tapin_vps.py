"""
Tests for the VPS files integrations/tapin.py and routers/tapin.py (Post v2).

HONESTY NOTES
- httpx / fastapi are NOT installed in the build sandbox and there is no
  network, so this suite builds a temp tree with tiny STUB modules for
  httpx, fastapi, config, auth and integrations.base, then imports the REAL
  vps-proxy/integrations/tapin.py and vps-proxy/routers/tapin.py unchanged.
- Location and box fixtures below are SYNTHETIC (invented codes/dimensions);
  they test logic only. They are NOT real Tapin data.
- No live Tapin call is made. LIVE TEST NOT PERFORMED.

Run:  python3 test/vps/test_tapin_vps.py
"""
import asyncio
import importlib
import json
import os
import shutil
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.abspath(os.path.join(HERE, "..", "..", "vps-proxy"))

FAKE_TOKEN = "tok_FAKE_TEST_TOKEN_1234567890"
FAKE_SHOP = "shop-FAKE-TEST-0000-1111"

STUBS = {
    "httpx.py": '''
class RequestError(Exception): pass
class TimeoutException(RequestError): pass
CALLS = []
HANDLER = {"fn": None}
class _Resp:
    def __init__(self, status, body):
        self.status_code = status; self._body = body
        self.text = body if isinstance(body, str) else __import__("json").dumps(body)
    def json(self):
        if isinstance(self._body, str): raise ValueError("not json")
        return self._body
class AsyncClient:
    def __init__(self, timeout=None): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def _do(self, method, url, headers, payload):
        CALLS.append({"method": method, "url": url, "headers": headers, "json": payload})
        r = HANDLER["fn"](method, url, payload)
        return _Resp(*r)
    async def post(self, url, headers=None, json=None): return await self._do("POST", url, headers, json)
    async def get(self, url, headers=None): return await self._do("GET", url, headers, None)
''',
    "fastapi/__init__.py": '''
class APIRouter:
    def __init__(self, **kw): pass
    def get(self, p): return lambda f: f
    def post(self, p): return lambda f: f
class Request: pass
def Depends(x): return x
''',
    "fastapi/responses.py": '''
class JSONResponse:
    def __init__(self, status_code=200, content=None):
        self.status_code = status_code; self.content = content
''',
    "config.py": "class Settings: pass\n",
    "auth.py": "def require_api_key(): pass\n",
    "integrations/__init__.py": "",
    "integrations/base.py": "class IntegrationDisabledError(Exception): pass\n",
    "routers/__init__.py": "",
}

TMP = tempfile.mkdtemp(prefix="tapin_vps_test_")
for rel, body in STUBS.items():
    path = os.path.join(TMP, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(textwrap.dedent(body))
shutil.copy(os.path.join(REAL, "integrations", "tapin.py"), os.path.join(TMP, "integrations", "tapin.py"))
shutil.copy(os.path.join(REAL, "routers", "tapin.py"), os.path.join(TMP, "routers", "tapin.py"))
sys.path.insert(0, TMP)

import httpx  # noqa: E402  (stub)
from integrations import tapin as T  # noqa: E402
from integrations.base import IntegrationDisabledError  # noqa: E402
from routers import tapin as R  # noqa: E402


class S:
    TAPIN_ENABLED = True
    TAPIN_TOKEN = FAKE_TOKEN
    TAPIN_SHOP_ID = FAKE_SHOP
    TAPIN_BASE_URL = "https://api.tapin.ir/api/v1"  # old-style base on purpose
    HTTP_TIMEOUT_SECONDS = 5


def settings(**kw):
    s = S()
    for k, v in kw.items():
        setattr(s, k, v)
    return s


# SYNTHETIC fixtures -------------------------------------------------------
TREE = {"returns": {"status": 200, "success": True}, "entries": [
    {"code": 1, "title": "تهران", "cities": [
        {"code": 101, "title": "ورامین"}, {"code": 102, "title": "تهران"}, {"code": 103, "title": "کلاته"}]},
    {"code": 2, "title": "اصفهان", "cities": [
        {"code": 201, "title": "اصفهان"}, {"code": 202, "title": "کلاته"}]},
    {"code": 3, "title": "مازندران", "cities": [{"code": 301, "title": "کیاسر\u200cکلا"}]},
]}
BOXES = {"returns": {"status": 200}, "entries": [
    {"id": 1, "length": 10, "width": 10, "height": 10},
    {"id": 2, "length": 20, "width": 15, "height": 10},
    {"id": 3, "length": 30, "width": 20, "height": 20},
    {"id": 4, "length": 40, "width": 30, "height": 30},
    {"id": 5, "length": 50, "width": 40, "height": 30},
    {"id": 6, "length": 60, "width": 40, "height": 40},
    {"id": 7, "length": 70, "width": 50, "height": 40},
    {"id": 8, "length": 80, "width": 60, "height": 50},
    {"id": 9, "length": 90, "width": 70, "height": 60},
    {"id": 10, "length": 120, "width": 80, "height": 80},
    {"id": 11, "length": 30, "width": 20, "height": 1},
]}
OK_PRICE = {"returns": {"status": 200, "success": True},
            "entries": {"send_price": 1000000, "total_send_price": 1500000,
                        "total_service_price": 20000, "total_price": 1520000,
                        "total_weight": 37500}}
RECIPIENT_ENV = dict(TAPIN_QUOTE_ADDRESS="test address", TAPIN_QUOTE_FIRST_NAME="Test",
                     TAPIN_QUOTE_LAST_NAME="User", TAPIN_QUOTE_MOBILE="09000000000",
                     TAPIN_QUOTE_POSTAL_CODE="1111111111", TAPIN_EMPLOYEE_CODE="12345",
                     # SYNTHETIC test values only (not project values): packet_type and the
                     # overflow box id must come from configuration, never from code defaults.
                     TAPIN_PACKET_TYPE="2", TAPIN_OVERFLOW_BOX_ID="10")


def payload(**over):
    p = {"destination_city": "ورامین", "destination_province": "تهران",
         "pay_type": 1, "order_type": 0,
         "products": [{"count": 1, "discount": 0, "price": 1120000000,
                       "title": "پکیج تست", "weight": 36000, "product_id": 8}],
         "length": 46, "width": 24, "height": 69, "package_weight": 1500}
    p.update(over)
    return p


def route(price=None, tree=TREE, boxes=BOXES):
    def fn(method, url, body):
        if "check-price" in url:
            return price if price is not None else (200, OK_PRICE)
        if "packing-box" in url:
            return (200, boxes)
        if "state/tree" in url:
            return (200, tree) if tree is not None else (404, {"detail": "nope"})
        return (404, {"detail": "unexpected " + url})
    return fn


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def quote(p=None, handler=None, **sett):
    T.clear_cache()
    httpx.CALLS.clear()
    httpx.HANDLER["fn"] = handler or route()
    for k, v in RECIPIENT_ENV.items():
        sett.setdefault(k, v)
    return run(T.TapinAdapter(settings(**sett)).get_quote(p or payload()))


def price_call():
    return [c for c in httpx.CALLS if "check-price" in c["url"]][-1]


class Tests(unittest.TestCase):
    # 1-2
    def test_01_pay_type_default_is_1(self):
        p = payload(); del p["pay_type"]
        quote(p)
        self.assertEqual(price_call()["json"]["pay_type"], 1)

    def test_02_order_type_default_is_0(self):
        p = payload(); del p["order_type"]
        quote(p)
        self.assertEqual(price_call()["json"]["order_type"], 0)

    def test_02b_pay_order_configurable_via_settings(self):
        p = payload(); del p["pay_type"]; del p["order_type"]
        quote(p, TAPIN_PAY_TYPE=2, TAPIN_ORDER_TYPE=1)
        b = price_call()["json"]
        self.assertEqual((b["pay_type"], b["order_type"]), (2, 1))

    # 3
    def test_03_box_selection(self):
        boxes = [{"id": i["id"], "dims": [i["length"], i["width"], i["height"]]} for i in BOXES["entries"]]
        pick = T.TapinAdapter.choose_box_id
        self.assertEqual(pick(boxes, 5, 5, 5), 1)
        self.assertEqual(pick(boxes, 10, 20, 15), 2)          # rotation allowed
        self.assertEqual(pick(boxes, 69, 24, 46), 7)          # smallest that fits
        self.assertIsNone(pick(boxes, 100, 70, 60))           # nothing in 1..9 -> None (overflow id comes from config)
        self.assertEqual(pick(boxes, 30, 20, 1), 3)           # box 11 (smaller) is never auto-picked
        quote()
        self.assertEqual(price_call()["json"]["box_id"], 7)

    def test_03b_overflow_box_comes_from_config_only(self):
        big = payload(length=200, width=100, height=90)
        r = quote(big, TAPIN_OVERFLOW_BOX_ID="42")              # synthetic id: proves nothing is hard-coded
        self.assertTrue(r["ok"])
        self.assertEqual(price_call()["json"]["box_id"], 42)
        r = quote(big, TAPIN_OVERFLOW_BOX_ID="")
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertIn("TAPIN_OVERFLOW_BOX_ID", r["missing_fields"])
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])
        # a package that fits boxes 1..9 does not need the overflow setting at all
        r = quote(payload(), TAPIN_OVERFLOW_BOX_ID="")
        self.assertTrue(r["ok"])

    # 4
    def test_04_package_weight_grams_no_hidden_conversion(self):
        quote()
        b = price_call()["json"]
        self.assertEqual(b["package_weight"], 1500)
        self.assertEqual(b["products"][0]["weight"], 36000)

    def test_04b_kg_unit_is_rejected_contract_is_integer_grams(self):
        r = quote(TAPIN_PACKAGE_WEIGHT_UNIT="kg")
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertIn("TAPIN_PACKAGE_WEIGHT_UNIT", r["invalid_fields"])
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])

    def test_04c_weights_and_codes_are_integers(self):
        quote(payload(package_weight=1500.0,
                      products=[{"count": 1, "discount": 0, "price": 5000.0, "title": "t", "weight": 36000.0}]))
        b = price_call()["json"]
        for key in ("package_weight", "box_id", "packet_type", "city_code", "province_code",
                    "postal_code", "employee_code", "pay_type", "order_type"):
            self.assertIs(type(b[key]), int, key)
        for key in ("count", "discount", "price", "weight"):
            self.assertIs(type(b["products"][0][key]), int, key)

    # 5-6
    def test_05_city_resolution_normalises_letters(self):
        provs = T.TapinAdapter(settings()).__class__._parse_tree(T.TapinAdapter(settings()), TREE)
        a = T.TapinAdapter(settings())
        r = a.resolve_city(provs, "كياسر كلا")             # Arabic kaf/yeh + plain space
        self.assertEqual((r["province_code"], r["city_code"]), (3, 301))
        r = a.resolve_city(provs, "ورامين", "استان تهران")
        self.assertEqual(r["city_code"], 101)

    def test_06_province_disambiguation(self):
        r1 = quote(payload(destination_city="کلاته", destination_province="اصفهان"))
        self.assertTrue(r1["ok"])
        self.assertEqual(price_call()["json"]["city_code"], 202)
        self.assertEqual(price_call()["json"]["province_code"], 2)
        r2 = quote(payload(destination_city="کلاته", destination_province="تهران"))
        self.assertEqual(price_call()["json"]["city_code"], 103)
        self.assertTrue(r2["ok"])

    def test_06b_state_list_city_list_fallback(self):
        def fn(method, url, body):
            if "state/tree" in url:
                return (404, {"detail": "no tree"})
            if "state/list" in url:
                return (200, {"entries": [{"code": 6, "title": "اصفهان"}]})
            if "city/list" in url:
                assert body == {"state_code": 6}
                return (200, {"entries": [{"code": 601, "title": "کاشان"}]})
            return route()(method, url, body)
        r = quote(payload(destination_city="کاشان", destination_province="اصفهان"), handler=fn)
        self.assertTrue(r["ok"])
        self.assertEqual(price_call()["json"]["city_code"], 601)

    # 7-8
    def test_07_08_success_total_send_price_and_total_weight(self):
        r = quote()
        self.assertTrue(r["ok"])
        self.assertEqual(r["entries"]["total_send_price"], 1500000)
        self.assertEqual(r["entries"]["total_weight"], 37500)
        self.assertEqual(r["sent"]["box_id"], 7)
        self.assertEqual(r["sent"]["package_weight"], 1500)
        self.assertEqual(r["sent"]["products_weight_grams"], 36000)

    # 9
    def test_09_http_400_keeps_real_body(self):
        body = {"returns": {"status": 400, "message": "box_id is invalid"}, "entries": {}}
        r = quote(handler=route(price=(400, body)))
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_code"], "TAPIN_HTTP_400")
        self.assertIn("box_id is invalid", r["message"])
        self.assertEqual(r["tapin"]["returns"]["message"], "box_id is invalid")

    def test_09b_auth_error(self):
        r = quote(handler=route(price=(401, {"detail": "bad token"})))
        self.assertEqual(r["error_code"], "TAPIN_AUTH_ERROR")

    def test_09c_body_level_error_on_http_200(self):
        r = quote(handler=route(price=(200, {"returns": {"status": 10405, "message": "denied"}})))
        self.assertEqual(r["error_code"], "TAPIN_10405")

    # 10
    def test_10_timeout(self):
        def fn(method, url, body):
            if "check-price" in url:
                raise httpx.TimeoutException("slow")
            return route()(method, url, body)
        r = quote(handler=fn)
        self.assertEqual(r["error_code"], "TAPIN_TIMEOUT")

    # 11-12
    def test_11_city_not_found(self):
        r = quote(payload(destination_city="شهر ناموجود", destination_province="تهران"))
        self.assertEqual(r["error_code"], "CITY_NOT_FOUND")
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])

    def test_12_city_ambiguous_with_candidates(self):
        p = payload(destination_city="کلاته"); del p["destination_province"]
        r = quote(p)
        self.assertEqual(r["error_code"], "CITY_AMBIGUOUS")
        self.assertEqual(len(r["candidates"]), 2)
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])

    def test_12b_province_not_found(self):
        r = quote(payload(destination_province="ناموجود"))
        self.assertEqual(r["error_code"], "PROVINCE_NOT_FOUND")

    # 13
    def test_13_token_and_shop_redaction(self):
        leaky = {"returns": {"status": 400, "message": f"bad Authorization: Bearer {FAKE_TOKEN} shop {FAKE_SHOP}"},
                 "echo": {"token": FAKE_TOKEN}}
        r = quote(handler=route(price=(400, leaky)))
        dumped = json.dumps(r, ensure_ascii=False)
        self.assertNotIn(FAKE_TOKEN, dumped)
        self.assertNotIn(FAKE_SHOP, dumped)
        self.assertIn("[REDACTED]", dumped)

    # 15-16
    def test_15_no_tipax_or_v4_endpoint(self):
        quote()
        for c in httpx.CALLS:
            self.assertIn("/api/v2/", c["url"])
            self.assertNotIn("tipax", c["url"].lower())
            self.assertNotIn("/v4", c["url"])
        self.assertTrue(price_call()["url"].endswith("/api/v2/public/order/post/check-price/"))

    def test_16_no_tipax_fields_in_post_v2_body(self):
        quote(TAPIN_KIOSK_ID="7")
        b = price_call()["json"]
        for bad in ("receiver_province_id", "receiver_city_id", "product_type_id",
                    "packing_type_id", "service_type", "payment_type", "delivery_type",
                    "pickup_type", "length", "width", "height", "destination_city", "weight_package"):
            self.assertNotIn(bad, b)
        self.assertEqual(set(b), {"shop_id", "address", "city_code", "province_code", "first_name",
                                  "last_name", "mobile", "postal_code", "employee_code", "pay_type",
                                  "order_type", "package_weight", "box_id", "packet_type", "kiosk_id",
                                  "products"})
        self.assertEqual(b["kiosk_id"], 7)
        # product_id (Tapin catalogue id) is never forwarded; title/weight/price are sent instead
        self.assertEqual(set(b["products"][0]), {"count", "discount", "price", "title", "weight"})

    def test_16b_legacy_worker_fields_are_ignored(self):
        p = payload(product_type_id=1, packing_type_id=2, service_type=7, payment_type=10)
        quote(p)
        b = price_call()["json"]
        for bad in ("product_type_id", "packing_type_id", "service_type", "payment_type"):
            self.assertNotIn(bad, b)

    # extra hardening
    def test_17_missing_recipient_config_is_explicit(self):
        T.clear_cache()
        httpx.HANDLER["fn"] = route()
        r = run(T.TapinAdapter(settings()).get_quote(payload()))
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertIn("address", r["missing_fields"])
        self.assertIn("employee_code", r["missing_fields"])

    def test_17b_packet_type_is_required_and_never_guessed(self):
        T.clear_cache()
        httpx.CALLS.clear()
        httpx.HANDLER["fn"] = route()
        cfg = {k: v for k, v in RECIPIENT_ENV.items() if k != "TAPIN_PACKET_TYPE"}
        r = run(T.TapinAdapter(settings(**cfg)).get_quote(payload()))
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertEqual(r["missing_fields"], ["packet_type"])
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])
        # a request-level value (from the Worker) is honoured
        r = run(T.TapinAdapter(settings(**cfg)).get_quote(payload(packet_type=3)))
        self.assertTrue(r["ok"])
        self.assertEqual(price_call()["json"]["packet_type"], 3)

    def test_17c_invalid_or_too_long_contract_values_are_explicit(self):
        r = quote(TAPIN_EMPLOYEE_CODE="EMP-TEST")
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertIn("employee_code", r["invalid_fields"])
        r = quote(TAPIN_QUOTE_FIRST_NAME="x" * 31)
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")
        self.assertIn("first_name", r["invalid_fields"])
        r = quote(TAPIN_QUOTE_ADDRESS="x" * 301)
        self.assertIn("address", r["invalid_fields"])
        self.assertFalse([c for c in httpx.CALLS if "check-price" in c["url"]])

    def test_17d_has_insurance_only_when_configured(self):
        quote()
        self.assertNotIn("has_insurance", price_call()["json"])
        quote(TAPIN_HAS_INSURANCE="true")
        self.assertEqual(price_call()["json"]["has_insurance"], 1)
        quote(TAPIN_HAS_INSURANCE="0")
        self.assertEqual(price_call()["json"]["has_insurance"], 0)
        r = quote(TAPIN_HAS_INSURANCE="maybe")
        self.assertEqual(r["error_code"], "TAPIN_CONTRACT_INCOMPLETE")

    def test_17e_title_is_cut_to_100_chars(self):
        p = payload(products=[{"count": 1, "discount": 0, "price": 5, "title": "ع" * 150, "weight": 10}])
        quote(p)
        self.assertEqual(len(price_call()["json"]["products"][0]["title"]), 100)

    def test_18_zero_or_missing_price_is_error_not_free(self):
        z = {"returns": {"status": 200}, "entries": {"total_send_price": 0}}
        self.assertEqual(quote(handler=route(price=(200, z)))["error_code"], "TAPIN_PRICE_INVALID")
        m = {"returns": {"status": 200}, "entries": {}}
        self.assertEqual(quote(handler=route(price=(200, m)))["error_code"], "TAPIN_PRICE_NOT_FOUND")

    def test_19_disabled_and_bad_input(self):
        with self.assertRaises(IntegrationDisabledError):
            run(T.TapinAdapter(settings(TAPIN_ENABLED=False)).get_quote(payload()))
        with self.assertRaises(ValueError):
            quote(payload(products=[{"count": 1, "price": 5, "title": "", "weight": 10}]))
        with self.assertRaises(ValueError):
            quote(payload(length=None))

    def test_20_base_url_normalisation(self):
        for base in ("https://api.tapin.ir", "https://api.tapin.ir/", "https://api.tapin.ir/api/v1",
                     "https://api.tapin.ir/api/v2"):
            self.assertEqual(T.TapinAdapter(settings(TAPIN_BASE_URL=base))._v2_base(),
                             "https://api.tapin.ir/api/v2")

    def test_20b_dotenv_fallback_for_new_quote_settings(self):
        env_path = os.path.join(TMP, ".env")
        keys = {
            "TAPIN_ENABLED": "true",
            "TAPIN_TOKEN": "dotenv-token-123456",
            "TAPIN_SHOP_ID": "dotenv-shop-123456",
            **RECIPIENT_ENV,
        }
        with open(env_path, "w", encoding="utf-8") as fh:
            for k, v in keys.items():
                fh.write(f"{k}={v}\n")
        old = {k: os.environ.pop(k, None) for k in keys}
        try:
            s = S()
            s.TAPIN_ENABLED = False
            s.TAPIN_TOKEN = ""
            s.TAPIN_SHOP_ID = ""
            for k in RECIPIENT_ENV:
                setattr(s, k, "")
            r = run(T.TapinAdapter(s).get_quote(payload()))
            self.assertTrue(r["ok"])
            self.assertEqual(price_call()["json"]["shop_id"], "dotenv-shop-123456")
        finally:
            for k, value in old.items():
                if value is not None:
                    os.environ[k] = value
            try:
                os.remove(env_path)
            except FileNotFoundError:
                pass

    # router
    def _route(self, exc=None, result=None):
        class Req:
            async def json(self_inner): return {"x": 1}
        class FakeAdapter:
            def __init__(self, s): pass
            async def get_quote(self_inner, p):
                if exc: raise exc
                return result
        R._settings = lambda: settings()
        R.TapinAdapter = FakeAdapter
        return run(R.quote(Req()))

    def test_21_router_error_mapping_has_no_leaks(self):
        r = self._route(exc=ValueError("destination_city is required."))
        self.assertEqual((r.status_code, r.content["error_code"]), (400, "TAPIN_BAD_REQUEST"))
        r = self._route(exc=IntegrationDisabledError("Tapin integration is disabled."))
        self.assertEqual((r.status_code, r.content["error_code"]), (501, "TAPIN_DISABLED"))
        r = self._route(exc=RuntimeError(f"boom {FAKE_TOKEN}"))
        self.assertEqual((r.status_code, r.content["error_code"]), (502, "TAPIN_INTERNAL_ERROR"))
        self.assertNotIn(FAKE_TOKEN, json.dumps(r.content))
        self.assertNotIn("Traceback", json.dumps(r.content))
        ok = self._route(result={"ok": True, "entries": {"total_send_price": 1}})
        self.assertTrue(ok["ok"])


if __name__ == "__main__":
    prog = unittest.main(exit=False, verbosity=1)
    shutil.rmtree(TMP, ignore_errors=True)
    r = prog.result
    print(f"\nPYTHON: {r.testsRun - len(r.failures) - len(r.errors)} passed, {len(r.failures) + len(r.errors)} failed")
    sys.exit(0 if r.wasSuccessful() else 1)
