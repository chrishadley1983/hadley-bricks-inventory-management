"""
Newsletter scraper: checks for new school newsletters, downloads PDFs,
extracts key dates using Claude, and saves to school_events table.

Run weekly (e.g. Friday evening after newsletters typically publish).
"""
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, date

import fitz  # pymupdf
import httpx
from bs4 import BeautifulSoup
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from config import (
    SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY,
    SCHOOL_WEBSITE, NEWSLETTERS_URL, CHILDREN
)


def get_newsletter_links():
    """Scrape the newsletters page for PDF links."""
    resp = httpx.get(NEWSLETTERS_URL, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    newsletters = []
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if not href.endswith(".pdf"):
            continue
        if "letter" in href.lower() or "friday" in href.lower() or "Documents/Letters" in href:
            full_url = href if href.startswith("http") else f"{SCHOOL_WEBSITE}{href}"
            text = link.get_text(strip=True)
            newsletters.append({"url": full_url, "title": text})

    # Also check for any PDF links in the page
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if href.endswith(".pdf") and "Documents/Letters" in href:
            full_url = href if href.startswith("http") else f"{SCHOOL_WEBSITE}{href}"
            text = link.get_text(strip=True)
            if not any(n["url"] == full_url for n in newsletters):
                newsletters.append({"url": full_url, "title": text})

    return newsletters


def extract_date_from_title(title: str) -> date | None:
    """Try to parse a date from a newsletter title like 'Newsletter 27 February'."""
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
        "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    }
    title_lower = title.lower()
    for month_name, month_num in months.items():
        if month_name in title_lower:
            # Find a day number near the month
            day_match = re.search(r"(\d{1,2})", title_lower[:title_lower.index(month_name) + len(month_name) + 5])
            if day_match:
                day = int(day_match.group(1))
                # Guess year based on month
                year = 2026 if month_num <= 7 else 2025
                try:
                    return date(year, month_num, day)
                except ValueError:
                    pass
    return None


def download_pdf(url: str) -> bytes | None:
    """Download a PDF and return its bytes."""
    try:
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 100:
            return resp.content
    except Exception as e:
        print(f"  Error downloading {url}: {e}")
    return None


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pymupdf."""
    tmp_path = os.path.join(tempfile.gettempdir(), f"school_nl_{os.getpid()}.pdf")
    with open(tmp_path, "wb") as f:
        f.write(pdf_bytes)
    try:
        doc = fitz.open(tmp_path)
        text = ""
        for page in doc:
            text += page.get_text() + "\n"
        doc.close()
        return text
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def extract_events_with_claude(newsletter_text: str, newsletter_date: str) -> list[dict]:
    """Use Claude to extract key dates and events from newsletter text."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Extract ALL upcoming dates and events from this school newsletter.
For each event, provide:
- event_date: in YYYY-MM-DD format
- event_name: short descriptive name
- event_type: one of: trip, assembly, inset, parent_meeting, concert, sport, celebration, science, fundraiser, general
- year_groups: array of affected year groups like ["Year 2", "Year 4"] or [] for whole school
- requires_action: one of: consent, payment, costume, kit, or null if none
- notes: any additional details

IMPORTANT RULES:
- The newsletter is dated {newsletter_date}. The current academic year is 2025-26 (Sep 2025 - Jul 2026).
- ALL dates must fall within the academic year: Sep 2025 to Jul 2026.
- DO NOT extract "Start of Term", "End of Term", or "Last Day of Term" events — these are managed separately.
- DO NOT extract INSET day events — these are managed separately.
- Only extract specific school activities, trips, assemblies, performances, sports days, etc.

The school is Stocks Green Primary School. My children are Max (Year 2) and Emmie (Year 4).

Return ONLY a JSON array of events. Return [] if no specific events found. No other text.

Newsletter text:
{newsletter_text[:8000]}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Extract JSON from response
    if text.startswith("["):
        return json.loads(text)
    # Try to find JSON array in response
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return []


def determine_relevant_children(year_groups: list[str]) -> list[str]:
    """Determine which children are affected by an event."""
    if not year_groups:
        return ["Max", "Emmie"]  # Whole school
    relevant = []
    for child, info in CHILDREN.items():
        if info["year_group"] in year_groups:
            relevant.append(child)
    # If year groups are specified but neither child matches, return empty
    # (event doesn't apply to our children)
    return relevant


def main():
    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found")
        sys.exit(1)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Get already-processed newsletters
    existing = sb.table("school_newsletters").select("pdf_url").execute()
    processed_urls = {r["pdf_url"] for r in existing.data}

    # Scrape newsletter links
    print("Checking for new newsletters...")
    newsletters = get_newsletter_links()
    print(f"Found {len(newsletters)} newsletters on website")

    new_count = 0
    events_count = 0

    for nl in newsletters:
        if nl["url"] in processed_urls:
            continue

        print(f"\nProcessing: {nl['title']}")
        nl_date = extract_date_from_title(nl["title"])

        pdf_bytes = download_pdf(nl["url"])
        if not pdf_bytes:
            print(f"  Skipped (download failed)")
            continue

        text = extract_text_from_pdf(pdf_bytes)
        if not text.strip():
            print(f"  Skipped (no text extracted)")
            continue

        # Extract events using Claude
        events = []
        if ANTHROPIC_API_KEY:
            try:
                events = extract_events_with_claude(
                    text,
                    nl_date.isoformat() if nl_date else "unknown"
                )
                print(f"  Extracted {len(events)} events")
            except Exception as e:
                print(f"  Claude extraction failed: {e}")

        # Save events to school_events table
        for event in events:
            try:
                relevant = determine_relevant_children(event.get("year_groups", []))
                if not relevant:
                    continue  # Skip events not relevant to our children
                sb.table("school_events").upsert({
                    "event_date": event["event_date"],
                    "event_name": event["event_name"],
                    "event_type": event.get("event_type", "general"),
                    "year_groups": event.get("year_groups", []),
                    "relevant_children": relevant,
                    "requires_action": event.get("requires_action"),
                    "notes": event.get("notes"),
                    "source": "newsletter",
                    "source_date": nl_date.isoformat() if nl_date else None,
                }, on_conflict="event_date,event_name").execute()
                events_count += 1
            except Exception as e:
                print(f"  Error saving event: {e}")

        # Mark newsletter as processed
        sb.table("school_newsletters").upsert({
            "newsletter_date": nl_date.isoformat() if nl_date else None,
            "pdf_url": nl["url"],
            "processed": True,
            "events_extracted": len(events),
        }, on_conflict="pdf_url").execute()
        new_count += 1

    print(f"\nDone. Processed {new_count} new newsletters, extracted {events_count} events total.")

    # Show upcoming events
    today = date.today().isoformat()
    upcoming = sb.table("school_events").select("*").gte("event_date", today).order("event_date").limit(20).execute()
    if upcoming.data:
        print(f"\nUpcoming school events:")
        for e in upcoming.data:
            children = ", ".join(e.get("relevant_children", []))
            action = f" [{e['requires_action']}]" if e.get("requires_action") else ""
            print(f"  {e['event_date']} - {e['event_name']} ({children}){action}")


if __name__ == "__main__":
    main()
