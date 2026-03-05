"""
Term dates poller: downloads term date PDFs, parses them, detects changes,
syncs to Supabase and Google Calendar, and alerts on updates.

Run weekly. Sends Pushover notification when INSET days change.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import date, datetime

import fitz  # pymupdf
import httpx
import requests
from bs4 import BeautifulSoup
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from config import (
    SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY,
    SCHOOL_WEBSITE, TERM_DATES_URL,
    PUSHOVER_USER_KEY, PUSHOVER_API_TOKEN
)


def send_pushover(title: str, message: str, priority: int = 0):
    """Send a Pushover notification."""
    if not PUSHOVER_USER_KEY or not PUSHOVER_API_TOKEN:
        print(f"[Pushover not configured] {title}: {message}")
        return
    try:
        requests.post("https://api.pushover.net/1/messages.json", data={
            "token": PUSHOVER_API_TOKEN,
            "user": PUSHOVER_USER_KEY,
            "title": title,
            "message": message,
            "priority": priority,
        })
    except Exception as e:
        print(f"Pushover error: {e}")


def find_term_date_pdfs() -> list[dict]:
    """Scrape the term dates page for PDF links."""
    resp = httpx.get(TERM_DATES_URL, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    pdfs = []
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True).lower()
        if href.endswith(".pdf") and ("term" in text or "inset" in text or "term" in href.lower()):
            full_url = href if href.startswith("http") else f"{SCHOOL_WEBSITE}{href}"
            # Determine academic year
            year = None
            for y in ["2024-25", "2025-26", "2026-27", "2027-28"]:
                yr_patterns = [y, y.replace("-", " "), y.replace("-", "")]
                for p in yr_patterns:
                    if p in text or p in href:
                        year = y
                        break
            if not year:
                # Try extracting year numbers
                m = re.search(r"20(\d{2})\D*(\d{2})", text + href)
                if m:
                    year = f"20{m.group(1)}-{m.group(2)}"
            if year:
                pdfs.append({"url": full_url, "title": text, "academic_year": year})

    return pdfs


def download_and_hash(url: str) -> tuple[bytes | None, str | None]:
    """Download PDF and return (bytes, sha256_hash)."""
    try:
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 100:
            h = hashlib.sha256(resp.content).hexdigest()
            return resp.content, h
    except Exception as e:
        print(f"  Download error: {e}")
    return None, None


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from PDF."""
    tmp_path = os.path.join(tempfile.gettempdir(), f"school_td_{os.getpid()}.pdf")
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


