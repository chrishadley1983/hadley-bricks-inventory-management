"""
Arbor email notification monitor: parses Arbor notification emails from Gmail
for messages, payment reminders, consent requests, and attendance.

Sends WhatsApp alerts for urgent items (consent deadlines, payment due).
Since Arbor has no parent API, we rely on email notifications as the data source.

Run daily or as part of the weekly orchestrator.
"""
import json
import os
import re
import sys
from datetime import date, timedelta

import requests

sys.path.insert(0, os.path.dirname(__file__))
from config import (
    SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY,
    send_whatsapp,
)


def parse_arbor_email_with_claude(subject: str, body: str, sender: str) -> dict:
    """Use Claude to classify and extract data from an Arbor notification email."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = f"""Classify this school notification email and extract key information.

Subject: {subject}
From: {sender}
Body: {body[:3000]}

Return JSON with:
- category: one of "message", "payment", "consent", "attendance", "club", "report", "other"
- urgency: "high" (needs action within 48h), "medium" (this week), "low" (informational)
- child_name: "Max", "Emmie", or "both" if applicable
- summary: one-line summary of what it's about
- action_needed: what the parent needs to do, or null
- deadline: YYYY-MM-DD if there's a deadline, or null
- amount: monetary amount if payment related, or null

Return ONLY JSON."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    try:
        if text.startswith("{"):
            return json.loads(text)
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return {"category": "other", "urgency": "low", "summary": subject}


def main():
    """
    This script is designed to be called from Claude Code with Gmail MCP access,
    or with a Gmail API token. It processes recent Arbor-related emails.

    For now, it provides the parsing logic. The actual email fetching is done via:
    1. Gmail MCP tools (mcp__claude_ai_Gmail__gmail_search_messages) when run from Claude Code
    2. Gmail API with OAuth tokens when run standalone

    To run standalone, pass email data as JSON on stdin.
    """
    print("Arbor Email Monitor")
    print("=" * 40)

    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not found")
        sys.exit(1)

    # Check if data is piped in
    import select
    if not sys.stdin.isatty():
        emails = json.load(sys.stdin)
    else:
        # Try Gmail API
        try:
            from gmail_school_parser import get_gmail_service, search_emails
            service = get_gmail_service()
            if service:
                after_date = (date.today() - timedelta(days=7)).strftime("%Y/%m/%d")
                emails_raw = search_emails(service, f"from:arbor after:{after_date}", max_results=10)
                # Also check for school office emails about payments/consents
                emails_raw += search_emails(
                    service,
                    f"from:office@stocks-green.kent.sch.uk subject:(consent OR payment OR dinner OR arbor) after:{after_date}",
                    max_results=5,
                )
                emails = [{"subject": e["subject"], "body": e["body"], "from": e["from"], "date": e["date"]} for e in emails_raw]
            else:
                print("No Gmail API access. Run from Claude Code with MCP tools.")
                print("Or pipe JSON email data: echo '[{...}]' | python arbor_monitor.py")
                return
        except ImportError:
            print("Gmail parser not available. Run from Claude Code with MCP tools.")
            return

    if not emails:
        print("No Arbor-related emails found in the last 7 days.")
        return

    print(f"Processing {len(emails)} emails...")

    urgent_alerts = []

    for email in emails:
        parsed = parse_arbor_email_with_claude(
            email.get("subject", ""),
            email.get("body", ""),
            email.get("from", ""),
        )

        category = parsed.get("category", "other")
        urgency = parsed.get("urgency", "low")
        summary = parsed.get("summary", email.get("subject", ""))
        child = parsed.get("child_name", "")
        action = parsed.get("action_needed")

        icon = {"message": "msg", "payment": "GBP", "consent": "!!", "attendance": "att", "club": "act", "report": "rpt"}.get(category, "...")
        urg_icon = {"high": "HIGH", "medium": "MED", "low": "LOW"}.get(urgency, "")

        print(f"  [{icon}] [{urg_icon}] {summary}")
        if action:
            print(f"       Action: {action}")
        if parsed.get("deadline"):
            print(f"       Deadline: {parsed['deadline']}")
        if parsed.get("amount"):
            print(f"       Amount: {parsed['amount']}")

        # Collect urgent alerts
        if urgency == "high":
            alert_msg = f"{summary}"
            if action:
                alert_msg += f"\nAction: {action}"
            if parsed.get("deadline"):
                alert_msg += f"\nDeadline: {parsed['deadline']}"
            urgent_alerts.append({"title": f"School ({child})", "message": alert_msg})

    # Send WhatsApp for urgent items
    if urgent_alerts:
        print(f"\nSending {len(urgent_alerts)} urgent alert(s)...")
        for alert in urgent_alerts:
            send_whatsapp(alert["title"], alert["message"], priority=0)
    else:
        print("\nNo urgent items requiring attention.")


if __name__ == "__main__":
    main()
