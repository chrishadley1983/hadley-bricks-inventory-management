"""Shared configuration for Octopus Energy integration."""
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

# Octopus Energy API
OCTOPUS_API_KEY = os.environ.get("OCTOPUS_API_KEY", "")

# Load from .env.local if not in environment
if not OCTOPUS_API_KEY:
    _env_path = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", ".env.local")
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line.startswith("OCTOPUS_API_KEY="):
                    OCTOPUS_API_KEY = _line.split("=", 1)[1].strip()
OCTOPUS_ACCOUNT = "A-8B718918"
OCTOPUS_REST_BASE = "https://api.octopus.energy/v1"
OCTOPUS_GRAPHQL_URL = "https://api.octopus.energy/v1/graphql/"

# Meter details
ELECTRICITY_MPAN = "1900006287208"
ELECTRICITY_SERIAL = "20L3260811"
GAS_MPRN = "686296406"
GAS_SERIAL = "E6S12746312061"

# Tariff details
ELECTRICITY_PRODUCT = "INTELLI-VAR-24-10-29"
ELECTRICITY_TARIFF = "E-1R-INTELLI-VAR-24-10-29-J"
GAS_PRODUCT = "VAR-22-11-01"
GAS_TARIFF = "G-1R-VAR-22-11-01-J"

# Intelligent Go rate boundaries (UTC)
# Off-peak: 23:30 - 05:30 UTC (same year-round, no DST adjustment on API side)
OFFPEAK_START_HOUR = 23
OFFPEAK_START_MIN = 30
OFFPEAK_END_HOUR = 5
OFFPEAK_END_MIN = 30

# Gas conversion: SMETS2 meters report m³, multiply by ~11.1 for kWh
# More precise: m³ × volume_correction(1.02264) × calorific_value(~39.2) / 3.6
GAS_M3_TO_KWH = 11.1

# EV detection: if off-peak electricity > this threshold, flag as EV charge day
EV_OFFPEAK_THRESHOLD_KWH = 5.0

# Discord webhook for #energy channel
DISCORD_ENERGY_WEBHOOK = "https://discord.com/api/webhooks/1479092074396778699/4oWmdArIPCAygEa7tlQejBdfWGLajR2l9KwerpCrdgC2zHAPH18m3ktablVT3v4Fsw_s"
