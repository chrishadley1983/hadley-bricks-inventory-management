"""Dry-run script — explore Vinted inbox with Playwright and screenshot listing images.

Usage:
    python dry_run.py                     # Run against all skipped Vinted items
    python dry_run.py --seller "username" # Run against a single seller
    python dry_run.py --headed            # Run with visible browser (for debugging)

First run: launches headed browser for manual Vinted login.
Subsequent runs: reuses saved session from persistent profile directory.
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# Load env so we can optionally query Supabase for skipped items
load_dotenv(Path(__file__).resolve().parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Persistent browser profile so Vinted login survives across runs
PROFILE_DIR = Path(__file__).resolve().parent / ".browser-profile"
OUTPUT_DIR = Path(__file__).resolve().parent / "tmp" / "dry_run"

VINTED_INBOX_URL = "https://www.vinted.co.uk/inbox"


def ensure_dirs() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def is_first_run() -> bool:
    """Check if the browser profile has been initialised (i.e. user has logged in)."""
    # Chromium creates a 'Default' folder after first launch
    return not (PROFILE_DIR / "Default").exists()


def fetch_skipped_vinted_sellers() -> list[dict]:
    """Fetch skipped Vinted items from Supabase to get seller usernames."""
    try:
        from supabase import create_client

        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            log.warning("Supabase credentials not set — provide --seller manually")
            return []

        client = create_client(url, key)
        response = (
            client.table("processed_purchase_emails")
            .select("id, seller_username, item_name, cost, source, email_subject")
            .eq("status", "skipped")
            .eq("source", "Vinted")
            .not_.is_("seller_username", "null")
            .order("email_date", desc=True)
            .limit(10)
            .execute()
        )
        return response.data or []
    except Exception as e:
        log.warning("Could not fetch from Supabase: %s", e)
        return []


def run_first_time_login() -> None:
    """Launch headed browser and pause for manual Vinted login."""
    from playwright.sync_api import sync_playwright

    log.info("=== FIRST-TIME SETUP: Manual Vinted login required ===")
    log.info("Browser profile dir: %s", PROFILE_DIR)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.vinted.co.uk/member/login")

        print("\n" + "=" * 60)
        print("  Log in to Vinted in the browser window.")
        print("  Once logged in, go to your inbox to confirm it works.")
        print("  Then come back here and press ENTER to save the session.")
        print("=" * 60 + "\n")

        input("Press ENTER when done...")

        context.close()

    log.info("Session saved. Re-run the script to start the dry run.")


def explore_inbox(
    sellers: list[dict],
    headed: bool = False,
) -> list[dict]:
    """Navigate Vinted inbox, find conversations with sellers, screenshot listing images.

    Returns a list of result dicts with keys: seller, item_name, images, selectors, notes.
    """
    from playwright.sync_api import sync_playwright

    results = []

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            channel="chrome",
            headless=not headed,
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        for seller_info in sellers:
            seller = seller_info if isinstance(seller_info, str) else seller_info.get("seller_username", "")
            item_name = seller_info.get("item_name", "") if isinstance(seller_info, dict) else ""

            log.info("--- Exploring seller: %s (item: %s) ---", seller, item_name)
            result = {
                "seller": seller,
                "item_name": item_name,
                "images": [],
                "selectors": [],
                "notes": [],
            }

            try:
                # Step 1: Go to inbox
                page.goto(VINTED_INBOX_URL, wait_until="networkidle", timeout=30_000)
                time.sleep(2)

                # Check if we're redirected to login
                if "login" in page.url.lower():
                    log.error("Session expired — need to re-login. Run without arguments first.")
                    result["notes"].append("SESSION_EXPIRED")
                    results.append(result)
                    break

                # Screenshot the inbox page
                inbox_screenshot = OUTPUT_DIR / f"inbox_{seller}.png"
                page.screenshot(path=str(inbox_screenshot))
                log.info("Inbox screenshot saved: %s", inbox_screenshot)

                # Step 2: Look for the conversation with this seller
                # Vinted inbox has a search/filter or we scroll to find the seller
                # Try clicking on a conversation that mentions the seller name
                conversation_found = False

                # Strategy A: Look for the seller name in conversation list
                # Vinted conversations show the other party's username
                conversation_links = page.query_selector_all('[class*="conversation"], [data-testid*="conversation"], a[href*="/inbox/"]')
                log.info("Found %d conversation-like elements", len(conversation_links))
                result["selectors"].append(f"conversation_links: {len(conversation_links)} elements")

                # Try to find the seller's conversation by text content
                for link in conversation_links:
                    text = link.text_content() or ""
                    if seller.lower() in text.lower():
                        log.info("Found conversation with seller: %s", seller)
                        link.click()
                        conversation_found = True
                        time.sleep(3)
                        break

                if not conversation_found:
                    # Strategy B: Try the search functionality if available
                    search_input = page.query_selector('input[type="search"], input[placeholder*="Search"], [data-testid*="search"]')
                    if search_input:
                        log.info("Found search input — searching for seller: %s", seller)
                        search_input.fill(seller)
                        search_input.press("Enter")
                        time.sleep(3)

                        # Check for results
                        conversation_links = page.query_selector_all('[class*="conversation"], a[href*="/inbox/"]')
                        for link in conversation_links:
                            text = link.text_content() or ""
                            if seller.lower() in text.lower():
                                link.click()
                                conversation_found = True
                                time.sleep(3)
                                break

                if not conversation_found:
                    log.warning("Could not find conversation with seller: %s", seller)
                    result["notes"].append("CONVERSATION_NOT_FOUND")

                    # Screenshot current state for debugging
                    debug_screenshot = OUTPUT_DIR / f"debug_not_found_{seller}.png"
                    page.screenshot(path=str(debug_screenshot))
                    result["images"].append(str(debug_screenshot))

                    # Log all visible text for debugging selectors
                    all_links = page.query_selector_all("a")
                    visible_texts = []
                    for a in all_links[:20]:
                        href = a.get_attribute("href") or ""
                        txt = (a.text_content() or "").strip()[:80]
                        if txt:
                            visible_texts.append(f"  {txt} → {href}")
                    if visible_texts:
                        log.info("Visible links on page:\n%s", "\n".join(visible_texts))

                    results.append(result)
                    continue

                # Step 3: Inside the conversation — find listing images
                conv_screenshot = OUTPUT_DIR / f"conversation_{seller}.png"
                page.screenshot(path=str(conv_screenshot), full_page=True)
                log.info("Conversation screenshot: %s", conv_screenshot)
                result["images"].append(str(conv_screenshot))

                # Look for listing card / item link in the conversation
                # Vinted conversations typically have a transaction card with the item
                listing_images = page.query_selector_all(
                    'img[class*="item"], img[class*="listing"], '
                    'img[class*="product"], img[class*="photo"], '
                    '[class*="transaction"] img, '
                    '[class*="item-box"] img, '
                    '[class*="message"] img[src*="vinted"]'
                )
                log.info("Found %d potential listing images in conversation", len(listing_images))
                result["selectors"].append(f"listing_images: {len(listing_images)} elements")

                # Also look for item links that might lead to the listing page
                item_links = page.query_selector_all(
                    'a[href*="/items/"], a[href*="/item/"]'
                )
                log.info("Found %d item links", len(item_links))

                # Screenshot each listing image
                for i, img in enumerate(listing_images[:5]):
                    src = img.get_attribute("src") or ""
                    alt = img.get_attribute("alt") or ""
                    log.info("  Image %d: src=%s alt=%s", i, src[:100], alt[:50])

                    # Try to get the full-size image
                    img_screenshot = OUTPUT_DIR / f"listing_img_{seller}_{i}.png"
                    try:
                        img.screenshot(path=str(img_screenshot))
                        result["images"].append(str(img_screenshot))
                    except Exception as e:
                        log.warning("Could not screenshot image %d: %s", i, e)

                # If we found item links, try clicking to the listing page
                if item_links:
                    first_link = item_links[0]
                    href = first_link.get_attribute("href") or ""
                    log.info("Navigating to listing page: %s", href)

                    # Open in same tab
                    first_link.click()
                    time.sleep(3)

                    # Screenshot the listing page
                    listing_screenshot = OUTPUT_DIR / f"listing_page_{seller}.png"
                    page.screenshot(path=str(listing_screenshot), full_page=True)
                    result["images"].append(str(listing_screenshot))
                    log.info("Listing page screenshot: %s", listing_screenshot)

                    # Find all listing photos on the listing page
                    listing_page_images = page.query_selector_all(
                        '[class*="gallery"] img, '
                        '[class*="carousel"] img, '
                        '[class*="photo"] img, '
                        'img[class*="item-photo"], '
                        'img[src*="images.vinted.net"]'
                    )
                    log.info("Found %d images on listing page", len(listing_page_images))
                    result["selectors"].append(f"listing_page_images: {len(listing_page_images)} elements")

                    for i, img in enumerate(listing_page_images[:5]):
                        src = img.get_attribute("src") or ""
                        log.info("  Listing image %d: %s", i, src[:120])

                        # Try to get the full-resolution URL
                        # Vinted uses different size suffixes — look for largest
                        if "images.vinted.net" in src:
                            result["notes"].append(f"IMAGE_URL_{i}: {src}")

                        img_path = OUTPUT_DIR / f"listing_photo_{seller}_{i}.png"
                        try:
                            img.screenshot(path=str(img_path))
                            result["images"].append(str(img_path))
                        except Exception as e:
                            log.warning("Could not screenshot listing image %d: %s", i, e)

                    # Go back to inbox for next seller
                    page.go_back()
                    time.sleep(2)
                    page.go_back()
                    time.sleep(2)

            except Exception as e:
                log.error("Error exploring seller %s: %s", seller, e)
                result["notes"].append(f"ERROR: {e}")

                # Screenshot error state
                try:
                    error_screenshot = OUTPUT_DIR / f"error_{seller}.png"
                    page.screenshot(path=str(error_screenshot))
                    result["images"].append(str(error_screenshot))
                except Exception:
                    pass

            results.append(result)

        context.close()

    return results


def print_summary(results: list[dict]) -> None:
    """Print a summary of the dry run findings."""
    log.info("\n=== DRY RUN SUMMARY ===\n")
    for r in results:
        log.info("Seller: %s", r["seller"])
        log.info("  Item: %s", r["item_name"])
        log.info("  Images found: %d", len(r["images"]))
        log.info("  Selectors: %s", r["selectors"])
        if r["notes"]:
            log.info("  Notes:")
            for note in r["notes"]:
                log.info("    - %s", note)
        log.info("")

    # Write findings to a markdown file
    findings_path = OUTPUT_DIR / "findings.md"
    with open(findings_path, "w", encoding="utf-8") as f:
        f.write("# Vinted Inbox Dry Run Findings\n\n")
        f.write(f"Date: {time.strftime('%Y-%m-%d %H:%M')}\n\n")
        for r in results:
            f.write(f"## Seller: {r['seller']}\n")
            f.write(f"- Item: {r['item_name']}\n")
            f.write(f"- Images: {len(r['images'])}\n")
            f.write(f"- Selectors: {r['selectors']}\n")
            if r["notes"]:
                f.write("- Notes:\n")
                for note in r["notes"]:
                    f.write(f"  - {note}\n")
            f.write("\n")

    log.info("Findings written to: %s", findings_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Vinted inbox dry-run explorer")
    parser.add_argument("--seller", help="Single seller username to explore")
    parser.add_argument("--headed", action="store_true", help="Run with visible browser")
    parser.add_argument("--login", action="store_true", help="Force login flow (re-authenticate)")
    args = parser.parse_args()

    ensure_dirs()

    # First-time login flow
    if args.login or is_first_run():
        run_first_time_login()
        if is_first_run():
            return

    # Build seller list
    if args.seller:
        sellers = [{"seller_username": args.seller, "item_name": "Manual test"}]
    else:
        sellers = fetch_skipped_vinted_sellers()
        if not sellers:
            log.error("No sellers to explore. Use --seller <username> or check Supabase connection.")
            sys.exit(1)

    log.info("Will explore %d seller(s)", len(sellers))
    for s in sellers:
        log.info("  - %s (%s)", s.get("seller_username"), s.get("item_name", ""))

    results = explore_inbox(sellers, headed=args.headed)
    print_summary(results)


if __name__ == "__main__":
    main()
