import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from auth import require_api_key
from config import Settings
from integrations.base import IntegrationDisabledError
from integrations.tapin import TapinAdapter

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/tapin",
    tags=["tapin"],
    dependencies=[Depends(require_api_key)],
)


def _settings() -> Settings:
    return Settings()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Controlled error body. Never contains tokens, secrets or stack traces."""
    return JSONResponse(
        status_code=status_code,
        content={"ok": False, "error_code": code, "message": message},
    )


@router.get("/status")
async def status():
    settings = _settings()
    return {
        "integration": "tapin",
        "enabled": settings.TAPIN_ENABLED,
    }


@router.post("/quote")
async def quote(request: Request):
    settings = _settings()
    adapter = TapinAdapter(settings)

    try:
        payload: dict[str, Any] = await request.json()
    except Exception:
        return _error(400, "TAPIN_BAD_REQUEST", "Invalid JSON request body.")

    if not isinstance(payload, dict) or not payload:
        return _error(400, "TAPIN_BAD_REQUEST", "Tapin quote request body is required.")

    try:
        # Business errors (CITY_NOT_FOUND, CITY_AMBIGUOUS, TAPIN_HTTP_400,
        # TAPIN_AUTH_ERROR, TAPIN_TIMEOUT, TAPIN_PRICE_NOT_FOUND,
        # TAPIN_CONTRACT_INCOMPLETE ...) come back from the adapter as
        # {"ok": false, "error_code", "message"} with HTTP 200 so the Worker
        # receives the exact code.
        return await adapter.get_quote(payload)

    except IntegrationDisabledError as exc:
        return _error(501, "TAPIN_DISABLED", str(exc))

    except ValueError as exc:
        # ValueError messages are written by this project and contain no secrets.
        return _error(400, "TAPIN_BAD_REQUEST", str(exc))

    except Exception as exc:  # noqa: BLE001 - last-resort guard, no trace returned
        logger.error("Tapin quote failed: %s", type(exc).__name__)
        return _error(502, "TAPIN_INTERNAL_ERROR", "Unexpected error while contacting Tapin.")


@router.post("/track")
async def track(request: Request):
    settings = _settings()
    adapter = TapinAdapter(settings)

    try:
        payload: dict[str, Any] = await request.json()
    except Exception:
        payload = {}

    try:
        return await adapter.track_shipment(**payload)

    except IntegrationDisabledError as exc:
        return _error(501, "TAPIN_DISABLED", str(exc))

    except TypeError:
        return _error(400, "TAPIN_BAD_REQUEST", "Invalid track request body.")
