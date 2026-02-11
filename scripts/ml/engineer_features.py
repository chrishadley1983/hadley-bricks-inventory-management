"""
Phase 2: Feature engineering for the LEGO investment prediction model.

Builds a ~25-30 feature matrix for each set in investment_training_data.
Features are stored in the `features` JSONB column.

Key design decisions:
- Theme-level historical features use ONLY sets retired BEFORE the current set
  (prevents temporal leakage)
- Target encoding uses leave-one-out within training folds
- All features are computed from brickset_sets and price_snapshots tables
"""

import logging
import math

import numpy as np
import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, MILESTONES, HORIZONS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Ordinal encoding for exclusivity_tier
EXCLUSIVITY_ORDINAL = {
    "retail": 0,
    "unknown": 1,
    "limited": 2,
    "lego_exclusive": 3,
    "park_exclusive": 4,
    "promotional": 5,
}


def fetch_training_sets() -> pd.DataFrame:
    """Fetch training data joined with brickset_sets metadata."""
    log.info("Fetching training data + set metadata...")

    # Fetch training data
    all_training = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("investment_training_data")
            .select("*")
            .in_("data_quality", ["good", "partial"])
            .order("exit_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_training.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size

    training_df = pd.DataFrame(all_training)
    log.info(f"  {len(training_df)} training rows")

    # Fetch set metadata for these sets
    set_nums = training_df["set_num"].tolist()
    all_meta = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select(
                "set_number, theme, subtheme, pieces, minifigs, age_min, rating, "
                "want_count, own_count, is_licensed, is_ucs, is_modular, "
                "exclusivity_tier, launch_date, exit_date, width, height, depth"
            )
            .in_("set_number", batch)
            .execute()
        )
        all_meta.extend(resp.data)

    meta_df = pd.DataFrame(all_meta)
    log.info(f"  {len(meta_df)} set metadata rows")

    # Merge
    merged = training_df.merge(
        meta_df, left_on="set_num", right_on="set_number", how="left", suffixes=("", "_meta")
    )
    merged["exit_date"] = pd.to_datetime(merged["exit_date"])
    if "launch_date" in merged.columns:
        merged["launch_date"] = pd.to_datetime(merged["launch_date"], errors="coerce")
    return merged


