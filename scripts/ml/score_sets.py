"""
Phase 5: Score active/retiring_soon sets with trained LightGBM models.

For each active set:
1. Build feature vector (same pipeline as training)
2. Run through 12 LightGBM models (4 horizons x 3 quantiles)
3. Convert log predictions back to percentages
4. Compute confidence per horizon from IQR spread
5. Compute composite investment score
6. Upsert to investment_predictions
"""

import json
import logging
import math
import pickle
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from supabase import create_client

from config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    MODELS_DIR,
    HORIZONS,
    QUANTILES,
    SCORE_WEIGHTS,
    MODEL_VERSION,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Same ordinal encoding as engineer_features.py
EXCLUSIVITY_ORDINAL = {
    "retail": 0,
    "unknown": 1,
    "limited": 2,
    "lego_exclusive": 3,
    "park_exclusive": 4,
    "promotional": 5,
}


def load_models() -> dict:
    """Load all trained models and feature lists from disk."""
    models = {}
    for horizon in HORIZONS:
        features_path = MODELS_DIR / f"{horizon}_features.json"
        if not features_path.exists():
            log.warning(f"No feature list for {horizon}, skipping")
            continue

        with open(features_path) as f:
            feature_cols = json.load(f)

        horizon_models = {}
        for q_name in QUANTILES:
            model_path = MODELS_DIR / f"{horizon}_{q_name}.pkl"
            if not model_path.exists():
                log.warning(f"No model file for {horizon}/{q_name}")
                continue
            with open(model_path, "rb") as f:
                horizon_models[q_name] = pickle.load(f)

        if len(horizon_models) == 3:
            models[horizon] = {"models": horizon_models, "features": feature_cols}
        else:
            log.warning(f"Incomplete models for {horizon} ({len(horizon_models)}/3)")

    log.info(f"Loaded models for {len(models)} horizons: {list(models.keys())}")
    return models


def _paginated_query(query_builder) -> list[dict]:
    """Run a paginated Supabase query and return all rows."""
    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        resp = query_builder.range(offset, offset + page_size - 1).execute()
        if not resp.data:
            break
        all_rows.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_rows


SCORE_COLUMNS = (
    "set_number, set_name, theme, subtheme, pieces, minifigs, age_min, "
    "rating, want_count, own_count, is_licensed, is_ucs, is_modular, "
    "exclusivity_tier, launch_date, exit_date, uk_retail_price, "
    "width, height, depth, retirement_status"
)


def fetch_active_sets() -> pd.DataFrame:
    """Fetch all scoreable sets: active, retiring_soon, AND recently-retired.

    Includes:
    1. retirement_status in ('available', 'retiring_soon') — the original query
    2. retirement_status = 'retired' with exit_date >= 2025-01-01 — recently retired
    """
    log.info("Fetching scoreable sets (active + recently retired)...")

    # Query 1: Active / retiring_soon (original)
    q1 = (
        supabase.table("brickset_sets")
        .select(SCORE_COLUMNS)
        .in_("retirement_status", ["available", "retiring_soon"])
        .not_.is_("uk_retail_price", "null")
        .gte("uk_retail_price", 5)
        .order("set_number")
    )
    active_rows = _paginated_query(q1)
    log.info(f"  Active/retiring_soon: {len(active_rows)}")

    # Query 2: Recently retired (exit_date >= 2025-01-01)
    q2 = (
        supabase.table("brickset_sets")
        .select(SCORE_COLUMNS)
        .eq("retirement_status", "retired")
        .gte("exit_date", "2025-01-01")
        .not_.is_("uk_retail_price", "null")
        .gte("uk_retail_price", 5)
        .order("set_number")
    )
    retired_rows = _paginated_query(q2)
    log.info(f"  Recently retired (exit >= 2025): {len(retired_rows)}")

    # Combine and deduplicate on set_number
    all_rows = active_rows + retired_rows
    df = pd.DataFrame(all_rows)
    if not df.empty:
        df = df.drop_duplicates(subset="set_number", keep="first")
        df["exit_date"] = pd.to_datetime(df["exit_date"], errors="coerce")
        df["launch_date"] = pd.to_datetime(df["launch_date"], errors="coerce")
    log.info(f"Found {len(df)} total sets to score")
    return df


