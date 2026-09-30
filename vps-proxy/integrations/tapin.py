"""
Tapin Post v2 shipping adapter (quote / check-price only).

Tapin credentials remain exclusively on the VPS.
The Cloudflare Worker only talks to this proxy.

Contract:
  Worker -> VPS : POST /api/v1/tapin/quote
      destination_city, destination_province?, pay_type?, order_type?,
      packet_type? (else TAPIN_PACKET_TYPE),
      products[{count, discount, price, title, weight}],
      length, width, height, package_weight
      (money in Rial, weights in integer grams; this adapter performs NO
      money conversion and NO weight-unit conversion)
  VPS -> Tapin  : POST {base}/api/v2/public/order/post/check-price/
      shop_id, address, city_code, province_code, description?, email?,
      employee_code, first_name, last_name, mobile, phone?, postal_code,
      pay_type, order_type, package_weight, box_id, packet_type,
      has_insurance?, kiosk_id?, products[{count, discount, price, title, weight}]
      (integer fields are sent as integers; weights are integer grams;
      no value is invented: packet_type / employee_code / recipient fields /
      the overflow box id must come from configuration or the request,
      otherwise the adapter stops with TAPIN_CONTRACT_INCOMPLETE)

No Tipax / v4 endpoint or field is used anywhere in this module.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

from config import Settings
from integrations.base import IntegrationDisabledError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_TAPIN_ROOT = "https://api.tapin.ir"
API_V2_PREFIX = "/api/v2"

# Paths (relative to the /api/v2 base). Each can be overridden through
# settings/env (TAPIN_PATH_<NAME>) without a code change, because the
# location/packing-box paths could not be verified from the attached files.
DEFAULT_PATHS = {
    "CHECK_PRICE": "/public/order/post/check-price/",
    "PACKING_BOX": "/public/order/post/packing-box/",
    "STATE_TREE": "/public/state/tree/",
    "STATE_LIST": "/public/state/list/",
    "CITY_LIST": "/public/city/list/",
}

DEFAULT_PAY_TYPE = 1
DEFAULT_ORDER_TYPE = 0
# Boxes 1..9 are the ones Tapin documents as selectable. Which box id means
# "larger than 9" is NOT assumed here: it comes from TAPIN_OVERFLOW_BOX_ID
# (configuration). 11..15 are never auto-selected.
SELECTABLE_BOX_IDS = range(1, 10)

# Field length limits from the current check-price contract.
MAX_LEN = {
    "address": 300,
    "first_name": 30,
    "last_name": 40,
    "description": 250,
    "title": 100,
}

CACHE_TTL_SECONDS = 6 * 60 * 60
_CACHE: dict[str, tuple[float, Any]] = {}


def clear_cache() -> None:
    _CACHE.clear()


class TapinError(Exception):
    """Controlled, already-redacted adapter error."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        tapin: Any = None,
        candidates: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.tapin = tapin
        self.candidates = candidates
        self.extra = extra or {}

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "ok": False,
            "error_code": self.code,
            "message": self.message,
        }
        if self.candidates:
            out["candidates"] = self.candidates
        if self.tapin is not None:
            out["tapin"] = self.tapin
        out.update(self.extra)
        return out


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------
_ARABIC_TO_PERSIAN = {"ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه"}
_STRIP_CHARS = "\u200f\u200e\u0640\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652"


def normalize_text(value: Any) -> str:
    """Normalise Persian/Arabic letters, ZWNJ and whitespace for comparison."""
    if value is None:
        return ""
    text = str(value)
    for src, dst in _ARABIC_TO_PERSIAN.items():
        text = text.replace(src, dst)
    for ch in _STRIP_CHARS:
        text = text.replace(ch, "")
    text = text.replace("\u200c", " ")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def _normalize_province(value: Any) -> str:
    text = normalize_text(value)
    return re.sub(r"^استان\s+", "", text)


def _normalize_city(value: Any) -> str:
    text = normalize_text(value)
    return re.sub(r"^شهر\s+", "", text)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------
