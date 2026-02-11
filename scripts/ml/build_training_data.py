"""
Phase 1: Build training data for the LEGO investment prediction model.

Computes median prices at 4 milestones (retirement, 6m, 1yr, 2yr, 3yr) for each
retired set, calculates log-return targets, applies winsorisation, and writes to
the investment_training_data table.
"""

import math
import logging

import numpy as np
import pandas as pd
from supabase import create_client

from config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    MIN_RRP_GBP,
    MIN_EXIT_YEAR,
    MIN_SNAPSHOTS_PER_WINDOW,
    MILESTONES,
    WINSOR_LOW,
    WINSOR_HIGH,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_retired_sets() -> pd.DataFrame:
    """Fetch all retired sets eligible for training."""
    log.info("Fetching retired sets from brickset_sets...")

    all_sets = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, exit_date, uk_retail_price")
            .eq("retirement_status", "retired")
            .gte("exit_date", f"{MIN_EXIT_YEAR}-01-01")
            .gte("uk_retail_price", MIN_RRP_GBP)
            .not_.is_("exit_date", "null")
            .order("exit_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_sets.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size

    df = pd.DataFrame(all_sets)
    df["exit_date"] = pd.to_datetime(df["exit_date"])
    df["uk_retail_price"] = pd.to_numeric(df["uk_retail_price"])
    log.info(f"Found {len(df)} retired sets eligible for training")
    return df


def fetch_price_snapshots(set_nums: list[str]) -> pd.DataFrame:
    """Fetch all price snapshots for the given set numbers."""
    log.info(f"Fetching price snapshots for {len(set_nums)} sets...")

    all_snapshots = []
    # Batch in chunks of 100 set_nums to avoid URL length limits
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

        if (i // batch_size) % 10 == 0:
            log.info(f"  Fetched snapshots for batch {i // batch_size + 1}/{(len(set_nums) + batch_size - 1) // batch_size}")

    df = pd.DataFrame(all_snapshots)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    df["price_gbp"] = pd.to_numeric(df["price_gbp"])
    log.info(f"Fetched {len(df)} total price snapshots")
    return df


def compute_milestone_prices(
    sets_df: pd.DataFrame, snapshots_df: pd.DataFrame
) -> pd.DataFrame:
    """Compute median prices at each milestone window for each set."""
    log.info("Computing milestone prices...")

    results = []

    for _, row in sets_df.iterrows():
        set_num = row["set_number"]
        exit_date = row["exit_date"]
        rrp = float(row["uk_retail_price"])

        set_snaps = snapshots_df[snapshots_df["set_num"] == set_num]
        if set_snaps.empty:
            continue

        prices = {}
        snapshot_count = len(set_snaps)

        for milestone, (centre_days, half_width) in MILESTONES.items():
            window_start = exit_date + pd.Timedelta(days=centre_days - half_width)
            window_end = exit_date + pd.Timedelta(days=centre_days + half_width)

            window_snaps = set_snaps[
                (set_snaps["date"] >= window_start) & (set_snaps["date"] <= window_end)
            ]

            if len(window_snaps) >= MIN_SNAPSHOTS_PER_WINDOW:
                prices[milestone] = float(window_snaps["price_gbp"].median())
            else:
                prices[milestone] = None

        # Compute log targets
        targets = {}
        for horizon in ["6m", "1yr", "2yr", "3yr"]:
            price = prices.get(horizon)
            if price is not None and price > 0 and rrp > 0:
                targets[f"target_{horizon}"] = math.log(price / rrp)
            else:
                targets[f"target_{horizon}"] = None

        # Determine data quality
        target_count = sum(1 for v in targets.values() if v is not None)
        if target_count == 4:
            quality = "good"
        elif target_count >= 1:
            quality = "partial"
        else:
            quality = "insufficient"

        results.append(
            {
                "set_num": set_num,
                "exit_date": exit_date.strftime("%Y-%m-%d"),
                "rrp_gbp": rrp,
                "price_at_retirement": prices.get("retirement"),
                "price_6m": prices.get("6m"),
                "price_1yr": prices.get("1yr"),
                "price_2yr": prices.get("2yr"),
                "price_3yr": prices.get("3yr"),
                "target_6m": targets["target_6m"],
                "target_1yr": targets["target_1yr"],
                "target_2yr": targets["target_2yr"],
                "target_3yr": targets["target_3yr"],
                "data_quality": quality,
                "snapshot_count": snapshot_count,
            }
        )

    df = pd.DataFrame(results)
    log.info(
        f"Computed milestones for {len(df)} sets: "
        f"{(df['data_quality'] == 'good').sum()} good, "
        f"{(df['data_quality'] == 'partial').sum()} partial, "
        f"{(df['data_quality'] == 'insufficient').sum()} insufficient"
    )
    return df


def winsorise_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Winsorise target columns at configured percentiles to cap outliers."""
    target_cols = ["target_6m", "target_1yr", "target_2yr", "target_3yr"]
    for col in target_cols:
        valid = df[col].dropna()
        if len(valid) < 10:
            continue
        low = valid.quantile(WINSOR_LOW)
        high = valid.quantile(WINSOR_HIGH)
        before_clip = df[col].describe()
        df[col] = df[col].clip(lower=low, upper=high)
        log.info(f"Winsorised {col}: clipped to [{low:.4f}, {high:.4f}]")
    return df


def upsert_training_data(df: pd.DataFrame) -> int:
    """Write training data to Supabase, upserting on set_num."""
    # Filter to rows with at least one target
    usable = df[df["data_quality"].isin(["good", "partial"])].copy()
    log.info(f"Upserting {len(usable)} rows to investment_training_data...")

    # Convert NaN/numpy types to JSON-safe Python types
    def clean_record(rec: dict) -> dict:
        clean = {}
        for k, v in rec.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                clean[k] = None
            elif isinstance(v, (np.integer,)):
                clean[k] = int(v)
            elif isinstance(v, (np.floating,)):
                clean[k] = None if np.isnan(v) else float(v)
            elif v is pd.NaT or v is np.nan:
                clean[k] = None
            else:
                clean[k] = v
        return clean

    records = [clean_record(r) for r in usable.to_dict("records")]

    # Deduplicate by set_num (keep first/most complete)
    seen = set()
    deduped = []
    for r in records:
        if r["set_num"] not in seen:
            seen.add(r["set_num"])
            deduped.append(r)
    if len(deduped) < len(records):
        log.info(f"  Removed {len(records) - len(deduped)} duplicate set_num entries")
    records = deduped

    # Batch upsert in chunks of 200
    batch_size = 200
    total = 0
    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        supabase.table("investment_training_data").upsert(
            batch, on_conflict="set_num"
        ).execute()
        total += len(batch)
        if (i // batch_size) % 5 == 0:
            log.info(f"  Upserted {total}/{len(records)} rows")

    log.info(f"Upsert complete: {total} rows written")
    return total


def run():
    """Execute the full training data build pipeline."""
    log.info("=== Build Training Data ===")

    # Step 1: Fetch retired sets
    sets_df = fetch_retired_sets()
    if sets_df.empty:
        log.warning("No retired sets found!")
        return {"rows": 0}

    # Step 2: Fetch price snapshots
    set_nums = sets_df["set_number"].tolist()
    snapshots_df = fetch_price_snapshots(set_nums)
    if snapshots_df.empty:
        log.warning("No price snapshots found!")
        return {"rows": 0}

    # Step 3: Compute milestone prices and log targets
    training_df = compute_milestone_prices(sets_df, snapshots_df)

    # Step 4: Winsorise targets
    training_df = winsorise_targets(training_df)

    # Step 5: Upsert to database
    rows = upsert_training_data(training_df)

    summary = {
        "rows": rows,
        "good": int((training_df["data_quality"] == "good").sum()),
        "partial": int((training_df["data_quality"] == "partial").sum()),
        "insufficient": int((training_df["data_quality"] == "insufficient").sum()),
    }
    log.info(f"Training data build complete: {summary}")
    return summary


if __name__ == "__main__":
    run()
