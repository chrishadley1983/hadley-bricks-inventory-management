"""HTTP client for calling the Vercel approve endpoint."""

import logging

import httpx

from src.config import APP_BASE_URL, INTERNAL_API_KEY

log = logging.getLogger(__name__)

TIMEOUT = 120  # Enrichment (ASIN + Brickset + pricing) can be slow


def approve_item(item_id: str, items: list[dict]) -> dict | None:
    """Call the approve endpoint to create purchase + inventory records.

    Args:
        item_id: The processed_purchase_emails row ID.
        items: List of dicts with set_number and condition keys.

    Returns:
        Response JSON on success, None on failure.
    """
    url = f"{APP_BASE_URL}/api/purchases/review-queue/{item_id}/approve"
    payload = {"items": items}

    try:
        response = httpx.post(
            url,
            json=payload,
            headers={"x-api-key": INTERNAL_API_KEY},
            timeout=TIMEOUT,
        )

        if response.status_code == 200:
            data = response.json()
            log.info("Approved item %s: %s", item_id, data)
            return data
        else:
            log.error(
                "Approve failed for %s: %d — %s",
                item_id,
                response.status_code,
                response.text[:300],
            )
            return None

    except httpx.TimeoutException:
        log.error("Approve request timed out for item %s", item_id)
        return None
    except httpx.HTTPError as e:
        log.error("HTTP error approving item %s: %s", item_id, e)
        return None