class TapinAdapter:
    def __init__(self, settings: Settings):
        self._settings = settings

    # -- configuration ------------------------------------------------------
    @staticmethod
    def _dotenv_value(name: str) -> str | None:
        """Read one value from the project .env only when it is not exported.

        The real VPS keeps Tapin secrets in /opt/apadana-payment-proxy/.env.
        Some Settings implementations expose only declared fields, so newly
        added TAPIN_QUOTE_* values may exist in .env without appearing as
        Settings attributes or process environment variables. This small,
        read-only fallback keeps the adapter self-contained without requiring
        a particular config.py implementation.
        """
        try:
            env_path = Path(__file__).resolve().parents[1] / ".env"
            if not env_path.is_file():
                return None
            prefix = f"{name}="
            for raw in env_path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or not line.startswith(prefix):
                    continue
                value = line[len(prefix):].strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                return value
        except (OSError, UnicodeError):
            return None
        return None

    def _cfg(self, name: str, default: Any = None) -> Any:
        # Explicit process environment wins, then Settings, then the local
        # .env fallback. This matters when Settings declares a default such as
        # TAPIN_ENABLED=false while the real VPS .env intentionally enables it.
        value = os.environ.get(name)
        if value is None or value == "":
            value = self._dotenv_value(name)
        if value is None or value == "":
            value = getattr(self._settings, name, None)
        if value is None or value == "":
            return default
        return value

    @staticmethod
    def _as_bool(value: Any, default: bool = False) -> bool:
        if value is None or value == "":
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _ensure_enabled(self) -> None:
        if not self._as_bool(self._cfg("TAPIN_ENABLED", False)):
            raise IntegrationDisabledError(
                "Tapin integration is disabled. Set TAPIN_ENABLED=true."
            )
        if not self._cfg("TAPIN_TOKEN"):
            raise ValueError("TAPIN_TOKEN is not configured.")
        if not self._cfg("TAPIN_SHOP_ID"):
            raise ValueError("TAPIN_SHOP_ID is not configured.")

    def _v2_base(self) -> str:
        base = str(self._cfg("TAPIN_BASE_URL", DEFAULT_TAPIN_ROOT)).strip().rstrip("/")
        base = re.sub(r"/api/v\d+$", "", base)
        return f"{base}{API_V2_PREFIX}"

    def _url(self, name: str) -> str:
        path = str(self._cfg(f"TAPIN_PATH_{name}", DEFAULT_PATHS[name]))
        return f"{self._v2_base()}/{path.lstrip('/')}"

    def _headers(self) -> dict[str, str]:
        token = self._cfg("TAPIN_TOKEN")
        return {
            "Authorization": str(token),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    # -- redaction ----------------------------------------------------------
    def _redact(self, value: Any) -> Any:
        secrets = [
            str(self._cfg("TAPIN_TOKEN", "") or ""),
            str(self._cfg("TAPIN_SHOP_ID", "") or ""),
        ]
        secrets = [s for s in secrets if len(s) >= 6]

        def scrub(text: str) -> str:
            for secret in secrets:
                text = text.replace(secret, "[REDACTED]")
            return re.sub(
                r"(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}",
                r"\1 [REDACTED]",
                text,
                flags=re.IGNORECASE,
            )

        def walk(node: Any) -> Any:
            if isinstance(node, str):
                return scrub(node)
            if isinstance(node, dict):
                return {k: walk(v) for k, v in node.items()}
            if isinstance(node, list):
                return [walk(v) for v in node]
            return node

        return walk(value)

    # -- HTTP ---------------------------------------------------------------
    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        """Call Tapin. The body is read BEFORE the status is judged, so the
        real Tapin error is never hidden by raise_for_status()."""
        try:
            if method == "GET":
                response = await client.get(url, headers=self._headers())
            else:
                response = await client.post(
                    url, headers=self._headers(), json=payload or {}
                )
        except httpx.TimeoutException as exc:
            raise TapinError(
                "TAPIN_TIMEOUT", "Tapin did not respond in time."
            ) from exc
        except httpx.RequestError as exc:
            raise TapinError(
                "TAPIN_NETWORK_ERROR",
                f"Could not reach Tapin ({type(exc).__name__}).",
            ) from exc

        status = response.status_code
        try:
            body = response.json()
        except Exception:
            body = None
        if body is None:
            snippet = ""
            try:
                snippet = (response.text or "")[:300]
            except Exception:
                snippet = ""
            body = {"raw": snippet} if snippet else {}

        body = self._redact(body)
        message = self._extract_message(body)

        if status in (401, 403):
            raise TapinError(
                "TAPIN_AUTH_ERROR",
                message or "Tapin rejected the credentials.",
                tapin=body,
                extra={"http_status": status},
            )
        if status < 200 or status >= 300:
            raise TapinError(
                f"TAPIN_HTTP_{status}",
                message or f"Tapin returned HTTP {status}.",
                tapin=body,
                extra={"http_status": status},
            )
        return body

    async def _read(self, client: httpx.AsyncClient, url: str, payload: dict[str, Any]) -> Any:
        """Read-only Tapin calls: POST first, fall back to GET on 405."""
        try:
            return await self._request(client, "POST", url, payload)
        except TapinError as exc:
            if exc.code == "TAPIN_HTTP_405":
                return await self._request(client, "GET", url)
            raise

    @staticmethod
    def _extract_message(body: Any) -> str | None:
        if not isinstance(body, dict):
            return None
        returns = body.get("returns")
        if isinstance(returns, dict) and returns.get("message"):
            return str(returns["message"])[:300]
        for key in ("message", "detail", "error"):
            if body.get(key) and isinstance(body[key], (str, int)):
                return str(body[key])[:300]
        return None

    # -- location -----------------------------------------------------------
    @staticmethod
    def _node_title(node: dict[str, Any]) -> str:
        return str(node.get("title") or node.get("name") or "").strip()

    @staticmethod
    def _node_code(node: dict[str, Any]) -> Any:
        for key in ("code", "pk", "id"):
            if node.get(key) is not None:
                return node[key]
        return None

    @staticmethod
    def _entry_list(data: Any) -> list[dict[str, Any]]:
        """Pull the list of dict items out of a Tapin list/tree response."""
        if isinstance(data, list):
            return [i for i in data if isinstance(i, dict)]
        if not isinstance(data, dict):
            return []
        for holder in (data.get("entries"), data.get("data"), data):
            if isinstance(holder, list):
                return [i for i in holder if isinstance(i, dict)]
            if isinstance(holder, dict):
                for key in ("states", "provinces", "cities", "boxes", "results", "list", "items", "children"):
                    if isinstance(holder.get(key), list):
                        return [i for i in holder[key] if isinstance(i, dict)]
        return []

    def _parse_tree(self, data: Any) -> list[dict[str, Any]]:
        provinces: list[dict[str, Any]] = []
        for node in self._entry_list(data):
            children = None
            for key in ("cities", "children", "city_list", "sub"):
                if isinstance(node.get(key), list):
                    children = node[key]
                    break
            code = self._node_code(node)
            title = self._node_title(node)
            if not title or code is None or children is None:
                continue
            cities = []
            for child in children:
                if not isinstance(child, dict):
                    continue
                c_code, c_title = self._node_code(child), self._node_title(child)
                if c_code is not None and c_title:
                    cities.append({"code": c_code, "title": c_title})
            provinces.append({"code": code, "title": title, "cities": cities})
        return provinces

    async def _load_locations(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        """state/tree first; state/list + city/list as fallback."""
        cached = _CACHE.get("locations")
        if cached and cached[0] > time.time():
            return cached[1]

        provinces: list[dict[str, Any]] = []
        try:
            tree = await self._read(client, self._url("STATE_TREE"), {})
            provinces = [p for p in self._parse_tree(tree) if p["cities"]]
        except TapinError as exc:
            if exc.code in ("TAPIN_AUTH_ERROR", "TAPIN_TIMEOUT", "TAPIN_NETWORK_ERROR"):
                raise
            provinces = []

        if not provinces:
            states = self._entry_list(await self._read(client, self._url("STATE_LIST"), {}))
            for state in states:
                s_code, s_title = self._node_code(state), self._node_title(state)
                if s_code is None or not s_title:
                    continue
                city_data = await self._read(
                    client, self._url("CITY_LIST"), {"state_code": s_code}
                )
                cities = []
                for city in self._entry_list(city_data):
                    c_code, c_title = self._node_code(city), self._node_title(city)
                    if c_code is not None and c_title:
                        cities.append({"code": c_code, "title": c_title})
                provinces.append({"code": s_code, "title": s_title, "cities": cities})

        if not provinces:
            raise TapinError(
                "TAPIN_LOCATION_UNAVAILABLE",
                "Tapin location data could not be loaded.",
            )
        _CACHE["locations"] = (time.time() + CACHE_TTL_SECONDS, provinces)
        return provinces

    def resolve_city(
        self,
        provinces: list[dict[str, Any]],
        city_name: str,
        province_name: str | None = None,
    ) -> dict[str, Any]:
        """Pure resolver. Never hard-codes any Tapin code."""
        target_city = _normalize_city(city_name)
        if not target_city:
            raise ValueError("destination_city is required.")

        scope = provinces
        if province_name and _normalize_province(province_name):
            target_prov = _normalize_province(province_name)
            scope = [p for p in provinces if _normalize_province(p["title"]) == target_prov]
            if not scope:
                raise TapinError(
                    "PROVINCE_NOT_FOUND",
                    "Destination province was not found in Tapin.",
                )

        matches = []
        for prov in scope:
            for city in prov["cities"]:
                if _normalize_city(city["title"]) == target_city:
                    matches.append(
                        {
                            "province_code": prov["code"],
                            "province_title": prov["title"],
                            "city_code": city["code"],
                            "city_title": city["title"],
                        }
                    )
        if not matches:
            raise TapinError("CITY_NOT_FOUND", "Destination city was not found in Tapin.")
        if len(matches) > 1:
            raise TapinError(
                "CITY_AMBIGUOUS",
                "Destination city name matches more than one Tapin city.",
                candidates=matches,
            )
        return matches[0]

    # -- box selection ------------------------------------------------------
    async def _load_boxes(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        cached = _CACHE.get("boxes")
        if cached and cached[0] > time.time():
            return cached[1]
        data = await self._read(client, self._url("PACKING_BOX"), {"shop_id": self._cfg("TAPIN_SHOP_ID")})
        boxes = []
        for item in self._entry_list(data):
            box_id = None
            for key in ("pk", "id", "box_id", "code"):
                if item.get(key) is not None:
                    box_id = item[key]
                    break
            dims = []
            for key in ("length", "width", "height"):
                try:
                    dims.append(float(item.get(key)))
                except (TypeError, ValueError):
                    dims = []
                    break
            try:
                bid = int(box_id)
            except (TypeError, ValueError):
                continue
            if len(dims) == 3 and all(d > 0 for d in dims):
                boxes.append({"id": bid, "dims": dims})
        if not boxes:
            raise TapinError(
                "TAPIN_BOX_LIST_INVALID",
                "Tapin packing-box list has no usable box dimensions.",
            )
        _CACHE["boxes"] = (time.time() + CACHE_TTL_SECONDS, boxes)
        return boxes

    @staticmethod
    def choose_box_id(boxes: list[dict[str, Any]], length: float, width: float, height: float) -> int | None:
        """Smallest box in 1..9 that holds the real package (rotation allowed).
        Returns None when no selectable box fits: the caller must then use the
        configured overflow box (TAPIN_OVERFLOW_BOX_ID) - no id is assumed here.
        Boxes 11..15 are never chosen."""
        pkg = sorted((float(length), float(width), float(height)))
        best = None
        for box in boxes:
            if box["id"] not in SELECTABLE_BOX_IDS:
                continue
            dims = sorted(box["dims"])
            if all(p <= d for p, d in zip(pkg, dims)):
                volume = dims[0] * dims[1] * dims[2]
                if best is None or volume < best[0]:
                    best = (volume, box["id"])
        return best[1] if best else None

    def _overflow_box_id(self) -> int:
        """Configured id of the 'more than 9' box. Never guessed."""
        raw = self._cfg("TAPIN_OVERFLOW_BOX_ID")
        if raw in (None, ""):
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "Package does not fit boxes 1..9 and TAPIN_OVERFLOW_BOX_ID is not configured.",
                extra={"missing_fields": ["TAPIN_OVERFLOW_BOX_ID"]},
            )
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError) as exc:
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "TAPIN_OVERFLOW_BOX_ID must be an integer.",
                extra={"invalid_fields": ["TAPIN_OVERFLOW_BOX_ID"]},
            ) from exc
        if value <= 0:
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "TAPIN_OVERFLOW_BOX_ID must be a positive integer.",
                extra={"invalid_fields": ["TAPIN_OVERFLOW_BOX_ID"]},
            )
        return value

    # -- request building ---------------------------------------------------
    def _int_setting(self, payload_value: Any, name: str, default: int) -> int:
        raw = payload_value if payload_value is not None else self._cfg(name, default)
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer.") from exc
        if value < 0:
            raise ValueError(f"{name} must not be negative.")
        return value

    def _weight_converter(self):
        unit = str(self._cfg("TAPIN_PACKAGE_WEIGHT_UNIT", "g")).strip().lower()
        # The current Tapin contract takes weight / package_weight as integer
        # GRAMS. A kg unit cannot be represented by an int field, so it is
        # rejected explicitly instead of being sent in a shape Tapin may
        # misread. Worker inputs are grams: no unit conversion happens here.
        if unit != "g":
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "TAPIN_PACKAGE_WEIGHT_UNIT must be 'g': the Tapin contract uses integer grams.",
                extra={"invalid_fields": ["TAPIN_PACKAGE_WEIGHT_UNIT"]},
            )
        return unit, lambda grams: int(round(float(grams)))

    @staticmethod
    def _positive_number(value: Any, name: str, allow_zero: bool = False) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be a number.") from exc
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError(f"{name} must be a finite number.")
        if number < 0 or (number == 0 and not allow_zero):
            raise ValueError(f"{name} must be greater than zero.")
        return number

    def _build_products(self, raw_products: list[Any], convert) -> tuple[list[dict[str, Any]], float]:
        products: list[dict[str, Any]] = []
        total_weight_grams = 0.0
        for index, item in enumerate(raw_products):
            if not isinstance(item, dict):
                raise ValueError(f"products[{index}] must be an object.")
            count = int(self._positive_number(item.get("count"), f"products[{index}].count"))
            price = int(self._positive_number(item.get("price"), f"products[{index}].price", allow_zero=True))
            discount = int(self._positive_number(item.get("discount", 0), f"products[{index}].discount", allow_zero=True))
            weight_g = self._positive_number(item.get("weight"), f"products[{index}].weight")
            title = str(item.get("title") or "").strip()
            if not title:
                raise ValueError(f"products[{index}].title is required.")
            product: dict[str, Any] = {
                "count": count,
                "discount": discount,
                "price": price,
                "title": title[: MAX_LEN["title"]],
                "weight": convert(weight_g),
            }
            # product_id is deliberately NOT forwarded: in the Tapin contract it
            # is Tapin's own catalogue id, which this store does not have. Any
            # id arriving from the Worker would be the store's internal id.
            # Without it the contract requires title / weight / price (sent).
            total_weight_grams += weight_g * count
            products.append(product)
        return products, total_weight_grams

    @staticmethod
    def _strict_int(value: Any, name: str, *, allow_negative: bool = False) -> int:
        """Integer field of the Tapin contract. Accepts int or a string of
        digits only; anything else is a configuration/contract error."""
        invalid = TapinError(
            "TAPIN_CONTRACT_INCOMPLETE",
            f"{name} must be an integer.",
            extra={"invalid_fields": [name]},
        )
        if isinstance(value, bool):
            raise invalid
        if isinstance(value, int):
            number = value
        elif isinstance(value, float) and value.is_integer():
            number = int(value)
        elif isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
            number = int(value.strip())
        else:
            raise invalid
        if number < 0 and not allow_negative:
            raise invalid
        return number

    def _recipient(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Estimate-time recipient. Real customer data is used if the payload
        carries it; otherwise operator-configured placeholders are used.
        Nothing is invented here."""
        override = payload.get("receiver") if isinstance(payload.get("receiver"), dict) else {}
        mapping = {
            "address": "TAPIN_QUOTE_ADDRESS",
            "first_name": "TAPIN_QUOTE_FIRST_NAME",
            "last_name": "TAPIN_QUOTE_LAST_NAME",
            "mobile": "TAPIN_QUOTE_MOBILE",
            "postal_code": "TAPIN_QUOTE_POSTAL_CODE",
            "phone": "TAPIN_QUOTE_PHONE",
            "email": "TAPIN_QUOTE_EMAIL",
            "description": "TAPIN_QUOTE_DESCRIPTION",
        }
        out: dict[str, Any] = {}
        for field, env_name in mapping.items():
            value = override.get(field)
            if value in (None, ""):
                value = self._cfg(env_name)
            if value not in (None, ""):
                out[field] = str(value)
        employee = override.get("employee_code") or self._cfg("TAPIN_EMPLOYEE_CODE")
        if employee not in (None, ""):
            out["employee_code"] = str(employee)
        return out

    # -- public API ---------------------------------------------------------
    async def get_quote(
        self,
        quote_request: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._ensure_enabled()

        if not quote_request:
            raise ValueError("Tapin quote request body is required.")

        destination_city = quote_request.get("destination_city")
        if not destination_city:
            raise ValueError("destination_city is required.")

        raw_products = quote_request.get("products") or []
        if not isinstance(raw_products, list) or not raw_products:
            raise ValueError("products is required.")

        try:
            return await self._get_quote(quote_request, destination_city, raw_products)
        except TapinError as exc:
            return exc.to_dict()

    async def _get_quote(
        self,
        quote_request: dict[str, Any],
        destination_city: str,
        raw_products: list[Any],
    ) -> dict[str, Any]:
        pay_type = self._int_setting(quote_request.get("pay_type"), "TAPIN_PAY_TYPE", DEFAULT_PAY_TYPE)
        order_type = self._int_setting(quote_request.get("order_type"), "TAPIN_ORDER_TYPE", DEFAULT_ORDER_TYPE)
        weight_unit, convert = self._weight_converter()

        products, _products_weight_g = self._build_products(raw_products, convert)

        length = self._positive_number(quote_request.get("length"), "length")
        width = self._positive_number(quote_request.get("width"), "width")
        height = self._positive_number(quote_request.get("height"), "height")
        package_weight_g = self._positive_number(
            quote_request.get("package_weight"), "package_weight", allow_zero=True
        )

        recipient = self._recipient(quote_request)
        required_recipient = ("address", "first_name", "last_name", "mobile", "postal_code", "employee_code")
        missing = [f for f in required_recipient if not recipient.get(f)]

        # packet_type is REQUIRED by the contract. The official sample uses 2
        # (package) but that is a sample, not a project value: it must come
        # from the request or from TAPIN_PACKET_TYPE.
        packet_raw = quote_request.get("packet_type")
        if packet_raw in (None, ""):
            packet_raw = self._cfg("TAPIN_PACKET_TYPE")
        if packet_raw in (None, ""):
            missing.append("packet_type")
        if missing:
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "Required Tapin check-price fields are not configured.",
                extra={"missing_fields": missing},
            )

        # Contract field lengths (address 300, first_name 30, last_name 40,
        # description 250). Values come from configuration / real receiver
        # data, so they are rejected - not silently cut - when too long.
        too_long = [
            f for f, limit in MAX_LEN.items()
            if f != "title" and recipient.get(f) and len(recipient[f]) > limit
        ]
        if too_long:
            raise TapinError(
                "TAPIN_CONTRACT_INCOMPLETE",
                "Some Tapin check-price fields exceed their maximum length.",
                extra={"invalid_fields": too_long},
            )
        postal_code = self._strict_int(recipient["postal_code"], "postal_code")
        employee_code = self._strict_int(recipient["employee_code"], "employee_code", allow_negative=True)

        packet_type = self._strict_int(packet_raw, "packet_type")

        # has_insurance is optional in check-price; it is sent only when an
        # operator configured a real value (TAPIN_HAS_INSURANCE = 0/1/true/false).
        insurance_raw = quote_request.get("has_insurance")
        if insurance_raw in (None, ""):
            insurance_raw = self._cfg("TAPIN_HAS_INSURANCE")
        has_insurance: int | None = None
        if insurance_raw not in (None, ""):
            text = str(insurance_raw).strip().lower()
            if text in ("1", "true", "yes", "on"):
                has_insurance = 1
            elif text in ("0", "false", "no", "off"):
                has_insurance = 0
            else:
                raise TapinError(
                    "TAPIN_CONTRACT_INCOMPLETE",
                    "has_insurance must be 0/1 or true/false.",
                    extra={"invalid_fields": ["has_insurance"]},
                )

        kiosk_raw = self._cfg("TAPIN_KIOSK_ID")
        kiosk_id = self._strict_int(kiosk_raw, "kiosk_id") if kiosk_raw not in (None, "") else None

        async with httpx.AsyncClient(timeout=self._cfg("HTTP_TIMEOUT_SECONDS", 15)) as client:
            provinces = await self._load_locations(client)
            location = self.resolve_city(
                provinces, destination_city, quote_request.get("destination_province")
            )
            boxes = await self._load_boxes(client)
            box_id = self.choose_box_id(boxes, length, width, height)
            if box_id is None:
                box_id = self._overflow_box_id()

            body: dict[str, Any] = {
                "shop_id": self._cfg("TAPIN_SHOP_ID"),
                "address": recipient["address"],
                "city_code": self._strict_int(location["city_code"], "city_code"),
                "province_code": self._strict_int(location["province_code"], "province_code"),
                "first_name": recipient["first_name"],
                "last_name": recipient["last_name"],
                "mobile": recipient["mobile"],
                "postal_code": postal_code,
                "employee_code": employee_code,
                "pay_type": pay_type,
                "order_type": order_type,
                "package_weight": convert(package_weight_g),
                "box_id": box_id,
                "packet_type": packet_type,
                "products": products,
            }
            for optional in ("description", "email", "phone"):
                if recipient.get(optional):
                    body[optional] = recipient[optional]
            if has_insurance is not None:
                body["has_insurance"] = has_insurance
            if kiosk_id is not None:
                body["kiosk_id"] = kiosk_id

            data = await self._request(client, "POST", self._url("CHECK_PRICE"), body)

        return self._normalize_quote_response(
            data,
            location,
            sent={
                "box_id": box_id,
                "packet_type": packet_type,
                "package_weight": body["package_weight"],
                "weight_unit": weight_unit,
                "products_weight_grams": _products_weight_g,
                "pay_type": pay_type,
                "order_type": order_type,
            },
        )

    async def track_shipment(self, *args, **kwargs) -> dict[str, Any]:
        raise IntegrationDisabledError(
            "Tapin tracking is not part of the current implementation stage."
        )

    @staticmethod
    def _normalize_quote_response(
        data: Any,
        location: dict[str, Any],
        sent: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise TapinError("TAPIN_INVALID_RESPONSE", "Tapin returned an invalid response.")

        returns = data.get("returns")
        if isinstance(returns, dict):
            status = returns.get("status")
            if returns.get("success") is False or (
                isinstance(status, int) and status not in (200, 201)
            ):
                code = "TAPIN_AUTH_ERROR" if status in (401, 403) else f"TAPIN_{status if status is not None else 'ERROR'}"
                raise TapinError(
                    code,
                    str(returns.get("message") or "Tapin returned an error.")[:300],
                    tapin=data,
                )

        entries = data.get("entries")
        if not isinstance(entries, dict) or entries.get("total_send_price") is None:
            raise TapinError(
                "TAPIN_PRICE_NOT_FOUND",
                "Tapin response does not contain entries.total_send_price.",
                tapin=data,
            )
        try:
            price = float(entries["total_send_price"])
        except (TypeError, ValueError):
            price = float("nan")
        if price != price or price <= 0:
            raise TapinError(
                "TAPIN_PRICE_INVALID",
                "Tapin returned a non-positive or non-numeric shipping price.",
                tapin=data,
            )

        keep = ("send_price", "total_send_price", "total_service_price", "total_price", "total_weight")
        return {
            "ok": True,
            "entries": {k: entries[k] for k in keep if k in entries},
            "matched_city": {
                "province_code": location["province_code"],
                "province_title": location["province_title"],
                "city_code": location["city_code"],
                "city_title": location["city_title"],
            },
            "sent": sent or {},
        }
