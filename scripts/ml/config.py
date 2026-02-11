"""Configuration for the LEGO investment ML pipeline."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load env from the apps/web/.env.local (same Supabase creds the app uses)
_project_root = Path(__file__).resolve().parent.parent.parent
_env_path = _project_root / "apps" / "web" / ".env.local"
load_dotenv(_env_path)

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Paths
ML_DIR = Path(__file__).resolve().parent
MODELS_DIR = ML_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)

# Training data constants
MIN_RRP_GBP = 5
MIN_EXIT_YEAR = 2012
MIN_SNAPSHOTS_PER_WINDOW = 3  # relaxed from 5 — data is tight

# Milestone windows (days from exit_date): centre ± half-width
MILESTONES = {
    "retirement": (0, 15),
    "6m": (180, 30),
    "1yr": (365, 30),
    "2yr": (730, 30),
    "3yr": (1095, 30),
}

# Winsorisation percentiles
WINSOR_LOW = 0.02
WINSOR_HIGH = 0.98

# Temporal CV folds (train_end is inclusive, val/test are single years)
CV_FOLDS = [
    {"train_end": 2018, "val": 2019, "test": 2020},
    {"train_end": 2019, "val": 2020, "test": 2021},
    {"train_end": 2020, "val": 2021, "test": 2022},
    {"train_end": 2021, "val": 2022, "test": 2023},
    {"train_end": 2022, "val": 2023, "test": 2024},
]

# Horizons to train models for
HORIZONS = ["6m", "1yr", "2yr", "3yr"]

# Quantiles for prediction intervals
QUANTILES = {"p25": 0.25, "p50": 0.50, "p75": 0.75}

# Optuna trials
OPTUNA_TRIALS = 50

# Recency weighting: sets retiring >= this year get 2x weight
RECENCY_WEIGHT_YEAR = 2020
RECENCY_WEIGHT_MULTIPLIER = 2.0

# Composite score weights
SCORE_WEIGHTS = {
    "appreciation_1yr": 0.30,
    "confidence_1yr": 0.25,
    "expected_profit_1yr": 0.25,
    "risk_adjusted": 0.20,
}

# Model version tag
MODEL_VERSION = "v2.1"