def fetch_theme_stats() -> pd.DataFrame:
    """Fetch theme-level historical stats from training data (retired sets only)."""
    log.info("Computing theme-level historical stats from training data...")

    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("investment_training_data")
            .select("set_num, exit_date, target_6m, target_1yr, target_2yr, target_3yr")
            .in_("data_quality", ["good", "partial"])
            .order("exit_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_rows.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size

    train_df = pd.DataFrame(all_rows)

    # Need theme for each set
    set_nums = train_df["set_num"].tolist()
    all_meta = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, theme")
            .in_("set_number", batch)
            .execute()
        )
        all_meta.extend(resp.data)

    meta_df = pd.DataFrame(all_meta)
    merged = train_df.merge(meta_df, left_on="set_num", right_on="set_number", how="left")

    # Compute theme-level stats across ALL training data (for scoring active sets)
    stats = {}
    for horizon in HORIZONS:
        target_col = f"target_{horizon}"
        valid = merged[merged[target_col].notna()].copy()
        valid[target_col] = pd.to_numeric(valid[target_col])

        theme_stats = (
            valid.groupby("theme")[target_col]
            .agg(["mean", "median", "std", "count"])
            .rename(columns={
                "mean": f"theme_mean_log_{horizon}",
                "median": f"theme_median_log_{horizon}",
                "std": f"theme_std_log_{horizon}",
                "count": f"theme_sample_size_{horizon}",
            })
        )
        stats[horizon] = theme_stats

    return stats


