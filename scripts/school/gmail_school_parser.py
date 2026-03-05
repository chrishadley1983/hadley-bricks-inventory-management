"""
Gmail school email parser: scans recent school emails for:
- Spelling lists (Y2 from class teacher emails)
- Event dates and trip announcements
- Club schedule changes
- Arbor notification summaries

Uses Gmail API via the same OAuth as the Hadley API.
"""
import base64
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from email import message_from_bytes

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from config import (
    SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY,
    CHILDREN, ACADEMIC_YEAR
)

# Gmail OAuth (use the same token as Hadley API or a separate one)
GMAIL_CREDS_PATH = os.path.join(
    os.path.expanduser("~"), "claude-projects", "Discord-Messenger",
    "hadley_api", "gmail_token.json"
)
# Fallback to the main token if gmail-specific doesn't exist
if not os.path.exists(GMAIL_CREDS_PATH):
    GMAIL_CREDS_PATH = os.path.join(
        os.path.expanduser("~"), "claude-projects", "Discord-Messenger",
        "hadley_api", "token.json"
    )

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

SCHOOL_SENDERS = [
    "office@stocks-green.kent.sch.uk",
    "class2@stocks-green.kent.sch.uk",
    "class4@stocks-green.kent.sch.uk",
    "noreply@arbabornotifications.com",
    "noreply@arbor-education.com",
]


def get_gmail_service():
    """Get authenticated Gmail service."""
    creds = None
    if os.path.exists(GMAIL_CREDS_PATH):
        creds = Credentials.from_authorized_user_file(GMAIL_CREDS_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            print(f"ERROR: Gmail credentials not found at {GMAIL_CREDS_PATH}")
            print("Gmail parsing will use MCP Gmail tool as fallback (run from Claude Code).")
            return None

    return build("gmail", "v1", credentials=creds)


def search_emails(service, query: str, max_results: int = 20) -> list[dict]:
    """Search Gmail and return message details."""
    results = service.users().messages().list(
        userId="me", q=query, maxResults=max_results
    ).execute()

    messages = []
    for msg_ref in results.get("messages", []):
        msg = service.users().messages().get(
            userId="me", id=msg_ref["id"], format="full"
        ).execute()

        headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}
        body = ""

        # Extract body text
        if "parts" in msg["payload"]:
            for part in msg["payload"]["parts"]:
                if part["mimeType"] == "text/plain" and "data" in part.get("body", {}):
                    body = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
                    break
        elif "body" in msg["payload"] and "data" in msg["payload"]["body"]:
            body = base64.urlsafe_b64decode(msg["payload"]["body"]["data"]).decode("utf-8", errors="replace")

        messages.append({
            "id": msg_ref["id"],
            "subject": headers.get("subject", ""),
            "from": headers.get("from", ""),
            "date": headers.get("date", ""),
            "body": body[:5000],  # Limit body size
        })

    return messages


def extract_spellings_with_claude(email_body: str, child_name: str, year_group: str) -> dict | None:
    """Use Claude to extract spelling words from a class email."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""This is an email from {child_name}'s class teacher at Stocks Green Primary ({year_group}).
Extract any spelling words or spelling list from this email.

Return JSON with:
- words: array of spelling words
- week_number: the week number if mentioned, or null
- phoneme: the phoneme/pattern being studied if mentioned, or null
- test_date: date of spelling test in YYYY-MM-DD format if mentioned, or null

If there are no spellings in this email, return null.

Email:
{email_body[:4000]}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    if text.lower() == "null" or "no spelling" in text.lower():
        return None
    try:
        if text.startswith("{"):
            return json.loads(text)
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return None


def extract_events_with_claude(email_body: str, email_subject: str, email_date: str) -> list[dict]:
    """Use Claude to extract event dates from a school email."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Extract any school event dates from this email from Stocks Green Primary School.
Subject: {email_subject}
Date: {email_date}

For each event, return:
- event_date: YYYY-MM-DD
- event_name: short name
- event_type: trip/assembly/inset/parent_meeting/concert/sport/celebration/general
- year_groups: ["Year 2", "Year 4"] or [] for whole school
- requires_action: consent/payment/costume/kit or null
- notes: any details

Return a JSON array. Return [] if no events found.

Email body:
{email_body[:4000]}"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    try:
        if text.startswith("["):
            return json.loads(text)
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return []


def main():
    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found")
        sys.exit(1)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    service = get_gmail_service()

    if not service:
        print("Gmail API not available. Use Claude Code MCP tools instead.")
        return

    # Search for recent school emails (last 14 days)
    after_date = (date.today() - timedelta(days=14)).strftime("%Y/%m/%d")

    print("Searching for recent school emails...")

    # Search class teacher emails for spellings
    for child_name, info in CHILDREN.items():
        class_email = info["class_email"]
        year_group = info["year_group"]

        print(f"\n  Checking {child_name}'s class emails ({class_email})...")
        emails = search_emails(service, f"from:{class_email} after:{after_date}", max_results=5)

        for email in emails:
            print(f"    [{email['date']}] {email['subject']}")
            if ANTHROPIC_API_KEY:
                spellings = extract_spellings_with_claude(email["body"], child_name, year_group)
                if spellings and spellings.get("words"):
                    print(f"    -> Found spellings: {spellings['words']}")
                    sb.table("school_spellings").upsert({
                        "child_name": child_name,
                        "year_group": year_group,
                        "academic_year": ACADEMIC_YEAR,
                        "week_number": spellings.get("week_number") or 0,
                        "phoneme": spellings.get("phoneme"),
                        "words": json.dumps(spellings["words"]),
                        "test_date": spellings.get("test_date"),
                        "source": "email",
                    }, on_conflict="child_name,academic_year,week_number").execute()

    # Search main school email for events
    print(f"\n  Checking main school emails...")
    school_emails = search_emails(
        service,
        f"from:office@stocks-green.kent.sch.uk after:{after_date}",
        max_results=10,
    )

    events_saved = 0
    for email in school_emails:
        print(f"    [{email['date']}] {email['subject']}")
        if ANTHROPIC_API_KEY:
            events = extract_events_with_claude(email["body"], email["subject"], email["date"])
            for event in events:
                try:
                    relevant = []
                    ygs = event.get("year_groups", [])
                    if not ygs:
                        relevant = ["Max", "Emmie"]
                    else:
                        for child, info in CHILDREN.items():
                            if info["year_group"] in ygs:
                                relevant.append(child)
                        if not relevant:
                            relevant = ["Max", "Emmie"]

                    sb.table("school_events").upsert({
                        "event_date": event["event_date"],
                        "event_name": event["event_name"],
                        "event_type": event.get("event_type", "general"),
                        "year_groups": event.get("year_groups", []),
                        "relevant_children": relevant,
                        "requires_action": event.get("requires_action"),
                        "notes": event.get("notes"),
                        "source": "email",
                        "source_date": date.today().isoformat(),
                    }, on_conflict="event_date,event_name").execute()
                    events_saved += 1
                except Exception as e:
                    print(f"      Error saving event: {e}")

    print(f"\n  Saved {events_saved} events from school emails")

    # Search Arbor notification emails
    print(f"\n  Checking Arbor notifications...")
    arbor_emails = search_emails(
        service,
        f"from:arbor after:{after_date}",
        max_results=5,
    )
    for email in arbor_emails:
        print(f"    [{email['date']}] {email['subject']}")
        # Arbor emails usually have payment reminders, messages, consent requests
        # Just log them for now - more detailed parsing in F8

    print("\nDone.")


if __name__ == "__main__":
    main()