def parse_term_dates_with_claude(text: str, academic_year: str) -> dict:
    """Use Claude to extract structured term dates from PDF text."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Parse these school term dates for the {academic_year} academic year.
Extract:
1. terms: array of objects with term_number (1-6), term_name (e.g. "Autumn 1"), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
2. inset_days: array of dates in YYYY-MM-DD format
3. half_terms: array of objects with start_date, end_date for each half term break

Term numbering: T1=Autumn 1, T2=Autumn 2, T3=Spring 1, T4=Spring 2, T5=Summer 1, T6=Summer 2

Return ONLY valid JSON with keys: terms, inset_days, half_terms. No other text.

Text from PDF:
{text[:6000]}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    resp_text = response.content[0].text.strip()
    if resp_text.startswith("{"):
        return json.loads(resp_text)
    match = re.search(r"\{.*\}", resp_text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return {"terms": [], "inset_days": [], "half_terms": []}


def main():
    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found")
        sys.exit(1)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Checking for term date PDFs...")
    pdfs = find_term_date_pdfs()
    print(f"Found {len(pdfs)} term date documents")

    changes_detected = []

    for pdf_info in pdfs:
        url = pdf_info["url"]
        year = pdf_info["academic_year"]
        print(f"\n  [{year}] {pdf_info['title']}")

        # Download and hash
        content, content_hash = download_and_hash(url)
        if not content:
            print(f"    Skipped (download failed)")
            continue

        # Check if content has changed
        existing = sb.table("school_term_date_pdfs").select("*").eq("pdf_url", url).execute()
        old_hash = existing.data[0]["content_hash"] if existing.data else None

        if old_hash == content_hash:
            print(f"    No changes (hash matches)")
            sb.table("school_term_date_pdfs").upsert({
                "academic_year": year,
                "pdf_url": url,
                "content_hash": content_hash,
                "last_checked_at": datetime.utcnow().isoformat(),
            }, on_conflict="academic_year,pdf_url").execute()
            continue

        # Content changed or new PDF
        print(f"    {'NEW' if not old_hash else 'CHANGED'} - parsing...")
        changes_detected.append(year)

        text = extract_pdf_text(content)
        if not text.strip():
            print(f"    No text extracted")
            continue

        # Parse with Claude
        if ANTHROPIC_API_KEY:
            try:
                parsed = parse_term_dates_with_claude(text, year)
            except Exception as e:
                print(f"    Claude parse failed: {e}")
                parsed = {"terms": [], "inset_days": [], "half_terms": []}
        else:
            print(f"    No ANTHROPIC_API_KEY, skipping Claude parse")
            parsed = {"terms": [], "inset_days": [], "half_terms": []}

        # Save terms
        for term in parsed.get("terms", []):
            try:
                sb.table("school_term_dates").upsert({
                    "academic_year": year,
                    "term_number": term["term_number"],
                    "term_name": term["term_name"],
                    "start_date": term["start_date"],
                    "end_date": term["end_date"],
                }, on_conflict="academic_year,term_number").execute()
            except Exception as e:
                print(f"    Error saving term: {e}")

        # Save INSET days
        old_insets = sb.table("school_inset_days").select("inset_date").eq("academic_year", year).execute()
        old_inset_dates = {r["inset_date"] for r in old_insets.data}
        new_inset_dates = set(parsed.get("inset_days", []))

        for inset_date in parsed.get("inset_days", []):
            try:
                sb.table("school_inset_days").upsert({
                    "academic_year": year,
                    "inset_date": inset_date,
                    "confirmed": True,
                }, on_conflict="academic_year,inset_date").execute()
            except Exception as e:
                print(f"    Error saving INSET day: {e}")

        # Also add INSET days to school_events
        for inset_date in parsed.get("inset_days", []):
            sb.table("school_events").upsert({
                "event_date": inset_date,
                "event_name": f"INSET Day ({year})",
                "event_type": "inset",
                "year_groups": [],
                "relevant_children": ["Max", "Emmie"],
                "source": "term_dates_pdf",
            }, on_conflict="event_date,event_name").execute()

        # Detect INSET day changes
        added_insets = new_inset_dates - old_inset_dates
        removed_insets = old_inset_dates - new_inset_dates
        if added_insets or removed_insets:
            change_msg = []
            if added_insets:
                change_msg.append(f"Added: {', '.join(sorted(added_insets))}")
            if removed_insets:
                change_msg.append(f"Removed: {', '.join(sorted(removed_insets))}")
            alert_msg = f"INSET days updated for {year}:\n" + "\n".join(change_msg)
            send_pushover(f"School INSET Update ({year})", alert_msg, priority=0)
            print(f"    ALERT: {alert_msg}")

        # Update tracking
        sb.table("school_term_date_pdfs").upsert({
            "academic_year": year,
            "pdf_url": url,
            "content_hash": content_hash,
            "last_checked_at": datetime.utcnow().isoformat(),
            "last_changed_at": datetime.utcnow().isoformat() if old_hash else None,
        }, on_conflict="academic_year,pdf_url").execute()

        print(f"    Saved {len(parsed.get('terms', []))} terms, {len(parsed.get('inset_days', []))} INSET days")

    # Summary
    if changes_detected:
        print(f"\nChanges detected in: {', '.join(changes_detected)}")
        send_pushover(
            "School Term Dates Updated",
            f"Term date changes detected for: {', '.join(changes_detected)}. Check school_term_dates table.",
        )
    else:
        print("\nNo changes detected in any term date documents.")

    # Print current state
    for year in ["2025-26", "2026-27"]:
        terms = sb.table("school_term_dates").select("*").eq("academic_year", year).order("term_number").execute()
        insets = sb.table("school_inset_days").select("*").eq("academic_year", year).order("inset_date").execute()
        if terms.data:
            print(f"\n{year} Terms:")
            for t in terms.data:
                print(f"  T{t['term_number']} ({t['term_name']}): {t['start_date']} to {t['end_date']}")
        if insets.data:
            print(f"{year} INSET days:")
            for i in insets.data:
                confirmed = "confirmed" if i["confirmed"] else "provisional"
                print(f"  {i['inset_date']} ({confirmed})")


if __name__ == "__main__":
    main()