def compute_active_trajectory_features(
    set_numbers: list[str], rrp_series: pd.Series
) -> pd.DataFrame:
    """Compute price trajectory features from price_snapshots for active sets.

    For active sets we compute "pre-retirement equivalent" features:
    - discount_at_retirement: (rrp - latest_price) / rrp
    - price_momentum_90d: linear slope of prices over last 90 days
    - price_volatility_180d: std dev of prices over last 180 days
    - seller_count_at_retirement: latest seller_count
    - buy_box_is_amazon: 1 if latest buy_box_winner contains 'amazon'
    """
    result = pd.DataFrame(index=range(len(set_numbers)), columns=[
        "discount_at_retirement",
        "price_momentum_90d",
        "price_volatility_180d",
        "seller_count_at_retirement",
        "buy_box_is_amazon",
    ])

    if not set_numbers:
        return result

    # Fetch price_snapshots for these sets (small batches to avoid timeout)
    all_snapshots = []
    batch_size = 20  # Small batches — each set can have hundreds of snapshots
    for i in range(0, len(set_numbers), batch_size):
        batch = set_numbers[i : i + batch_size]
        offset = 0
        page_size = 1000
        while True:
            resp = (
                supabase.table("price_snapshots")
                .select("set_num, date, price_gbp, seller_count, buy_box_winner")
                .in_("set_num", batch)
                .order("date")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            if not resp.data:
                break
            all_snapshots.extend(resp.data)
            if len(resp.data) < page_size:
                break
            offset += page_size

    if not all_snapshots:
        log.info("No price_snapshots found for active sets — trajectory features will be NaN")
        return result

    snap_df = pd.DataFrame(all_snapshots)
    snap_df["date"] = pd.to_datetime(snap_df["date"])
    snap_df["price_gbp"] = pd.to_numeric(snap_df["price_gbp"], errors="coerce")
    snap_df["seller_count"] = pd.to_numeric(snap_df["seller_count"], errors="coerce")

    log.info(
        f"Loaded {len(snap_df)} price snapshots for "
        f"{snap_df['set_num'].nunique()} sets"
    )

    # Build a lookup: set_number -> index in the original DataFrame
    sn_to_idx = {sn: i for i, sn in enumerate(set_numbers)}

    for set_num, group in snap_df.groupby("set_num"):
        idx = sn_to_idx.get(set_num)
        if idx is None:
            continue

        group = group.sort_values("date")
        prices = group["price_gbp"].dropna()

        if prices.empty:
            continue

        rrp = rrp_series.iloc[idx] if idx < len(rrp_series) else np.nan
        latest_price = prices.iloc[-1]

        # discount_at_retirement: (rrp - latest) / rrp
        if pd.notna(rrp) and rrp > 0:
            result.at[idx, "discount_at_retirement"] = (rrp - latest_price) / rrp

        # price_momentum_90d: linear slope over last 90 days
        cutoff_90 = group["date"].max() - timedelta(days=90)
        recent_90 = group[group["date"] >= cutoff_90]["price_gbp"].dropna()
        if len(recent_90) >= 2:
            x = np.arange(len(recent_90), dtype=float)
            y = recent_90.values.astype(float)
            slope = np.polyfit(x, y, 1)[0]
            # Normalise by mean price for comparability
            mean_price = y.mean()
            result.at[idx, "price_momentum_90d"] = (
                slope / mean_price if mean_price > 0 else 0
            )

        # price_volatility_180d: stddev over last 180 days
        cutoff_180 = group["date"].max() - timedelta(days=180)
        recent_180 = group[group["date"] >= cutoff_180]["price_gbp"].dropna()
        if len(recent_180) >= 2:
            mean_price = recent_180.mean()
            result.at[idx, "price_volatility_180d"] = (
                recent_180.std() / mean_price if mean_price > 0 else 0
            )

        # seller_count_at_retirement: latest value
        seller_counts = group["seller_count"].dropna()
        if not seller_counts.empty:
            result.at[idx, "seller_count_at_retirement"] = seller_counts.iloc[-1]

        # buy_box_is_amazon: 1 if latest contains "amazon"
        buy_box = group["buy_box_winner"].dropna()
        if not buy_box.empty:
            latest_bb = str(buy_box.iloc[-1]).lower()
            result.at[idx, "buy_box_is_amazon"] = 1.0 if "amazon" in latest_bb else 0.0

    # Convert to numeric
    for col in result.columns:
        result[col] = pd.to_numeric(result[col], errors="coerce")

    populated = result.notna().any(axis=1).sum()
    log.info(f"Trajectory features populated for {populated}/{len(set_numbers)} sets")

    return result


def build_features_for_scoring(
    df: pd.DataFrame, theme_stats: dict
) -> pd.DataFrame:
    """Build feature matrix for active sets (mirrors engineer_features.py logic)."""
    log.info("Building feature matrix for scoring...")

    features = pd.DataFrame(index=df.index)

    # Set-intrinsic features
    features["piece_count"] = pd.to_numeric(df["pieces"], errors="coerce")
    features["rrp_gbp"] = pd.to_numeric(df["uk_retail_price"], errors="coerce")
    features["price_per_piece"] = features["rrp_gbp"] / features["piece_count"].replace(0, np.nan)
    features["minifig_count"] = pd.to_numeric(df["minifigs"], errors="coerce").fillna(0)
    features["age_min"] = pd.to_numeric(df["age_min"], errors="coerce")
    features["rating"] = pd.to_numeric(df["rating"], errors="coerce")

    want = pd.to_numeric(df["want_count"], errors="coerce").fillna(0)
    own = pd.to_numeric(df["own_count"], errors="coerce").fillna(1)
    features["want_own_ratio"] = want / own.replace(0, 1)

    features["is_licensed"] = df["is_licensed"].astype(float).fillna(0)
    features["is_ucs"] = df["is_ucs"].astype(float).fillna(0)
    features["is_modular"] = df["is_modular"].astype(float).fillna(0)
    features["exclusivity_tier"] = df["exclusivity_tier"].map(EXCLUSIVITY_ORDINAL).fillna(1)

    # Production run
    if "launch_date" in df.columns and "exit_date" in df.columns:
        features["production_run_months"] = (
            (df["exit_date"] - df["launch_date"]).dt.days / 30.44
        ).clip(lower=0)
    else:
        features["production_run_months"] = np.nan

    # Box volume
    w = pd.to_numeric(df.get("width"), errors="coerce")
    h = pd.to_numeric(df.get("height"), errors="coerce")
    d = pd.to_numeric(df.get("depth"), errors="coerce")
    features["box_volume"] = w * h * d

    # Temporal (use exit_date if available, else current year)
    exit_years = df["exit_date"].dt.year.fillna(datetime.now().year)
    features["retirement_year"] = exit_years
    features["retirement_quarter"] = df["exit_date"].dt.quarter.fillna(1)

    # Price trajectory features — compute from price_snapshots where available
    set_numbers = df["set_number"].tolist()
    traj = compute_active_trajectory_features(set_numbers, features["rrp_gbp"])
    traj.index = features.index  # Align indices
    features["discount_at_retirement"] = traj["discount_at_retirement"]
    features["price_momentum_90d"] = traj["price_momentum_90d"]
    features["price_volatility_180d"] = traj["price_volatility_180d"]
    features["seller_count_at_retirement"] = traj["seller_count_at_retirement"]
    features["buy_box_is_amazon"] = traj["buy_box_is_amazon"]

    # Theme-level historical features
    for horizon in HORIZONS:
        if horizon in theme_stats:
            ts = theme_stats[horizon]
            for col in ts.columns:
                features[col] = df["theme"].map(ts[col])

    return features


def compute_confidence(p25: float, p75: float) -> float:
    """Confidence from quantile spread: 1 / (1 + IQR)."""
    iqr = abs(p75 - p25)
    return 1.0 / (1.0 + iqr)


def assess_risk_factors(row: dict, predictions: dict) -> list[dict]:
    """Assess risk factors for a set based on its features and predictions."""
    risks = []

    rrp = row.get("uk_retail_price") or 0
    pieces = row.get("pieces") or 0
    theme = row.get("theme", "")

    # Guard against NaN values
    try:
        rrp = float(rrp) if rrp and not (isinstance(rrp, float) and math.isnan(rrp)) else 0
        pieces = int(pieces) if pieces and not (isinstance(pieces, float) and math.isnan(pieces)) else 0
    except (ValueError, TypeError):
        rrp, pieces = 0, 0

    # High RRP risk
    if rrp > 200:
        risks.append({"factor": "high_rrp", "severity": "medium",
                       "detail": f"RRP of {rrp} may limit buyer pool"})

    # Low piece count (low perceived value)
    if pieces < 100 and rrp > 30:
        risks.append({"factor": "low_piece_count", "severity": "low",
                       "detail": "Low piece count relative to price"})

    # Theme concentration risk
    theme_n = predictions.get("theme_sample_size_1yr", 0)
    if theme_n and theme_n < 5:
        risks.append({"factor": "thin_theme_data", "severity": "medium",
                       "detail": f"Only {theme_n} historical comps for {theme}"})

    # Negative predicted appreciation
    pred_1yr = predictions.get("predicted_1yr_appreciation")
    if pred_1yr is not None and pred_1yr < 0:
        risks.append({"factor": "negative_forecast", "severity": "high",
                       "detail": "Model predicts price decline at 1yr"})

    # Wide prediction interval
    conf_1yr = predictions.get("confidence_1yr")
    if conf_1yr is not None and conf_1yr < 0.3:
        risks.append({"factor": "high_uncertainty", "severity": "medium",
                       "detail": "Wide prediction interval at 1yr"})

    return risks


def score_sets(df: pd.DataFrame, features: pd.DataFrame, models: dict) -> list[dict]:
    """Run all sets through all models and compute predictions."""
    log.info("Scoring sets...")

    # Get train R² and val R² from latest model runs for metadata
    model_meta = {}
    for horizon in HORIZONS:
        resp = (
            supabase.table("investment_model_runs")
            .select("train_r2, val_r2, model_version")
            .eq("horizon", horizon)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if resp.data:
            model_meta[horizon] = resp.data[0]

    predictions = []

    for idx, row in df.iterrows():
        set_num = row["set_number"]
        rrp = float(row["uk_retail_price"] or 0)
        # Capture trajectory feature values for diagnostics
        traj_features = {}
        for tf in [
            "discount_at_retirement", "price_momentum_90d",
            "price_volatility_180d", "seller_count_at_retirement",
            "buy_box_is_amazon",
        ]:
            val = features.loc[idx, tf] if tf in features.columns else None
            if pd.notna(val):
                traj_features[tf] = round(float(val), 4)

        pred = {
            "set_num": set_num,
            "model_version": MODEL_VERSION,
            "scored_at": datetime.utcnow().isoformat(),
            "features_used": {"trajectory": traj_features} if traj_features else {},
        }

        # Score through each horizon
        for horizon, hdata in models.items():
            feature_cols = hdata["features"]
            horizon_models = hdata["models"]

            # Build feature vector
            X = features.loc[[idx], [c for c in feature_cols if c in features.columns]].copy()
            # Add any missing columns as NaN
            for c in feature_cols:
                if c not in X.columns:
                    X[c] = np.nan

            X = X[feature_cols]

            # Fill NaN with 0 for prediction (models handle missing via splits)
            X = X.fillna(0)

            # Predict
            p25_log = float(horizon_models["p25"].predict(X)[0])
            p50_log = float(horizon_models["p50"].predict(X)[0])
            p75_log = float(horizon_models["p75"].predict(X)[0])

            # Convert log to appreciation percentage
            p25_pct = (math.exp(p25_log) - 1) * 100
            p50_pct = (math.exp(p50_log) - 1) * 100
            p75_pct = (math.exp(p75_log) - 1) * 100

            # Predicted price
            p50_price = rrp * math.exp(p50_log)

            # Confidence from IQR
            confidence = compute_confidence(p25_log, p75_log)

            # Map to column names
            h_short = horizon  # "6m", "1yr", "2yr", "3yr"
            pred[f"predicted_{h_short}_appreciation"] = round(p50_pct, 2)
            pred[f"predicted_{h_short}_price_gbp"] = round(p50_price, 2)
            pred[f"pred_{h_short}_p25"] = round(p25_pct, 2)
            pred[f"pred_{h_short}_p75"] = round(p75_pct, 2)
            pred[f"confidence_{h_short}"] = round(confidence, 4)

        # Composite investment score
        all_1yr_appreciations = []
        all_1yr_profits = []

        # Collect all 1yr appreciations for percentile ranking later
        pred["expected_profit_1yr_gbp"] = round(
            rrp * (pred.get("predicted_1yr_appreciation", 0) / 100), 2
        ) if pred.get("predicted_1yr_appreciation") is not None else None

        pred["expected_profit_3yr_gbp"] = round(
            rrp * (pred.get("predicted_3yr_appreciation", 0) / 100), 2
        ) if pred.get("predicted_3yr_appreciation") is not None else None

        # Risk-adjusted return (Sharpe-like: return / uncertainty)
        conf_1yr = pred.get("confidence_1yr", 0.5)
        app_1yr = pred.get("predicted_1yr_appreciation", 0)
        pred["risk_adjusted_score"] = round(app_1yr * conf_1yr, 4) if app_1yr else 0

        # Store theme sample size for risk assessment
        pred["theme_sample_size_1yr"] = features.loc[idx].get("theme_sample_size_1yr", 0)

        # Model metadata
        meta_1yr = model_meta.get("1yr", {})
        pred["training_r2"] = meta_1yr.get("train_r2")
        pred["validation_r2"] = meta_1yr.get("val_r2")

        predictions.append(pred)

    # Compute percentile-based composite score across all predictions
    pred_df = pd.DataFrame(predictions)

    if not pred_df.empty and "predicted_1yr_appreciation" in pred_df.columns:
        # Percentile ranks (0-1)
        app_rank = pred_df["predicted_1yr_appreciation"].rank(pct=True).fillna(0.5)
        profit_rank = pred_df["expected_profit_1yr_gbp"].rank(pct=True).fillna(0.5)
        risk_rank = pred_df["risk_adjusted_score"].rank(pct=True).fillna(0.5)
        conf_vals = pred_df["confidence_1yr"].fillna(0.5)

        composite = (
            SCORE_WEIGHTS["appreciation_1yr"] * app_rank
            + SCORE_WEIGHTS["confidence_1yr"] * conf_vals
            + SCORE_WEIGHTS["expected_profit_1yr"] * profit_rank
            + SCORE_WEIGHTS["risk_adjusted"] * risk_rank
        ) * 10

        for i, pred in enumerate(predictions):
            pred["investment_score"] = round(float(composite.iloc[i]), 2)

            # Assess risk factors
            risks = assess_risk_factors(df.iloc[i].to_dict(), pred)
            pred["risk_factors"] = risks

            # Clean up temp fields
            pred.pop("theme_sample_size_1yr", None)

    return predictions


def upsert_predictions(predictions: list[dict]) -> int:
    """Upsert predictions to investment_predictions table."""
    log.info(f"Upserting {len(predictions)} predictions...")

    batch_size = 200
    total = 0
    for i in range(0, len(predictions), batch_size):
        batch = predictions[i : i + batch_size]
        # Clean NaN values
        clean_batch = []
        for pred in batch:
            clean = {}
            for k, v in pred.items():
                if isinstance(v, float) and math.isnan(v):
                    clean[k] = None
                elif isinstance(v, (np.integer,)):
                    clean[k] = int(v)
                elif isinstance(v, (np.floating,)):
                    clean[k] = None if np.isnan(v) else float(v)
                else:
                    clean[k] = v
            clean_batch.append(clean)

        supabase.table("investment_predictions").upsert(
            clean_batch, on_conflict="set_num"
        ).execute()
        total += len(clean_batch)

    log.info(f"Upserted {total} predictions")
    return total


def run() -> dict:
    """Execute the scoring pipeline."""
    log.info("=== Score Active Sets ===")

    # Load models
    models = load_models()
    if not models:
        log.error("No models found — run train_models.py first")
        return {"scored": 0}

    # Fetch active sets
    df = fetch_active_sets()
    if df.empty:
        log.warning("No active sets to score")
        return {"scored": 0}

    # Compute theme stats for feature building
    theme_stats = fetch_theme_stats()

    # Build features
    features = build_features_for_scoring(df, theme_stats)

    # Score
    predictions = score_sets(df, features, models)

    # Upsert
    scored = upsert_predictions(predictions)

    summary = {
        "scored": scored,
        "horizons": list(models.keys()),
        "model_version": MODEL_VERSION,
    }
    log.info(f"Scoring complete: {summary}")
    return summary


if __name__ == "__main__":
    run()