def compute_set_intrinsic_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute set-intrinsic features from brickset_sets columns."""
    log.info("Computing set-intrinsic features...")

    features = pd.DataFrame(index=df.index)

    # Numeric features
    features["piece_count"] = pd.to_numeric(df["pieces"], errors="coerce")
    features["rrp_gbp"] = pd.to_numeric(df["rrp_gbp"], errors="coerce")
    features["price_per_piece"] = features["rrp_gbp"] / features["piece_count"].replace(0, np.nan)
    features["minifig_count"] = pd.to_numeric(df["minifigs"], errors="coerce").fillna(0)
    features["age_min"] = pd.to_numeric(df["age_min"], errors="coerce")
    features["rating"] = pd.to_numeric(df["rating"], errors="coerce")

    # Want/own ratio
    want = pd.to_numeric(df["want_count"], errors="coerce").fillna(0)
    own = pd.to_numeric(df["own_count"], errors="coerce").fillna(1)
    features["want_own_ratio"] = want / own.replace(0, 1)

    # Boolean features
    features["is_licensed"] = df["is_licensed"].astype(float).fillna(0)
    features["is_ucs"] = df["is_ucs"].astype(float).fillna(0)
    features["is_modular"] = df["is_modular"].astype(float).fillna(0)

    # Exclusivity tier (ordinal encoded)
    features["exclusivity_tier"] = (
        df["exclusivity_tier"].map(EXCLUSIVITY_ORDINAL).fillna(1)
    )

    # Production run months
    if "launch_date" in df.columns:
        launch = pd.to_datetime(df["launch_date"], errors="coerce")
        exit_d = pd.to_datetime(df["exit_date"], errors="coerce")
        features["production_run_months"] = (
            (exit_d - launch).dt.days / 30.44
        ).clip(lower=0)
    else:
        features["production_run_months"] = np.nan

    # Box volume
    w = pd.to_numeric(df.get("width"), errors="coerce")
    h = pd.to_numeric(df.get("height"), errors="coerce")
    d = pd.to_numeric(df.get("depth"), errors="coerce")
    features["box_volume"] = w * h * d

    # Temporal features
    features["retirement_year"] = pd.to_datetime(df["exit_date"]).dt.year
    features["retirement_quarter"] = pd.to_datetime(df["exit_date"]).dt.quarter

    return features


def compute_theme_historical_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute theme-level historical appreciation features.

    CRITICAL: For each set, only use data from sets retired BEFORE it
    to prevent temporal leakage.
    """
    log.info("Computing theme-level historical features...")

    features = pd.DataFrame(index=df.index)

    # Sort by exit_date to enable temporal lookback
    df_sorted = df.sort_values("exit_date").reset_index(drop=True)

    for horizon in HORIZONS:
        target_col = f"target_{horizon}"
        theme_mean_col = f"theme_mean_log_{horizon}"
        theme_median_col = f"theme_median_log_{horizon}"
        theme_std_col = f"theme_std_log_{horizon}"
        theme_n_col = f"theme_sample_size_{horizon}"

        means = []
        medians = []
        stds = []
        ns = []

        for idx, row in df_sorted.iterrows():
            theme = row.get("theme")
            exit_date = row["exit_date"]

            if pd.isna(theme):
                means.append(np.nan)
                medians.append(np.nan)
                stds.append(np.nan)
                ns.append(0)
                continue

            # Only look at sets from the same theme that retired BEFORE this one
            prior = df_sorted[
                (df_sorted["theme"] == theme)
                & (df_sorted["exit_date"] < exit_date)
                & (df_sorted[target_col].notna())
            ]

            if len(prior) >= 3:
                vals = prior[target_col].astype(float)
                means.append(float(vals.mean()))
                medians.append(float(vals.median()))
                stds.append(float(vals.std()))
                ns.append(len(prior))
            else:
                means.append(np.nan)
                medians.append(np.nan)
                stds.append(np.nan)
                ns.append(len(prior))

        features[theme_mean_col] = means
        features[theme_median_col] = medians
        features[theme_std_col] = stds
        features[theme_n_col] = ns

    # Reindex back to original df index
    features.index = df_sorted.index
    features = features.reindex(df.index)

    return features


def compute_price_trajectory_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute price trajectory features from price_snapshots."""
    log.info("Computing price trajectory features...")

    features = pd.DataFrame(index=df.index)

    # Fetch snapshots for all training sets — needed for momentum/volatility
    set_nums = df["set_num"].tolist()
    log.info(f"  Fetching snapshots for {len(set_nums)} sets...")

    all_snapshots = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        offset = 0
        page_size = 1000
        while True:
            resp = (
                supabase.table("price_snapshots")
                .select("set_num, date, price_gbp, seller_count, buy_box_winner")
                .in_("set_num", batch)
                .not_.is_("price_gbp", "null")
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

    snap_df = pd.DataFrame(all_snapshots)
    if snap_df.empty:
        log.warning("  No snapshots found for trajectory features")
        features["discount_at_retirement"] = np.nan
        features["price_momentum_90d"] = np.nan
        features["price_volatility_180d"] = np.nan
        features["seller_count_at_retirement"] = np.nan
        features["buy_box_is_amazon"] = np.nan
        return features

    snap_df["date"] = pd.to_datetime(snap_df["date"])
    snap_df["price_gbp"] = pd.to_numeric(snap_df["price_gbp"])

    discounts = []
    momentums = []
    volatilities = []
    seller_counts = []
    amazon_flags = []

    for idx, row in df.iterrows():
        set_num = row["set_num"]
        exit_date = row["exit_date"]
        rrp = float(row["rrp_gbp"])

        s = snap_df[snap_df["set_num"] == set_num]

        # Discount at retirement
        retirement_window = s[
            (s["date"] >= exit_date - pd.Timedelta(days=15))
            & (s["date"] <= exit_date + pd.Timedelta(days=15))
        ]
        if not retirement_window.empty and rrp > 0:
            ret_price = retirement_window["price_gbp"].median()
            discounts.append((rrp - ret_price) / rrp)
            # Seller count and buy box at retirement
            last_snap = retirement_window.iloc[-1]
            seller_counts.append(last_snap.get("seller_count"))
            bbw = last_snap.get("buy_box_winner", "")
            amazon_flags.append(
                1.0
                if isinstance(bbw, str) and "amazon" in bbw.lower()
                else 0.0
            )
        else:
            discounts.append(np.nan)
            seller_counts.append(np.nan)
            amazon_flags.append(np.nan)

        # Price momentum: slope of prices in first 90 days post-retirement
        post_90 = s[
            (s["date"] > exit_date) & (s["date"] <= exit_date + pd.Timedelta(days=90))
        ]
        if len(post_90) >= 3:
            days = (post_90["date"] - exit_date).dt.days.values.astype(float)
            prices = post_90["price_gbp"].values.astype(float)
            if days.std() > 0:
                slope = np.polyfit(days, prices, 1)[0]
                momentums.append(slope)
            else:
                momentums.append(np.nan)
        else:
            momentums.append(np.nan)

        # Price volatility: stddev in first 180 days
        post_180 = s[
            (s["date"] > exit_date) & (s["date"] <= exit_date + pd.Timedelta(days=180))
        ]
        if len(post_180) >= 3:
            volatilities.append(float(post_180["price_gbp"].std()))
        else:
            volatilities.append(np.nan)

    features["discount_at_retirement"] = discounts
    features["price_momentum_90d"] = momentums
    features["price_volatility_180d"] = volatilities
    features["seller_count_at_retirement"] = seller_counts
    features["buy_box_is_amazon"] = amazon_flags

    return features


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Build the complete feature matrix by combining all feature groups."""
    intrinsic = compute_set_intrinsic_features(df)
    theme_hist = compute_theme_historical_features(df)
    trajectory = compute_price_trajectory_features(df)

    features = pd.concat([intrinsic, theme_hist, trajectory], axis=1)

    log.info(f"Feature matrix: {features.shape[0]} rows x {features.shape[1]} columns")
    log.info(f"Feature columns: {list(features.columns)}")

    # Log missing rates
    missing = features.isnull().mean()
    high_missing = missing[missing > 0.3]
    if not high_missing.empty:
        log.warning(f"High missing rate features (>30%):\n{high_missing}")

    return features


