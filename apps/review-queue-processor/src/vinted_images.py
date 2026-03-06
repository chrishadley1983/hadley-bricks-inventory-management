"""Vinted image fetcher — extract listing photos from Vinted inbox conversations."""

import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)

PROFILE_DIR = Path(__file__).resolve().parent.parent / ".browser-profile"
IMAGE_DIR = Path(__file__).resolve().parent.parent / "tmp" / "images"
VINTED_INBOX_URL = "https://www.vinted.co.uk/inbox"

MAX_IMAGES_PER_LISTING = 5


def _ensure_dirs() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def _clean_old_images(seller: str) -> None:
    """Remove previous images for this seller to avoid stale data."""
    for f in IMAGE_DIR.glob(f"{seller}_*.png"):
        f.unlink()


def fetch_listing_images(
    seller_username: str,
    item_name: str = "",
) -> list[str]:
    """Fetch listing images from a Vinted inbox conversation.

    Navigates to the Vinted inbox, finds the conversation with the seller,
    locates the listing, and screenshots/downloads the listing images.

    Args:
        seller_username: Vinted seller username to find in inbox.
        item_name: Item name for matching (optional, for disambiguation).

    Returns:
        List of file paths to downloaded images (PNG). Empty list on failure.
    """
    from playwright.sync_api import sync_playwright

    _ensure_dirs()
    _clean_old_images(seller_username)

    if not (PROFILE_DIR / "Default").exists():
        log.error(
            "No browser session found. Run dry_run.py --login first to authenticate."
        )
        return []

    images: list[str] = []

    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                str(PROFILE_DIR),
                channel="chrome",
                headless=True,
                viewport={"width": 1280, "height": 900},
            )
            page = context.pages[0] if context.pages else context.new_page()

            try:
                images = _navigate_and_capture(page, seller_username, item_name)
            finally:
                context.close()

    except Exception as e:
        log.error("Playwright error fetching images for %s: %s", seller_username, e)

    log.info(
        "Fetched %d images for seller %s (%s)",
        len(images),
        seller_username,
        item_name,
    )
    return images


def _navigate_and_capture(page, seller_username: str, item_name: str) -> list[str]:
    """Core navigation logic — separated for cleaner error handling."""
    images: list[str] = []

    # Step 1: Navigate to inbox
    page.goto(VINTED_INBOX_URL, wait_until="networkidle", timeout=30_000)
    time.sleep(2)

    # Check for session expiry
    if "login" in page.url.lower():
        log.error("Vinted session expired — run dry_run.py --login to re-authenticate")
        return []

    # Step 2: Find the conversation with this seller
    if not _find_and_open_conversation(page, seller_username):
        log.warning("Could not find conversation with %s in inbox", seller_username)
        return []

    time.sleep(2)

    # Step 3: Find and navigate to the listing page
    listing_url = _find_listing_link(page)
    if listing_url:
        log.info("Found listing link: %s", listing_url)
        page.goto(listing_url, wait_until="networkidle", timeout=30_000)
        time.sleep(2)
        images = _capture_listing_images(page, seller_username)
    else:
        # Fallback: screenshot any images visible in the conversation
        log.info("No listing link found — capturing conversation images")
        images = _capture_conversation_images(page, seller_username)

    return images


def _find_and_open_conversation(page, seller_username: str) -> bool:
    """Find and click the conversation with the seller in the inbox.

    Returns True if conversation was opened successfully.
    """
    # Strategy A: Look for seller name in visible conversation list
    conversations = page.query_selector_all(
        '[class*="conversation"], [data-testid*="conversation"], '
        'a[href*="/inbox/"]'
    )

    for conv in conversations:
        text = (conv.text_content() or "").lower()
        if seller_username.lower() in text:
            conv.click()
            time.sleep(3)
            return True

    # Strategy B: Try search if available
    search_input = page.query_selector(
        'input[type="search"], input[placeholder*="Search"], '
        '[data-testid*="search"]'
    )
    if search_input:
        search_input.fill(seller_username)
        search_input.press("Enter")
        time.sleep(3)

        conversations = page.query_selector_all(
            '[class*="conversation"], a[href*="/inbox/"]'
        )
        for conv in conversations:
            text = (conv.text_content() or "").lower()
            if seller_username.lower() in text:
                conv.click()
                time.sleep(3)
                return True

    # Strategy C: Try scrolling the conversation list
    inbox_container = page.query_selector(
        '[class*="inbox-list"], [class*="conversation-list"], '
        '[role="list"]'
    )
    if inbox_container:
        for _ in range(5):
            inbox_container.evaluate("el => el.scrollTop += 500")
            time.sleep(1)
            conversations = page.query_selector_all('a[href*="/inbox/"]')
            for conv in conversations:
                text = (conv.text_content() or "").lower()
                if seller_username.lower() in text:
                    conv.click()
                    time.sleep(3)
                    return True

    return False


