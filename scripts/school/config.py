"""Shared configuration for school integration scripts."""
import os

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://modjoikyuhqzouxvieua.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Load from .env.local if not in environment
if not SUPABASE_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip()
                elif line.startswith("ANTHROPIC_API_KEY="):
                    os.environ.setdefault("ANTHROPIC_API_KEY", line.split("=", 1)[1].strip())

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

SCHOOL_WEBSITE = "https://www.stocksgreenprimary.co.uk"
NEWSLETTERS_URL = f"{SCHOOL_WEBSITE}/community/news-and-newsletters/newsletters"
TERM_DATES_URL = f"{SCHOOL_WEBSITE}/parents/term-dates"

CHILDREN = {
    "Max": {"year_group": "Year 2", "class_email": "class2@stocks-green.kent.sch.uk"},
    "Emmie": {"year_group": "Year 4", "class_email": "class4@stocks-green.kent.sch.uk"},
}

# Current academic year
ACADEMIC_YEAR = "2025-26"

# Term structure for 2025-26 (approximate, refined from term dates PDFs)
TERMS = {
    1: {"name": "Autumn 1", "approx_start": "2025-09-04", "approx_end": "2025-10-24"},
    2: {"name": "Autumn 2", "approx_start": "2025-11-03", "approx_end": "2025-12-19"},
    3: {"name": "Spring 1", "approx_start": "2026-01-05", "approx_end": "2026-02-13"},
    4: {"name": "Spring 2", "approx_start": "2026-02-23", "approx_end": "2026-03-27"},
    5: {"name": "Summer 1", "approx_start": "2026-04-13", "approx_end": "2026-05-22"},
    6: {"name": "Summer 2", "approx_start": "2026-06-01", "approx_end": "2026-07-22"},
}

# Arbor parent portal
ARBOR_URL = "https://stocks-green-primary-school.uk.arbor.sc"
ARBOR_EMAIL = os.environ.get("ARBOR_EMAIL", "chrishadley1983@gmail.com")
ARBOR_PASSWORD = os.environ.get("ARBOR_PASSWORD", "Emmie2018!!!")

# Pushover config for urgent alerts
PUSHOVER_USER_KEY = os.environ.get("PUSHOVER_USER_KEY")
PUSHOVER_API_TOKEN = os.environ.get("PUSHOVER_API_TOKEN")

# Load Pushover from .env.local too
if not PUSHOVER_USER_KEY:
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("PUSHOVER_USER_KEY="):
                    PUSHOVER_USER_KEY = line.split("=", 1)[1].strip()
                elif line.startswith("PUSHOVER_APP_TOKEN=") or line.startswith("PUSHOVER_API_TOKEN="):
                    PUSHOVER_API_TOKEN = line.split("=", 1)[1].strip()
