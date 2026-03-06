"""
Arbor parent portal scraper: logs in via Playwright, extracts account balances,
attendance, notices, and upcoming events. Sends WhatsApp alerts for low balances.

Run daily as part of the school sync job.
"""
import os
import re
import sys
from datetime import date, datetime

import requests
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from config import (
    SUPABASE_URL, SUPABASE_KEY,
    ARBOR_URL, ARBOR_EMAIL, ARBOR_PASSWORD,
    CHILDREN, send_whatsapp,
)

# Alert if any account balance drops below this
LOW_BALANCE_THRESHOLD = 5.00

# Only monitor these accounts for low balances (child, account_type)
MONITORED_ACCOUNTS = {
    ("Max", "Early Morning Club"),
    ("Emmie", "Meals"),
}


def parse_balance(text: str) -> float:
    """Extract a numeric balance from text like 'Balance: £20.21'."""
    match = re.search(r'[\u00a3$]?([\d]+\.[\d]{2})', text)
    if match:
        return float(match.group(1))
    # Try without decimal
    match = re.search(r'[\u00a3$]?([\d]+)', text)
    if match:
        return float(match.group(1))
    return 0.0


def scrape_arbor() -> dict:
    """Log into Arbor and scrape the parent dashboard.

    Returns dict with:
        accounts: list of {child, account_type, balance}
        attendance: {child: {year_pct, recent_pct}}
        year_groups: {child: form_number}
        notices: list of strings
        messages_unread: bool
    """
    result = {
        "accounts": [],
        "attendance": {},
        "year_groups": {},
        "notices": [],
        "messages_unread": False,
        "error": None,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        try:
            # Login
            page.goto(ARBOR_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)

            # Check we're on the login page
            if "Email address" not in page.content():
                result["error"] = f"Unexpected page: {page.url}"
                return result

            page.fill('input[placeholder="Email address"]', ARBOR_EMAIL)
            page.fill('input[placeholder="Password"]', ARBOR_PASSWORD)
            page.click('button:has-text("Log in")')
            # Wait for dashboard SPA to fully render
            page.wait_for_timeout(8000)  # Fallback wait

            if "dashboard" not in page.url:
                result["error"] = f"Login may have failed. URL: {page.url}"
                return result

            # Extract full page text
            body_text = page.inner_text("body")

            # --- YEAR GROUP (Form) ---
            # Dashboard shows "Form N" for each child
            current_child_name = page.evaluate("""() => {
                const sel = document.querySelector('[class*="dropdown-menu-button__text"]');
                return sel ? sel.textContent.trim().split(' ')[0] : null;
            }""")
            form_match = re.search(r'Form\s+(\d+)', body_text)
            if form_match and current_child_name:
                result["year_groups"][current_child_name] = int(form_match.group(1))

            # --- ACCOUNT BALANCES ---
            balance_elements = page.evaluate("""() => {
                const results = [];
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.children.length === 0 && el.textContent.includes('Balance:')) {
                        const parent = el.parentElement;
                        if (parent) {
                            results.push(parent.textContent.trim());
                        }
                    }
                }
                return results;
            }""")

            for elem_text in balance_elements:
                # Parse "Emmie Hadley : Meals Balance: £20.21"
                match = re.match(r'(.+?)\s*:\s*(.+?)Balance:\s*(.+)', elem_text.replace('\n', ' '))
                if match:
                    child = match.group(1).strip()
                    account_type = match.group(2).strip()
                    balance = parse_balance(match.group(3))
                    # Normalize child name to first name only
                    first_name = child.split()[0] if child else child
                    result["accounts"].append({
                        "child": first_name,
                        "account_type": account_type,
                        "balance": balance,
                    })

            # --- ATTENDANCE ---
            # Dashboard shows one child at a time; extract then switch
            def extract_attendance(text):
                match = re.search(
                    r'Attendance \((\d{4}/\d{4})\)\s*([\d.]+)%.*?([\d.]+)%\s*Year.*?([\d.]+)%\s*Last 4 weeks',
                    text, re.DOTALL
                )
                if match:
                    return {
                        "academic_year": match.group(1),
                        "overall_pct": float(match.group(2)),
                        "year_pct": float(match.group(3)),
                        "recent_pct": float(match.group(4)),
                    }
                return None

            # Get the currently displayed child's name
            current_child = page.evaluate("""() => {
                const sel = document.querySelector('[class*="dropdown-menu-button__text"]');
                return sel ? sel.textContent.trim().split(' ')[0] : null;
            }""")

            att = extract_attendance(body_text)
            if att and current_child:
                result["attendance"][current_child] = att

            # Switch to the other child and extract their attendance
            # Get all child dashboard links from the page
            child_links = page.evaluate("""() => {
                const links = document.querySelectorAll('a[href]');
                const result = {};
                for (const a of links) {
                    const text = a.textContent.trim();
                    const href = a.href;
                    if (href.includes('dashboard/st') && /^\\w+ Hadley$/.test(text)) {
                        result[text.split(' ')[0]] = href;
                    }
                }
                return result;
            }""")

            other_children = [c for c in CHILDREN if c != current_child]
            for child_name in other_children:
                try:
                    link = child_links.get(child_name)
                    if link:
                        page.goto(link, wait_until="domcontentloaded", timeout=30000)
                        page.wait_for_timeout(8000)
                        other_text = page.inner_text("body")
                        att = extract_attendance(other_text)
                        if att:
                            result["attendance"][child_name] = att
                        else:
                            print(f"  No attendance data found for {child_name}")
                        # Extract form/year group for this child too
                        form_match = re.search(r'Form\s+(\d+)', other_text)
                        if form_match:
                            result["year_groups"][child_name] = int(form_match.group(1))
                    else:
                        print(f"  No dashboard link found for {child_name} (available: {list(child_links.keys())})")
                except Exception as e:
                    print(f"  Could not switch to {child_name}: {e}")

            # --- UNREAD MESSAGES ---
            result["messages_unread"] = "unread messages" in body_text and "no unread" not in body_text.lower()

            # --- NOTICES ---
            if "No notices" not in body_text:
                # Extract notices section
                notices_match = re.search(r'Notices\s*\n(.+?)(?:Payments|$)', body_text, re.DOTALL)
                if notices_match:
                    notices_text = notices_match.group(1).strip()
                    if notices_text and notices_text != "No notices":
                        result["notices"] = [n.strip() for n in notices_text.split('\n') if n.strip()]

        except Exception as e:
            result["error"] = str(e)
        finally:
            browser.close()

    return result


def check_low_balances(accounts: list[dict]) -> list[dict]:
    """Check monitored accounts for balances below threshold."""
    low = []
    for acc in accounts:
        if (acc["child"], acc["account_type"]) in MONITORED_ACCOUNTS and acc["balance"] < LOW_BALANCE_THRESHOLD:
            low.append(acc)
    return low


def main():
    print("Arbor Portal Scraper")
    print("=" * 40)
    print(f"Date: {date.today()}")
    print(f"Low balance threshold: {LOW_BALANCE_THRESHOLD:.2f}")

    data = scrape_arbor()

    if data["error"]:
        print(f"\nERROR: {data['error']}")
        send_whatsapp("Arbor Scraper Failed", data["error"])
        sys.exit(1)

    # Print account balances
    print(f"\nAccount Balances:")
    for acc in data["accounts"]:
        status = "LOW" if acc["balance"] < LOW_BALANCE_THRESHOLD else "OK"
        print(f"  [{status}] {acc['child']} - {acc['account_type']}: {acc['balance']:.2f}")

    # Print attendance
    if data["attendance"]:
        for child_name, att in data["attendance"].items():
            print(f"\nAttendance - {child_name} ({att.get('academic_year', 'N/A')}):")
            print(f"  Overall: {att.get('overall_pct', 'N/A')}%")
            print(f"  Year: {att.get('year_pct', 'N/A')}%")
            print(f"  Last 4 weeks: {att.get('recent_pct', 'N/A')}%")

    # Print messages/notices
    if data["messages_unread"]:
        print(f"\nYou have UNREAD MESSAGES!")
    if data["notices"]:
        print(f"\nNotices:")
        for notice in data["notices"]:
            print(f"  - {notice}")

    # Check low balances and alert
    low_accounts = check_low_balances(data["accounts"])
    if low_accounts:
        print(f"\n{len(low_accounts)} account(s) below {LOW_BALANCE_THRESHOLD:.2f}!")
        lines = []
        for acc in low_accounts:
            lines.append(f"{acc['child']} {acc['account_type']}: {acc['balance']:.2f}")
        alert_msg = "\n".join(lines)
        send_whatsapp(
            f"School: Low Balance Alert",
            alert_msg,
            priority=0,
        )
    else:
        print(f"\nAll account balances OK.")

    # Alert for unread messages
    if data["messages_unread"]:
        send_whatsapp("School: Unread Arbor Messages", "You have unread messages on Arbor")

    # Check year group changes against config
    # Expected: Max = Year 2 (Form 2), Emmie = Year 4 (Form 4)
    expected_forms = {child: int(info["year_group"].split()[-1]) for child, info in CHILDREN.items()}
    if data["year_groups"]:
        print(f"\nYear Groups:")
        for child, form in data["year_groups"].items():
            expected = expected_forms.get(child)
            status = "OK" if form == expected else "CHANGED"
            print(f"  [{status}] {child}: Form {form} (expected Year {expected})")
            if form != expected:
                send_whatsapp(
                    "School: Year Group Changed!",
                    f"{child} is now in Form {form} (was Year {expected}). "
                    f"Update CHILDREN config in scripts/school/config.py",
                    priority=1,
                )

    print("\nDone.")


if __name__ == "__main__":
    main()
