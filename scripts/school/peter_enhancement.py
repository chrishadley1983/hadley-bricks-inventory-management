"""
Generates the code changes needed for the Peter Discord bot to show school data.

This script outputs the code that needs to be added to:
1. data_fetchers.py - new get_school_data() function
2. SKILL_DATA_FETCHERS dict - register the new fetcher
3. school-run SKILL.md - add school events section
4. New skill: school-weekly-spellings

Run this to see what changes are needed, then apply them.
"""

# === 1. DATA FETCHER CODE (add to data_fetchers.py) ===

DATA_FETCHER_CODE = '''
async def get_school_data() -> dict[str, Any]:
    """Fetch school data: this week's spellings + upcoming events.

    Returns:
        Dict with spellings for both children and upcoming school events
    """
    import httpx
    from datetime import date, timedelta

    SUPABASE_URL = "https://modjoikyuhqzouxvieua.supabase.co"
    # Read service role key from environment or local config
    import os
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    try:
        now = datetime.now(UK_TZ)
        today = now.date()
        week_ahead = (today + timedelta(days=7)).isoformat()

        async with httpx.AsyncClient() as client:
            # Get this week's spellings for both children
            # Approximate current week number based on academic year start (Sep 4)
            academic_start = date(2025, 9, 4)
            current_week = max(1, min(36, ((today - academic_start).days // 7) + 1))

            spellings_resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/school_spellings",
                params={
                    "academic_year": "eq.2025-26",
                    "week_number": f"eq.{current_week}",
                    "select": "*",
                },
                headers=headers,
            )
            spellings = spellings_resp.json() if spellings_resp.status_code == 200 else []

            # Get upcoming events (next 7 days)
            events_resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/school_events",
                params={
                    "event_date": f"gte.{today.isoformat()}",
                    "event_date": f"lte.{week_ahead}",
                    "order": "event_date",
                    "select": "*",
                },
                headers=headers,
            )
            upcoming_events = events_resp.json() if events_resp.status_code == 200 else []

            # Get today's events specifically
            today_events_resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/school_events",
                params={
                    "event_date": f"eq.{today.isoformat()}",
                    "select": "*",
                },
                headers=headers,
            )
            today_events = today_events_resp.json() if today_events_resp.status_code == 200 else []

            # Check if today is a school day (not INSET, not holiday)
            inset_resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/school_inset_days",
                params={
                    "inset_date": f"eq.{today.isoformat()}",
                    "select": "*",
                },
                headers=headers,
            )
            is_inset = len(inset_resp.json()) > 0 if inset_resp.status_code == 200 else False

            # Check term dates
            term_resp = await client.get(
                f"{SUPABASE_URL}/rest/v1/school_term_dates",
                params={
                    "academic_year": "eq.2025-26",
                    "start_date": f"lte.{today.isoformat()}",
                    "end_date": f"gte.{today.isoformat()}",
                    "select": "*",
                },
                headers=headers,
            )
            current_term = term_resp.json()[0] if term_resp.status_code == 200 and term_resp.json() else None

        return {
            "spellings": {
                "week_number": current_week,
                "children": {
                    s["child_name"]: {
                        "words": s["words"] if isinstance(s["words"], list) else eval(s["words"]),
                        "phoneme": s.get("phoneme"),
                        "year_group": s["year_group"],
                    }
                    for s in spellings
                },
            },
            "today_events": today_events,
            "upcoming_events": upcoming_events,
            "is_inset_day": is_inset,
            "current_term": current_term,
            "date": today.isoformat(),
        }

    except Exception as e:
        logger.error(f"School data fetch error: {e}")
        return {"error": str(e)}
'''

# === 2. SKILL.md for school-weekly-spellings ===

SPELLINGS_SKILL_MD = '''---
name: school-weekly-spellings
description: Weekly spelling list post for Max and Emmie
trigger:
  - "spellings this week"
  - "spelling words"
  - "what are the spellings"
scheduled: true
conversational: true
channel: #peter-chat
---

# Weekly Spellings

## Purpose
Post this week's spelling words for both children every Monday morning.

## Schedule
- Monday 07:30 UK

## Pre-fetcher
`get_school_data()` - fetches spellings from Supabase school_spellings table.

## Output Format

```
📝 **Spellings This Week** (Week {week_number})

👧 **Emmie** (Year 4) - Phoneme: {phoneme}
{words as numbered list, 3 per line}

👦 **Max** (Year 2)
{words as numbered list}

Practice 10 mins, twice this week! 📖
```

**If no spellings found for a child:**
Show "No spellings loaded yet for {child} - check class email"

## Guidelines
- Number the words for easy reference
- Group in rows of 3-4 for readability
- Show the phoneme/pattern being studied if available
- Keep it cheerful and encouraging
- If both children have the same phoneme, mention the connection
'''

# === 3. Enhanced school-run SKILL.md section ===

SCHOOL_RUN_ENHANCEMENT = '''
## School Events Section (NEW - add after Activities section)

If `school_events_today` is provided and not empty, add:

```
📅 **School Events Today:**
🎒 World Book Day - costumes needed!
🔬 Science Workshop (Year 2 + Year 4)
```

If `is_inset_day` is true:
```
⚠️ **INSET DAY - No School Today!**
```
(And skip the rest of the report)
'''

def main():
    print("=" * 60)
    print("PETER BOT ENHANCEMENT - School Data Integration")
    print("=" * 60)

    print("\n1. ADD TO data_fetchers.py (new function before SKILL_DATA_FETCHERS):")
    print(DATA_FETCHER_CODE)

    print("\n2. ADD TO SKILL_DATA_FETCHERS dict:")
    print('    "school-weekly-spellings": get_school_data,')

    print("\n3. CREATE NEW SKILL at:")
    print("   domains/peterbot/wsl_config/skills/school-weekly-spellings/SKILL.md")
    print(SPELLINGS_SKILL_MD)

    print("\n4. ADD TO SCHEDULE.md:")
    print("| school-weekly-spellings | school-weekly-spellings | 0 7 30 * * 1 | #peter-chat | true |")

    print("\n5. ENHANCE school-run SKILL.md:")
    print(SCHOOL_RUN_ENHANCEMENT)

    print("\n6. ENHANCE get_school_run_data() to include school events:")
    print("   Add to the parallel fetch: get_school_data()")
    print("   Add to return dict: 'school_events_today' and 'is_inset_day'")


if __name__ == "__main__":
    main()