def _find_listing_link(page) -> str | None:
    """Find the listing URL from within a conversation."""
    # Look for item/listing links in conversation messages
    item_links = page.query_selector_all('a[href*="/items/"], a[href*="/item/"]')
    if item_links:
        href = item_links[0].get_attribute("href") or ""
        if href.startswith("/"):
            href = f"https://www.vinted.co.uk{href}"
        return href

    # Look for transaction/order cards which might contain listing references
    transaction_cards = page.query_selector_all(
        '[class*="transaction"], [class*="order"], [class*="item-box"]'
    )
    for card in transaction_cards:
        link = card.query_selector("a[href]")
        if link:
            href = link.get_attribute("href") or ""
            if "/items/" in href or "/item/" in href:
                if href.startswith("/"):
                    href = f"https://www.vinted.co.uk{href}"
                return href

    return None


def _capture_listing_images(page, seller_username: str) -> list[str]:
    """Capture images from a Vinted listing page."""
    images: list[str] = []

    # Find listing photos — Vinted uses image galleries/carousels
    img_selectors = [
        'img[src*="images.vinted.net"]',
        '[class*="gallery"] img',
        '[class*="carousel"] img',
        '[class*="photo"] img',
        'img[class*="item-photo"]',
    ]

    seen_srcs: set[str] = set()
    img_elements = []

    for selector in img_selectors:
        elements = page.query_selector_all(selector)
        for el in elements:
            src = el.get_attribute("src") or ""
            # Filter to actual listing photos (not avatars, icons, etc.)
            if (
                "images.vinted.net" in src
                and src not in seen_srcs
                and "avatar" not in src.lower()
                and "icon" not in src.lower()
            ):
                seen_srcs.add(src)
                img_elements.append(el)

    log.info("Found %d unique listing images on listing page", len(img_elements))

    for i, img in enumerate(img_elements[:MAX_IMAGES_PER_LISTING]):
        img_path = IMAGE_DIR / f"{seller_username}_{i}.png"
        try:
            img.screenshot(path=str(img_path))
            images.append(str(img_path))
            log.info("Saved listing image: %s", img_path.name)
        except Exception as e:
            log.warning("Failed to screenshot listing image %d: %s", i, e)

    # If element screenshots failed, try full-page screenshot as fallback
    if not images:
        fallback_path = IMAGE_DIR / f"{seller_username}_fullpage.png"
        page.screenshot(path=str(fallback_path), full_page=True)
        images.append(str(fallback_path))
        log.info("Saved full-page fallback screenshot: %s", fallback_path.name)

    return images


def _capture_conversation_images(page, seller_username: str) -> list[str]:
    """Capture any listing-related images visible in the conversation thread."""
    images: list[str] = []

    img_elements = page.query_selector_all(
        'img[src*="vinted"], img[class*="item"], img[class*="product"]'
    )

    seen_srcs: set[str] = set()
    for i, img in enumerate(img_elements[:MAX_IMAGES_PER_LISTING]):
        src = img.get_attribute("src") or ""
        if src in seen_srcs or "avatar" in src.lower():
            continue
        seen_srcs.add(src)

        img_path = IMAGE_DIR / f"{seller_username}_conv_{i}.png"
        try:
            img.screenshot(path=str(img_path))
            images.append(str(img_path))
        except Exception as e:
            log.warning("Failed to screenshot conversation image %d: %s", i, e)

    # Fallback: screenshot the full conversation
    if not images:
        fallback_path = IMAGE_DIR / f"{seller_username}_conv_full.png"
        page.screenshot(path=str(fallback_path), full_page=True)
        images.append(str(fallback_path))

    return images
