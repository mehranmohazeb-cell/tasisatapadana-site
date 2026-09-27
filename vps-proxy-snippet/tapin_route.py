# =============================================================================
# پیشنهاد Route جدید برای Integration Proxy (VPS) — apadana-payment-proxy
# =============================================================================
# ⚠️ هشدار صادقانه (مهم‌تر از خود کد):
#   این فایل در این Sandbox نوشته شده، اما:
#     - هرگز روی VPS واقعی (45.94.214.232) اجرا/تست نشده.
#     - این Sandbox هیچ دسترسی SSH یا اینترنتی به VPS یا هیچ سرور دیگری ندارد
#       (شبکه این محیط کاملاً غیرفعال است) — بنابراین امکان نداشت کد واقعی
#       Proxy موجود روی VPS بررسی، تأیید یا مستقیماً ویرایش شود.
#     - این فایل فقط یک "پیشنهاد حداقلی و امن" برای تکمیل هدف بخش ۶ دستور
#       است؛ باید توسط کسی با دسترسی واقعی SSH به VPS بررسی، با ساختار واقعی
#       apadana-payment-proxy (main.py/routers فعلی آن) هماهنگ، و بعد از تست
#       واقعی Deploy شود. آن را مستقیماً و بدون بازبینی روی Production اجرا نکنید.
#
# قرارداد این Route با Worker (دقیقاً همانی که src/shipping-engine.js انتظار دارد):
#   POST /tapin/request
#   Header:  Authorization: Bearer <PROXY_API_KEY>
#   Body:    { "path": "<یکی از ۳ مسیر مجاز Tapin>", "body": {...}, "authorization": "<Header Authorization برای Tapin>" }
#   پاسخ موفق: دقیقاً همان JSON خام Tapin (Passthrough) با همان کد وضعیت.
#   پاسخ خطای سطح Proxy: { "proxy_error": true, "message": "..." } + کد وضعیت غیر ۲xx مناسب.
#
# اصول امنیتی رعایت‌شده (طبق بخش ۱۷ دستور):
#   - مقصد Tapin ثابت/Allowlisted است (TAPIN_API_BASE + مسیرهای مجاز)؛ هیچ URL
#     دلخواهی از Worker پذیرفته نمی‌شود.
#   - این Route هرگز به Open Proxy تبدیل نمی‌شود — فقط همین ۳ مسیر مجاز است.
#   - Authorization واقعی Tapin هرگز Log یا در پاسخ خطا تکرار نمی‌شود.
#   - احراز هویت Worker→Proxy از PROXY_API_KEY (مقداری که این سرویس از قبل
#     دارد) استفاده می‌کند — همان الگویی که در health/سایر Route های موجود
#     Proxy توضیح داده شده (بخش ۵ دستور).
# =============================================================================

import os
import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

TAPIN_API_BASE = "https://api.tapin.ir/api/v4"

# فقط همین ۳ مسیر مستندشده در این مرحله مجازند — هیچ مسیر دیگری Forward نمی‌شود.
ALLOWED_TAPIN_PATHS = {
    "/location/public/all/province/filter/",
    "/location/public/all/city/filter/",
    "/tipax/public/user/order/check-price/",
}

# همان مقداری که سایر Endpointهای غیر-health این Proxy برای احراز هویت
# استفاده می‌کنند (بخش ۵ دستور) — از Environment سرویس خوانده می‌شود، نه Hardcode.
PROXY_API_KEY = os.environ.get("PROXY_API_KEY")


class TapinProxyRequest(BaseModel):
    path: str
    body: dict
    authorization: str


@router.post("/tapin/request")
async def tapin_proxy_request(
    payload: TapinProxyRequest,
    authorization: str = Header(default=None),
):
    # ۱) احراز هویت Worker → Proxy
    if not PROXY_API_KEY or authorization != f"Bearer {PROXY_API_KEY}":
        raise HTTPException(status_code=401, detail={"proxy_error": True, "message": "Unauthorized"})

    # ۲) Allowlist مقصد — مقصد Tapin هرگز از ورودی دلخواه ساخته نمی‌شود.
    if payload.path not in ALLOWED_TAPIN_PATHS:
        raise HTTPException(
            status_code=403,
            detail={"proxy_error": True, "message": "مسیر درخواستی خارج از Allowlist مجاز Tapin است."},
        )

    # ۳) Forward امن به Tapin از همین VPS (IP ثابت مجاز نزد Tapin).
    #    Authorization واقعی Tapin هرگز Log نمی‌شود.
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            tapin_response = await client.post(
                f"{TAPIN_API_BASE}{payload.path}",
                json=payload.body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": payload.authorization,
                },
            )
    except httpx.RequestError as exc:
        # پیام خطا صرفاً نوع خطا را می‌گوید؛ هیچ Header/Secret در آن نیست.
        raise HTTPException(
            status_code=502,
            detail={"proxy_error": True, "message": f"عدم دسترسی به Tapin: {type(exc).__name__}"},
        )

    # ۴) Passthrough خام پاسخ Tapin — بدون تغییر، تا منطق تفسیر سمت Worker
    #    (بررسی returns.status) دقیقاً همان‌طور که هست کار کند.
    try:
        tapin_json = tapin_response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail={"proxy_error": True, "message": "پاسخ Tapin به‌صورت JSON قابل‌خواندن نبود."},
        )

    return JSONResponse(content=tapin_json, status_code=tapin_response.status_code)
