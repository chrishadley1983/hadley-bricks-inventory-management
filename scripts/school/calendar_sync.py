"""
Google Calendar sync: pushes school events and term dates to Google Calendar.
Creates/updates events in the Family calendar.

Uses the same Google OAuth refresh tokens as Peter's Hadley API (.env file).
"""
import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from config import SUPABASE_URL, SUPABASE_KEY

# Load Google OAuth from Discord-Messenger .env
env_path = Path(os.path.expanduser("~")) / "claude-projects" / "Discord-Messenger" / ".env"
load_dotenv(env_path)

FAMILY_CALENDAR_ID = "family04516641497623508871@group.calendar.google.com"

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_REFRESH_TOKEN")


def get_calendar_service():
    """Get authenticated Google Calendar service using refresh token."""
    if not all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN]):
        print("ERROR: Google OAuth credentials not found in Discord-Messenger/.env")
        print("Need: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN")
        sys.exit(1)

    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
    )
    creds.refresh(Request())
    return build("calendar", "v3", credentials=creds)


def find_existing_event(service, calendar_id: str, event_date: str, summary: str) -> str | None:
    """Find an existing calendar event by date and summary."""
    time_min = f"{event_date}T00:00:00Z"
    time_max = f"{event_date}T23:59:59Z"
    try:
        events = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            q=summary,
            singleEvents=True,
        ).execute()
        for event in events.get("items", []):
            if event.get("summary", "").lower() == summary.lower():
                return event["id"]
    except Exception:
        pass
    return None


def create_or_update_event(service, calendar_id: str, event_data: dict, existing_id: str = None) -> str:
    """Create or update a calendar event. Returns event ID."""
    if existing_id:
        event = service.events().update(
            calendarId=calendar_id,
            eventId=existing_id,
            body=event_data,
        ).execute()
    else:
        event = service.events().insert(
            calendarId=calendar_id,
            body=event_data,
        ).execute()
    return event["id"]


def sync_school_events(sb, service):
    """Sync school_events to Google Calendar."""
    print("\nSyncing school events to Google Calendar...")
    today = date.today().isoformat()

    # Get future events without calendar IDs
    events = sb.table("school_events").select("*").gte("event_date", today).order("event_date").execute()

    synced = 0
    for event in events.data:
        children = ", ".join(event.get("relevant_children", []))
        summary = f"School: {event['event_name']}"
        if children and children != "Max, Emmie":
            summary += f" ({children})"

        description_parts = []
        if event.get("event_type"):
            description_parts.append(f"Type: {event['event_type']}")
        if event.get("year_groups"):
            description_parts.append(f"Year groups: {', '.join(event['year_groups'])}")
        if event.get("requires_action"):
            description_parts.append(f"ACTION REQUIRED: {event['requires_action']}")
        if event.get("notes"):
            description_parts.append(event["notes"])

        cal_event = {
            "summary": summary,
            "description": "\n".join(description_parts),
            "start": {"date": event["event_date"]},
            "end": {"date": event["event_date"]},
            "colorId": "11" if event.get("event_type") == "inset" else "9",  # Red for INSET, blue for others
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 1440}],  # 1 day before
            },
        }

        # Add extra reminder for action-required events
        if event.get("requires_action"):
            cal_event["reminders"]["overrides"].append({"method": "popup", "minutes": 4320})  # 3 days before

        existing_cal_id = event.get("calendar_event_id")
        if not existing_cal_id:
            existing_cal_id = find_existing_event(service, FAMILY_CALENDAR_ID, event["event_date"], summary)

        try:
            cal_id = create_or_update_event(service, FAMILY_CALENDAR_ID, cal_event, existing_cal_id)
            sb.table("school_events").update({"calendar_event_id": cal_id}).eq("id", event["id"]).execute()
            synced += 1
            print(f"  {event['event_date']} - {event['event_name']} -> {cal_id}")
        except Exception as e:
            print(f"  Error syncing {event['event_name']}: {e}")

    print(f"  Synced {synced} events")


def sync_inset_days(sb, service):
    """Sync INSET days to Google Calendar."""
    print("\nSyncing INSET days...")
    today = date.today().isoformat()

    insets = sb.table("school_inset_days").select("*").gte("inset_date", today).order("inset_date").execute()

    synced = 0
    for inset in insets.data:
        summary = f"School: INSET Day (No School)"
        confirmed = "Confirmed" if inset["confirmed"] else "Provisional"

        cal_event = {
            "summary": summary,
            "description": f"INSET Day - {confirmed}\nAcademic year: {inset['academic_year']}\nChildren off school.",
            "start": {"date": inset["inset_date"]},
            "end": {"date": inset["inset_date"]},
            "colorId": "11",  # Red
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "popup", "minutes": 1440},  # 1 day
                    {"method": "popup", "minutes": 10080},  # 1 week
                ],
            },
        }

        existing_cal_id = inset.get("calendar_event_id")
        if not existing_cal_id:
            existing_cal_id = find_existing_event(service, FAMILY_CALENDAR_ID, inset["inset_date"], summary)

        try:
            cal_id = create_or_update_event(service, FAMILY_CALENDAR_ID, cal_event, existing_cal_id)
            sb.table("school_inset_days").update({"calendar_event_id": cal_id}).eq("id", inset["id"]).execute()
            synced += 1
            print(f"  {inset['inset_date']} ({confirmed}) -> {cal_id}")
        except Exception as e:
            print(f"  Error syncing INSET {inset['inset_date']}: {e}")

    print(f"  Synced {synced} INSET days")


def sync_term_boundaries(sb, service):
    """Sync term start/end dates as all-day events."""
    print("\nSyncing term boundaries...")

    for year in ["2025-26", "2026-27"]:
        terms = sb.table("school_term_dates").select("*").eq("academic_year", year).order("term_number").execute()
        for term in terms.data:
            # First day of term
            summary = f"School: {term['term_name']} starts"
            existing = find_existing_event(service, FAMILY_CALENDAR_ID, term["start_date"], summary)
            cal_event = {
                "summary": summary,
                "start": {"date": term["start_date"]},
                "end": {"date": term["start_date"]},
                "colorId": "2",  # Green
            }
            try:
                create_or_update_event(service, FAMILY_CALENDAR_ID, cal_event, existing)
                print(f"  {term['start_date']} - {summary}")
            except Exception as e:
                print(f"  Error: {e}")

            # Last day of term
            summary = f"School: {term['term_name']} ends"
            existing = find_existing_event(service, FAMILY_CALENDAR_ID, term["end_date"], summary)
            cal_event = {
                "summary": summary,
                "start": {"date": term["end_date"]},
                "end": {"date": term["end_date"]},
                "colorId": "2",  # Green
            }
            try:
                create_or_update_event(service, FAMILY_CALENDAR_ID, cal_event, existing)
                print(f"  {term['end_date']} - {summary}")
            except Exception as e:
                print(f"  Error: {e}")


def main():
    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY not found")
        sys.exit(1)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    service = get_calendar_service()

    sync_school_events(sb, service)
    sync_inset_days(sb, service)
    sync_term_boundaries(sb, service)

    print("\nCalendar sync complete.")


if __name__ == "__main__":
    main()
