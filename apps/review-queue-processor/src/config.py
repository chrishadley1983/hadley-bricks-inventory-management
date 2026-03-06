"""Configuration — loads settings from .env file."""

import os
import logging
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the project root (same directory as run.py)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


# Supabase
SUPABASE_URL = _require("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _require("SUPABASE_SERVICE_ROLE_KEY")

# Gmail SMTP
SMTP_SENDER = _require("SMTP_SENDER")
SMTP_APP_PASSWORD = _require("SMTP_APP_PASSWORD")
SMTP_RECIPIENT = _require("SMTP_RECIPIENT")

# Flags
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