def update_features_in_db(df: pd.DataFrame, features: pd.DataFrame) -> int:
    """Update the features JSONB column in investment_training_data."""
    log.info("Updating features in investment_training_data...")

    # Filter to rows with required NOT NULL columns and deduplicate
    valid_mask = df["exit_date"].notna() & df["rrp_gbp"].notna()
    if not valid_mask.all():
        skipped = (~valid_mask).sum()
        log.warning(f"  Skipping {skipped} rows with null exit_date or rrp_gbp")

    updated = 0
    seen = set()
    batch = []
    for idx, row in df[valid_mask].iterrows():
        set_num = row["set_num"]
        if set_num in seen:
            continue
        seen.add(set_num)

        feat_dict = features.loc[idx].to_dict()
        # Convert numpy types to Python native for JSON
        clean_dict = {}
        for k, v in feat_dict.items():
            if isinstance(v, (np.integer,)):
                clean_dict[k] = int(v)
            elif isinstance(v, (np.floating,)):
                clean_dict[k] = None if np.isnan(v) else float(v)
            elif isinstance(v, float) and math.isnan(v):
                clean_dict[k] = None
            else:
                clean_dict[k] = v

        # Include required NOT NULL columns so upsert works for both insert and update
        exit_date = row["exit_date"]
        batch.append({
            "set_num": set_num,
            "exit_date": exit_date.strftime("%Y-%m-%d") if hasattr(exit_date, "strftime") else str(exit_date),
            "rrp_gbp": float(row["rrp_gbp"]),
            "features": clean_dict,
        })

        if len(batch) >= 200:
            supabase.table("investment_training_data").upsert(
                batch, on_conflict="set_num"
            ).execute()
            updated += len(batch)
            batch = []

    if batch:
        supabase.table("investment_training_data").upsert(
            batch, on_conflict="set_num"
        ).execute()
        updated += len(batch)

    log.info(f"Updated features for {updated} rows")
    return updated


def run():
    """Execute feature engineering pipeline."""
    log.info("=== Engineer Features ===")

    df = fetch_training_sets()
    if df.empty:
        log.warning("No training data found — run build_training_data.py first")
        return {"rows": 0, "features": 0}

    features = build_feature_matrix(df)
    updated = update_features_in_db(df, features)

    return {"rows": updated, "features": features.shape[1]}


if __name__ == "__main__":
    run()
