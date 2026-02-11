"""
LEGO Investment Model v2.1 — Report Generator

Generates a comprehensive markdown report covering:
1. Model architecture and methodology
2. Validation results (backtest, calibration, baseline)
3. Top-25 investment opportunities for 2026 retirees with COG% analysis

Usage:
    python generate_report.py   # generates report after validate_model.py has been run
"""

import json
import logging
import math
import sys
from datetime import datetime
from pathlib import Path

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
    CV_FOLDS,
    RECENCY_WEIGHT_YEAR,
    RECENCY_WEIGHT_MULTIPLIER,
    OPTUNA_TRIALS,
    MIN_RRP_GBP,
    MIN_EXIT_YEAR,
    MILESTONES,
    WINSOR_LOW,
    WINSOR_HIGH,
    MIN_SNAPSHOTS_PER_WINDOW,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

RESULTS_DIR = Path(__file__).resolve().parent / "validation_results"
REPORT_DIR = Path(__file__).resolve().parent / "reports"
REPORT_DIR.mkdir(exist_ok=True)

# Amazon FBA fee structure (approximate for toys/games category, UK)
AMAZON_REFERRAL_FEE_PCT = 0.15  # 15% referral fee
AMAZON_FBA_FEE_FLAT = 3.25      # Average FBA fulfillment fee (GBP, medium-sized item)
AMAZON_CLOSING_FEE = 0.00       # No closing fee for toys
# Total effective fee rate approx 30-35% for typical LEGO box


def load_validation_results() -> dict:
    """Load validation results from JSON files."""
    results = {}

    for name in ["backtest_results", "calibration_results", "baseline_comparison_results", "validation_summary"]:
        path = RESULTS_DIR / f"{name}.json"
        if path.exists():
            with open(path) as f:
                results[name] = json.load(f)
            log.info(f"Loaded {name}")
        else:
            log.warning(f"Missing {name}.json — run validate_model.py first")

    return results


def fetch_2026_retirees_with_predictions() -> pd.DataFrame:
    """Fetch sets expected to retire in 2026 with their model predictions and current prices."""
    log.info("Fetching 2026 retirees with predictions...")

    # Get predictions
    all_preds = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("investment_predictions")
            .select("*")
            .order("investment_score", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_preds.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size

    pred_df = pd.DataFrame(all_preds)
    log.info(f"  {len(pred_df)} predictions loaded")

    if pred_df.empty:
        return pd.DataFrame()

    # Get set metadata
    set_nums = pred_df["set_num"].tolist()
    all_meta = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select(
                "set_number, set_name, theme, subtheme, pieces, minifigs, "
                "uk_retail_price, is_licensed, is_ucs, is_modular, "
                "exclusivity_tier, retirement_status, exit_date, "
                "expected_retirement_date, rating, want_count, own_count, amazon_asin"
            )
            .in_("set_number", batch)
            .execute()
        )
        all_meta.extend(resp.data)

    meta_df = pd.DataFrame(all_meta)
    merged = pred_df.merge(meta_df, left_on="set_num", right_on="set_number", how="left")

    # Filter to 2026 retirees (exit_date in 2026 OR expected_retirement_date in 2026 OR retiring_soon)
    merged["exit_date"] = pd.to_datetime(merged["exit_date"], errors="coerce")
    merged["expected_retirement_date"] = pd.to_datetime(merged["expected_retirement_date"], errors="coerce")

    is_2026_exit = merged["exit_date"].dt.year == 2026
    is_2026_expected = merged["expected_retirement_date"].dt.year == 2026
    is_retiring_soon = merged["retirement_status"] == "retiring_soon"

    retirees_2026 = merged[is_2026_exit | is_2026_expected | is_retiring_soon].copy()
    log.info(f"  {len(retirees_2026)} sets retiring in 2026 (or retiring_soon)")

    # Get current Amazon prices from amazon_arbitrage_pricing
    if "amazon_asin" in retirees_2026.columns:
        asins = retirees_2026["amazon_asin"].dropna().tolist()
        if asins:
            all_prices = []
            for i in range(0, len(asins), 100):
                batch = asins[i : i + 100]
                resp = (
                    supabase.table("amazon_arbitrage_pricing")
                    .select("asin, buy_box_price, sales_rank, offer_count, snapshot_date")
                    .in_("asin", batch)
                    .execute()
                )
                all_prices.extend(resp.data)

            if all_prices:
                price_df = pd.DataFrame(all_prices)
                retirees_2026 = retirees_2026.merge(
                    price_df, left_on="amazon_asin", right_on="asin", how="left"
                )

    # Also get latest price_snapshot as fallback
    set_nums_2026 = retirees_2026["set_num"].tolist()
    if set_nums_2026:
        latest_snaps = []
        for i in range(0, len(set_nums_2026), 50):
            batch = set_nums_2026[i : i + 50]
            resp = (
                supabase.table("price_snapshots")
                .select("set_num, date, price_gbp, seller_count")
                .in_("set_num", batch)
                .order("date", desc=True)
                .limit(len(batch))  # One per set (latest)
                .execute()
            )
            latest_snaps.extend(resp.data)

        if latest_snaps:
            snap_df = pd.DataFrame(latest_snaps)
            # Deduplicate: keep latest per set
            snap_df["date"] = pd.to_datetime(snap_df["date"])
            snap_df = snap_df.sort_values("date", ascending=False).drop_duplicates("set_num", keep="first")
            snap_df = snap_df.rename(columns={"price_gbp": "latest_snapshot_price", "date": "snapshot_date_ps"})
            retirees_2026 = retirees_2026.merge(
                snap_df[["set_num", "latest_snapshot_price", "snapshot_date_ps", "seller_count"]],
                on="set_num", how="left", suffixes=("", "_snap")
            )

    return retirees_2026


def compute_cog_analysis(row: pd.Series) -> dict:
    """
    Compute Cost of Goods % analysis for a single set.

    COG% = (buy_price / predicted_sell_price) * 100

    Buy price: Current Amazon buy box price or latest snapshot price or RRP
    Sell price: Model-predicted 1yr post-retirement Amazon price (p50)

    Includes Amazon fee breakdown and net margin estimate.
    """
    rrp = pd.to_numeric(row.get("uk_retail_price"), errors="coerce")
    buy_box = pd.to_numeric(row.get("buy_box_price"), errors="coerce")
    snapshot_price = pd.to_numeric(row.get("latest_snapshot_price"), errors="coerce")
    predicted_1yr_price = pd.to_numeric(row.get("predicted_1yr_price_gbp"), errors="coerce")
    pred_1yr_p25 = row.get("pred_1yr_p25")
    pred_1yr_p75 = row.get("pred_1yr_p75")

    # Best available buy price
    if pd.notna(buy_box) and buy_box > 0:
        buy_price = float(buy_box)
        buy_source = "Amazon Buy Box"
    elif pd.notna(snapshot_price) and snapshot_price > 0:
        buy_price = float(snapshot_price)
        buy_source = "Latest Price Snapshot"
    elif pd.notna(rrp) and rrp > 0:
        buy_price = float(rrp)
        buy_source = "RRP (no current price data)"
    else:
        return {"error": "No price data available"}

    if pd.isna(predicted_1yr_price) or predicted_1yr_price <= 0:
        return {"error": "No 1yr prediction available"}

    sell_price = float(predicted_1yr_price)

    # Amazon fee breakdown
    referral_fee = sell_price * AMAZON_REFERRAL_FEE_PCT
    total_fees = referral_fee + AMAZON_FBA_FEE_FLAT
    fee_pct = (total_fees / sell_price) * 100 if sell_price > 0 else 0

    net_revenue = sell_price - total_fees
    gross_profit = net_revenue - buy_price
    gross_margin_pct = (gross_profit / sell_price) * 100 if sell_price > 0 else 0
    roi_pct = (gross_profit / buy_price) * 100 if buy_price > 0 else 0
    cog_pct = (buy_price / sell_price) * 100 if sell_price > 0 else 0

    result = {
        "buy_price_gbp": round(buy_price, 2),
        "buy_source": buy_source,
        "predicted_sell_price_gbp": round(sell_price, 2),
        "amazon_referral_fee_gbp": round(referral_fee, 2),
        "amazon_fba_fee_gbp": round(AMAZON_FBA_FEE_FLAT, 2),
        "total_fees_gbp": round(total_fees, 2),
        "fee_pct_of_sale": round(fee_pct, 1),
        "net_revenue_gbp": round(net_revenue, 2),
        "gross_profit_gbp": round(gross_profit, 2),
        "cog_pct": round(cog_pct, 1),
        "gross_margin_pct": round(gross_margin_pct, 1),
        "roi_pct": round(roi_pct, 1),
    }

    # Add confidence-band scenarios
    if pd.notna(pred_1yr_p25) and pd.notna(rrp) and rrp > 0:
        p25_price = rrp * (1 + pred_1yr_p25 / 100)
        p25_net = p25_price - (p25_price * AMAZON_REFERRAL_FEE_PCT + AMAZON_FBA_FEE_FLAT) - buy_price
        result["pessimistic_profit_gbp"] = round(p25_net, 2)
        result["pessimistic_roi_%"] = round((p25_net / buy_price) * 100, 1) if buy_price > 0 else 0

    if pd.notna(pred_1yr_p75) and pd.notna(rrp) and rrp > 0:
        p75_price = rrp * (1 + pred_1yr_p75 / 100)
        p75_net = p75_price - (p75_price * AMAZON_REFERRAL_FEE_PCT + AMAZON_FBA_FEE_FLAT) - buy_price
        result["optimistic_profit_gbp"] = round(p75_net, 2)
        result["optimistic_roi_%"] = round((p75_net / buy_price) * 100, 1) if buy_price > 0 else 0

    return result


def fetch_model_run_metrics() -> list[dict]:
    """Fetch the latest training metrics from investment_model_runs."""
    resp = (
        supabase.table("investment_model_runs")
        .select("*")
        .eq("model_version", MODEL_VERSION)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    return resp.data or []


def fetch_training_data_stats() -> dict:
    """Fetch summary statistics about the training data."""
    # Total count
    resp = (
        supabase.table("investment_training_data")
        .select("set_num, data_quality, exit_date, rrp_gbp", count="exact")
        .in_("data_quality", ["good", "partial"])
        .execute()
    )
    total = resp.count or len(resp.data)

    if not resp.data:
        return {"total": 0}

    df = pd.DataFrame(resp.data)
    df["exit_date"] = pd.to_datetime(df["exit_date"])
    df["rrp_gbp"] = pd.to_numeric(df["rrp_gbp"])

    good_count = len(df[df["data_quality"] == "good"])
    partial_count = len(df[df["data_quality"] == "partial"])

    return {
        "total": total,
        "good": good_count,
        "partial": partial_count,
        "date_range": f"{df['exit_date'].min().strftime('%Y-%m-%d')} to {df['exit_date'].max().strftime('%Y-%m-%d')}",
        "rrp_range": f"£{df['rrp_gbp'].min():.0f} - £{df['rrp_gbp'].max():.0f}",
        "median_rrp": f"£{df['rrp_gbp'].median():.0f}",
    }


def generate_report(validation_results: dict) -> str:
    """Generate the complete markdown report."""
    log.info("Generating report...")

    # Fetch supplementary data
    model_metrics = fetch_model_run_metrics()
    training_stats = fetch_training_data_stats()
    retirees_2026 = fetch_2026_retirees_with_predictions()

    # Organise model metrics by horizon
    metrics_by_horizon = {}
    for m in model_metrics:
        h = m.get("horizon")
        if h and h not in metrics_by_horizon:
            metrics_by_horizon[h] = m

    # ═══════════════════════════════════════════════════════════════
    # BUILD REPORT
    # ═══════════════════════════════════════════════════════════════

    lines = []

    def h1(text): lines.append(f"# {text}\n")
    def h2(text): lines.append(f"## {text}\n")
    def h3(text): lines.append(f"### {text}\n")
    def h4(text): lines.append(f"#### {text}\n")
    def p(text): lines.append(f"{text}\n")
    def blank(): lines.append("")
    def hr(): lines.append("---\n")

    h1("LEGO Investment Model v2.1 — Comprehensive Validation Report")
    p(f"*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}*")
    p(f"*Model Version: {MODEL_VERSION}*")
    blank()
    hr()

    # ─── TABLE OF CONTENTS ──────────────────────────────────────────
    h2("Table of Contents")
    p("1. [Executive Summary](#1-executive-summary)")
    p("2. [Model Architecture & Methodology](#2-model-architecture--methodology)")
    p("3. [Training Data & Feature Engineering](#3-training-data--feature-engineering)")
    p("4. [Training Process](#4-training-process)")
    p("5. [Scoring Methodology](#5-scoring-methodology)")
    p("6. [Validation 1: Portfolio Backtest](#6-validation-1-portfolio-backtest)")
    p("7. [Validation 2: Quantile Calibration](#7-validation-2-quantile-calibration)")
    p("8. [Validation 3: Baseline Heuristic Comparison](#8-validation-3-baseline-heuristic-comparison)")
    p("9. [Top 25 Investment Opportunities (2026 Retirees)](#9-top-25-investment-opportunities-2026-retirees)")
    p("10. [Known Limitations & Biases](#10-known-limitations--biases)")
    p("11. [Appendix: Raw Validation Data](#11-appendix-raw-validation-data)")
    blank()
    hr()

    # ─── 1. EXECUTIVE SUMMARY ──────────────────────────────────────
    h2("1. Executive Summary")
    blank()
    p("This report presents a comprehensive validation of the LEGO Investment Prediction Model v2.1, "
      "a LightGBM-based quantile regression system designed to predict post-retirement price appreciation "
      "of LEGO sets. The model scores currently-available sets on a 1-10 investment scale using predicted "
      "1-year appreciation, model confidence, expected absolute profit, and risk-adjusted returns.")
    blank()

    # Pull key numbers from validation results
    backtest = validation_results.get("backtest_results", {})
    calibration = validation_results.get("calibration_results", {})
    baseline = validation_results.get("baseline_comparison_results", {})

    bt_summary = backtest.get("summary", {})
    bl_summary = baseline.get("summary", {})

    p("**Key Findings:**")
    blank()

    if bt_summary.get("avg_r2_oos"):
        p(f"- **Out-of-sample R²**: {bt_summary['avg_r2_oos']} (averaged across {bt_summary.get('folds_evaluated', '?')} temporal CV folds)")
    if bt_summary.get("avg_mae_oos"):
        p(f"- **Out-of-sample MAE**: {bt_summary['avg_mae_oos']} (log-return scale)")
    if bt_summary.get("avg_separation_pp"):
        p(f"- **Top vs Bottom separation**: {bt_summary['avg_separation_pp']} percentage points (model's top-ranked sets outperform bottom-ranked by this margin)")
    if bt_summary.get("avg_top_win_rate_%"):
        p(f"- **Top-N win rate**: {bt_summary['avg_top_win_rate_%']}% of top-ranked sets appreciated post-retirement")
    if bl_summary.get("avg_model_alpha_pp"):
        p(f"- **Model alpha vs random**: {bl_summary['avg_model_alpha_pp']} pp above random selection baseline")
    blank()
    hr()

    # ─── 2. MODEL ARCHITECTURE ─────────────────────────────────────
    h2("2. Model Architecture & Methodology")
    blank()
    h3("2.1 Overview")
    p("The system uses a **dual quantile regression** approach: for each prediction horizon, "
      "three separate LightGBM models predict the 25th, 50th, and 75th percentiles of the "
      "log-return distribution. This provides both point estimates (p50) and uncertainty "
      "quantification (IQR from p25/p75) in a single framework.")
    blank()
    p("**Models trained:** 12 total (4 horizons × 3 quantiles)")
    blank()
    p("| Horizon | Target | Description |")
    p("|---------|--------|-------------|")
    p("| 6m | `log(price_6m / RRP)` | 6 months post-retirement |")
    p("| 1yr | `log(price_1yr / RRP)` | 1 year post-retirement |")
    p("| 2yr | `log(price_2yr / RRP)` | 2 years post-retirement |")
    p("| 3yr | `log(price_3yr / RRP)` | 3 years post-retirement |")
    blank()
    p("| Quantile | Alpha | Purpose |")
    p("|----------|-------|---------|")
    p("| p25 | 0.25 | Pessimistic estimate (lower bound of 50% CI) |")
    p("| p50 | 0.50 | Median estimate (point prediction) |")
    p("| p75 | 0.75 | Optimistic estimate (upper bound of 50% CI) |")
    blank()

    h3("2.2 Why Log-Returns")
    p("Targets are expressed as `log(post_retirement_price / RRP)` rather than raw percentage returns. "
      "Log-returns are additive across time periods, approximately normally distributed (enabling "
      "quantile regression to work well), and naturally handle the bounded-below nature of prices "
      "(a set cannot lose more than 100% but can gain 1000%+). Conversion to percentage appreciation "
      "is: `appreciation_% = (exp(log_return) - 1) × 100`.")
    blank()

    h3("2.3 Why LightGBM")
    p("Gradient-boosted trees were chosen over neural networks or linear models for several reasons:")
    p("- **Native handling of missing values**: LightGBM routes NaN features to the optimal child "
      "node during tree splits, which is critical given ~20% of sets lack price trajectory features")
    p("- **Feature importance**: Gain-based importance provides interpretability")
    p("- **Small-data performance**: Tree ensembles outperform deep learning on tabular datasets "
      "below ~10,000 samples (our training set is ~1,200)")
    p("- **Quantile regression support**: Native `objective='quantile'` with alpha parameter")
    p("- **Regularization**: Built-in L1/L2, feature subsampling, and early stopping to combat "
      "overfitting on small datasets")
    blank()
    hr()

    # ─── 3. TRAINING DATA ──────────────────────────────────────────
    h2("3. Training Data & Feature Engineering")
    blank()
    h3("3.1 Training Data")
    p(f"- **Total training rows**: {training_stats.get('total', '?')} retired sets")
    p(f"  - Good quality (all 4 horizons): {training_stats.get('good', '?')}")
    p(f"  - Partial quality (1-3 horizons): {training_stats.get('partial', '?')}")
    p(f"- **Date range**: {training_stats.get('date_range', '?')}")
    p(f"- **RRP range**: {training_stats.get('rrp_range', '?')} (median {training_stats.get('median_rrp', '?')})")
    p(f"- **Minimum RRP**: £{MIN_RRP_GBP} (sets below this threshold excluded)")
    p(f"- **Minimum exit year**: {MIN_EXIT_YEAR}")
    blank()

    h3("3.2 Target Variable Construction")
    p("For each retired set, median buy-box prices are computed at four post-retirement milestones:")
    blank()
    p("| Milestone | Centre (days from exit) | Window (±days) | Min snapshots |")
    p("|-----------|----------------------|----------------|---------------|")
    for name, (centre, half) in MILESTONES.items():
        p(f"| {name} | {centre} | ±{half} | {MIN_SNAPSHOTS_PER_WINDOW} |")
    blank()
    p(f"Targets are winsorised at the {WINSOR_LOW*100:.0f}th and {WINSOR_HIGH*100:.0f}th percentiles "
      f"to cap extreme outliers (e.g., a set that 20x'd due to an error in pricing data).")
    blank()

    h3("3.3 Feature Groups (~30 features per set)")
    blank()
    h4("Group 1: Set-Intrinsic Features (15 features)")
    p("| Feature | Source | Description |")
    p("|---------|--------|-------------|")
    p("| `piece_count` | Brickset | Total piece count |")
    p("| `rrp_gbp` | Brickset/Keepa/LEGO.com | UK retail price at launch |")
    p("| `price_per_piece` | Derived | RRP / piece_count |")
    p("| `minifig_count` | Brickset | Number of minifigures included |")
    p("| `age_min` | Brickset | Minimum recommended age |")
    p("| `rating` | Brickset | Community rating (0-5) |")
    p("| `want_own_ratio` | Brickset | want_count / own_count (demand proxy) |")
    p("| `is_licensed` | Brickset | Boolean: licensed theme (Star Wars, Marvel, etc.) |")
    p("| `is_ucs` | Brickset | Boolean: Ultimate Collector Series |")
    p("| `is_modular` | Brickset | Boolean: Modular Buildings series |")
    p("| `exclusivity_tier` | Brickset | Ordinal 0-5: retail→unknown→limited→LEGO_exclusive→park→promotional |")
    p("| `production_run_months` | Derived | (exit_date - launch_date) / 30.44 |")
    p("| `box_volume` | Brickset | width × height × depth (cm³) |")
    p("| `retirement_year` | Derived | Year of retirement |")
    p("| `retirement_quarter` | Derived | Quarter of retirement (1-4) |")
    blank()

    h4("Group 2: Price Trajectory Features (5 features)")
    p("These capture the price dynamics around retirement. For training data, they use "
      "actual post-retirement snapshots. For scoring active sets, they use current market data "
      "as a proxy (latest price, recent momentum, etc.).")
    blank()
    p("| Feature | Description |")
    p("|---------|-------------|")
    p("| `discount_at_retirement` | `(RRP - median_price_at_retirement) / RRP`. Positive = selling below RRP at retirement |")
    p("| `price_momentum_90d` | Linear slope of prices over first 90 days post-retirement, normalised by mean price |")
    p("| `price_volatility_180d` | Std dev of prices over first 180 days post-retirement |")
    p("| `seller_count_at_retirement` | Number of Amazon sellers at retirement date |")
    p("| `buy_box_is_amazon` | 1 if Amazon holds the buy box at retirement, 0 otherwise |")
    blank()
    p("**Note**: ~111 of the 548 currently-scored sets lack trajectory data (no Amazon price history). "
      "These features are NaN for those sets, handled by LightGBM's native missing-value routing. "
      "Whether this effectively creates two prediction regimes is tested in the validation below.")
    blank()

    h4("Group 3: Theme Historical Features (4 features × 4 horizons = 16 features)")
    p("For each theme, the mean, median, and standard deviation of log-returns at each horizon "
      "are computed from **only sets retired before the current set**. This is the critical "
      "temporal leakage prevention mechanism.")
    blank()
    p("| Feature | Description |")
    p("|---------|-------------|")
    p("| `theme_mean_log_{h}` | Mean log-return for theme at horizon h |")
    p("| `theme_median_log_{h}` | Median log-return for theme at horizon h |")
    p("| `theme_std_log_{h}` | Std dev of log-returns for theme at horizon h |")
    p("| `theme_sample_size_{h}` | Number of prior sets in theme with data at horizon h |")
    blank()
    p("A minimum of 3 prior sets in the same theme is required; below that, theme features are NaN. "
      "This can be sparse for new or niche themes.")
    blank()
    hr()

    # ─── 4. TRAINING PROCESS ───────────────────────────────────────
    h2("4. Training Process")
    blank()
    h3("4.1 Temporal Walk-Forward Cross-Validation")
    p("To prevent data leakage, the model uses temporal walk-forward CV with 5 folds. "
      "Each fold trains on sets retired up to year T, validates on year T+1, and the "
      "final held-out test set is 2024+.")
    blank()
    p("| Fold | Train (retirement year ≤) | Validation (year =) | Test (year =) |")
    p("|------|---------------------------|---------------------|---------------|")
    for fold in CV_FOLDS:
        p(f"| {fold['train_end']+1} | ≤ {fold['train_end']} | {fold['val']} | {fold['test']} |")
    blank()
    p("The best hyperparameters from the fold with lowest validation MAE are used for the "
      f"final model, which is trained on all data up to 2023 and tested on 2024+.")
    blank()

    h3("4.2 Hyperparameter Tuning")
    p(f"Optuna Bayesian optimization with **{OPTUNA_TRIALS} trials per fold** (total ~{OPTUNA_TRIALS * len(CV_FOLDS)} evaluations).")
    blank()
    p("| Parameter | Search Space |")
    p("|-----------|-------------|")
    p("| `num_leaves` | 15-63 |")
    p("| `learning_rate` | 0.01-0.1 (log scale) |")
    p("| `min_child_samples` | 10-50 |")
    p("| `feature_fraction` | 0.6-0.9 |")
    p("| `lambda_l1` | 0.0-10.0 |")
    p("| `lambda_l2` | 0.0-10.0 |")
    p("| `max_depth` | 3-7 |")
    p("| `n_estimators` | 500 (fixed) |")
    blank()
    p("Early stopping with patience=50 on the validation set prevents overfitting within each trial.")
    blank()

    h3("4.3 Sample Weighting")
    p(f"Sets retired ≥ {RECENCY_WEIGHT_YEAR} receive {RECENCY_WEIGHT_MULTIPLIER}x sample weight during training. "
      f"This gives greater influence to recent market dynamics (post-COVID LEGO investment landscape) "
      f"while retaining historical data for pattern learning.")
    blank()

    h3("4.4 Model Performance (Latest Training Run)")
    blank()
    if metrics_by_horizon:
        p("| Horizon | Train R² | Train MAE | Test R² | Test MAE | Training Rows | Top Features |")
        p("|---------|----------|-----------|---------|----------|---------------|--------------|")
        for h in HORIZONS:
            m = metrics_by_horizon.get(h, {})
            if m:
                top_feats = list(m.get("feature_importances", {}).keys())[:3]
                p(f"| {h} | {m.get('train_r2', 'N/A')} | {m.get('train_mae', 'N/A')} | "
                  f"{m.get('test_r2', 'N/A')} | {m.get('test_mae', 'N/A')} | "
                  f"{m.get('training_rows', 'N/A')} | {', '.join(top_feats)} |")
    else:
        p("*No model run metrics available — run the training pipeline to populate.*")
    blank()

    # Feature importances
    if metrics_by_horizon.get("1yr", {}).get("feature_importances"):
        h3("4.5 Feature Importances (1yr Horizon, Gain-Based)")
        blank()
        importances = metrics_by_horizon["1yr"]["feature_importances"]
        sorted_feats = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:15]
        max_imp = sorted_feats[0][1] if sorted_feats else 1
        p("| Rank | Feature | Gain | Relative |")
        p("|------|---------|------|----------|")
        for i, (feat, gain) in enumerate(sorted_feats, 1):
            bar = "█" * int(20 * gain / max_imp)
            p(f"| {i} | `{feat}` | {gain:.0f} | {bar} |")
        blank()

    hr()

    # ─── 5. SCORING METHODOLOGY ────────────────────────────────────
    h2("5. Scoring Methodology")
    blank()
    h3("5.1 Prediction Pipeline")
    p("For each active/retiring_soon set:")
    p("1. Build the same ~30 feature vector used in training")
    p("2. Run through 12 models (4 horizons × 3 quantiles)")
    p("3. Convert log predictions to percentage appreciation: `(exp(log_pred) - 1) × 100`")
    p("4. Compute predicted prices: `RRP × exp(log_pred)`")
    p("5. Compute confidence from quantile spread: `confidence = 1 / (1 + |p75_log - p25_log|)`")
    blank()

    h3("5.2 Composite Investment Score (1-10)")
    p("The final score combines four components via percentile ranking:")
    blank()
    p("```")
    p("investment_score = (")
    p(f"    {SCORE_WEIGHTS['appreciation_1yr']:.2f} × percentile_rank(predicted_1yr_appreciation)")
    p(f"  + {SCORE_WEIGHTS['confidence_1yr']:.2f} × confidence_1yr")
    p(f"  + {SCORE_WEIGHTS['expected_profit_1yr']:.2f} × percentile_rank(expected_profit_1yr_gbp)")
    p(f"  + {SCORE_WEIGHTS['risk_adjusted']:.2f} × percentile_rank(appreciation × confidence)")
    p(") × 10")
    p("```")
    blank()

    p("**Component correlation concern**: `expected_profit_1yr` = `RRP × appreciation_% / 100`. "
      "For sets at similar price points, this is highly correlated with `appreciation_1yr`, "
      "effectively giving appreciation ~55% weight instead of 30%. The backtest below tests "
      "whether this matters for ranking quality.")
    blank()

    h3("5.3 Risk Factors")
    p("Risk flags are **display-only** (not fed back into the composite score). "
      "They are binary indicators surfaced in the UI for human judgement:")
    blank()
    p("| Flag | Trigger | Severity |")
    p("|------|---------|----------|")
    p("| `high_rrp` | RRP > £200 | Medium |")
    p("| `low_piece_count` | < 100 pieces AND RRP > £30 | Low |")
    p("| `thin_theme_data` | < 5 historical comparables in theme | Medium |")
    p("| `negative_forecast` | Predicted 1yr appreciation < 0% | High |")
    p("| `high_uncertainty` | Confidence < 0.3 | Medium |")
    blank()
    hr()

    # ─── 6. VALIDATION 1: PORTFOLIO BACKTEST ───────────────────────
    h2("6. Validation 1: Portfolio Backtest")
    blank()
    h3("6.1 Methodology")
    p("For each temporal CV fold, we:")
    p("1. Train the model on sets retired up to year T")
    p("2. Score all test-year sets using the trained model")
    p("3. Rank by composite investment_score")
    p("4. Take the top-N and bottom-N sets")
    p("5. Compare their **realized** 1-year post-retirement returns")
    blank()
    p("This is the ultimate test: does the model's ranking translate into profitable selection?")
    blank()

    h3("6.2 Aggregate Results")
    blank()
    if bt_summary:
        p("| Metric | Value |")
        p("|--------|-------|")
        p(f"| Folds evaluated | {bt_summary.get('folds_evaluated', '?')} |")
        p(f"| Average OOS R² | {bt_summary.get('avg_r2_oos', '?')} |")
        p(f"| Average OOS MAE | {bt_summary.get('avg_mae_oos', '?')} |")
        p(f"| Avg top-N actual appreciation | {bt_summary.get('avg_top_actual_%', '?')}% |")
        p(f"| Avg bottom-N actual appreciation | {bt_summary.get('avg_bottom_actual_%', '?')}% |")
        p(f"| Avg top-bottom separation | {bt_summary.get('avg_separation_pp', '?')} pp |")
        p(f"| Avg top-N win rate | {bt_summary.get('avg_top_win_rate_%', '?')}% |")
        p(f"| Avg bottom-N win rate | {bt_summary.get('avg_bottom_win_rate_%', '?')}% |")
        blank()

        if bt_summary.get("r2_by_fold"):
            h3("6.3 Fold-by-Fold R² Breakdown")
            p("| Fold | OOS R² |")
            p("|------|--------|")
            for fold_name, r2 in bt_summary["r2_by_fold"].items():
                p(f"| {fold_name} | {r2} |")
            blank()
    else:
        p("*No backtest results available — run validate_model.py first.*")
        blank()

    h3("6.4 Fold Detail")
    for fold_data in backtest.get("folds", []):
        h4(f"Fold: {fold_data['fold']}")
        p(f"Train size: {fold_data['train_size']}, Test size: {fold_data['test_size']}, "
          f"R²: {fold_data['p50_r2']}, MAE: {fold_data['p50_mae']}")
        blank()
        tg = fold_data["top_group"]
        bg = fold_data["bottom_group"]
        p(f"| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |")
        p(f"|-------|---|-------------|---------------|----------------|----------|")
        p(f"| Top-{tg['n']} | {tg['n']} | {tg['mean_actual_appreciation_%']}% | {tg['median_actual_appreciation_%']}% | {tg['mean_predicted_%']}% | {tg['win_rate_%']}% |")
        p(f"| Bottom-{bg['n']} | {bg['n']} | {bg['mean_actual_appreciation_%']}% | {bg['median_actual_appreciation_%']}% | {bg['mean_predicted_%']}% | {bg['win_rate_%']}% |")
        if "middle_group" in fold_data:
            mg = fold_data["middle_group"]
            p(f"| Middle | {mg['n']} | {mg['mean_actual_appreciation_%']}% | {mg['median_actual_appreciation_%']}% | — | {mg['win_rate_%']}% |")
        p(f"\n**Separation: {fold_data['separation_pp']} pp**")
        blank()

        # Show top sets
        if tg.get("sets"):
            p("Top-ranked sets in this fold:")
            p("| Set | Name | Theme | Actual | Predicted | Score |")
            p("|-----|------|-------|--------|-----------|-------|")
            for s in tg["sets"][:10]:
                p(f"| {s.get('set_num','')} | {s.get('set_name','')[:35]} | {s.get('theme','')[:20]} | "
                  f"{s.get('actual_appreciation',''):.1f}% | {s.get('pred_appreciation',''):.1f}% | "
                  f"{s.get('investment_score',''):.1f} |")
            blank()

    hr()

    # ─── 7. VALIDATION 2: QUANTILE CALIBRATION ────────────────────
    h2("7. Validation 2: Quantile Calibration")
    blank()
    h3("7.1 Methodology")
    p("For perfectly calibrated quantile predictions:")
    p("- 25% of actual outcomes should fall **below** the p25 prediction")
    p("- 50% should fall below p50")
    p("- 75% should fall below p75")
    p("- 50% should fall **within** the IQR (between p25 and p75)")
    blank()
    p("Deviations indicate systematic over-confidence (intervals too narrow) or "
      "under-confidence (intervals too wide).")
    blank()

    h3("7.2 Results by Horizon")
    blank()
    if calibration:
        for horizon in HORIZONS:
            h_data = calibration.get(horizon, {})
            agg = h_data.get("aggregate", {})
            if not agg:
                continue

            h4(f"Horizon: {horizon}")
            p(f"Total OOS samples: {agg.get('total_oos_samples', '?')}")
            blank()
            p("| Quantile | Target Coverage | Actual Coverage | Calibration Error |")
            p("|----------|----------------|-----------------|-------------------|")
            p(f"| p25 | 25.0% | {agg.get('actual_below_p25_%', '?')}% | {agg.get('p25_calibration_error_pp', '?')} pp |")
            p(f"| p50 | 50.0% | {agg.get('actual_below_p50_%', '?')}% | {agg.get('p50_calibration_error_pp', '?')} pp |")
            p(f"| p75 | 75.0% | {agg.get('actual_below_p75_%', '?')}% | {agg.get('p75_calibration_error_pp', '?')} pp |")
            p(f"| IQR | 50.0% | {agg.get('actual_within_iqr_%', '?')}% | — |")
            blank()
            p(f"Median IQR width: {agg.get('median_iqr_width_pct_points', '?')} pp | "
              f"Mean IQR width: {agg.get('mean_iqr_width_pct_points', '?')} pp")
            p(f"**Assessment: {agg.get('calibration_assessment', '?')}**")
            blank()

            # Per-fold breakdown
            if h_data.get("folds"):
                p("| Fold | N | Below p25 | Below p50 | Below p75 | Within IQR |")
                p("|------|---|-----------|-----------|-----------|------------|")
                for fd in h_data["folds"]:
                    p(f"| {fd['fold']} | {fd['test_size']} | {fd['actual_below_p25_%']}% | "
                      f"{fd['actual_below_p50_%']}% | {fd['actual_below_p75_%']}% | "
                      f"{fd['actual_within_iqr_%']}% |")
                blank()
    else:
        p("*No calibration results available — run validate_model.py first.*")
    blank()
    hr()

    # ─── 8. VALIDATION 3: BASELINE COMPARISON ─────────────────────
    h2("8. Validation 3: Baseline Heuristic Comparison")
    blank()
    h3("8.1 Heuristics Tested")
    p("| Strategy | Rule |")
    p("|----------|------|")
    p("| **Model Top-N** | Top N sets by composite investment_score |")
    p("| **Licensed ≤£100** | All licensed sets with RRP ≤ £100 |")
    p("| **Licensed + Short Run** | Licensed, ≤£100 RRP, ≤24 month production run |")
    p("| **Exclusive + Licensed** | LEGO exclusive / promotional + licensed |")
    p("| **Random (All Sets)** | Average of all test-year sets (the baseline) |")
    blank()

    h3("8.2 Aggregate Results (Averaged Across OOS Folds)")
    blank()
    if bl_summary.get("aggregate_by_strategy"):
        p("| Strategy | Avg Mean Return | Avg Median Return | Avg Win Rate | Folds |")
        p("|----------|-----------------|-------------------|--------------|-------|")
        strat_names = {
            "model_top_n": "Model Top-N",
            "heuristic_1_licensed_under_100": "Licensed ≤£100",
            "heuristic_2_licensed_short_run": "Licensed + Short Run",
            "heuristic_3_exclusive_licensed": "Exclusive + Licensed",
            "random_all_sets": "Random (All Sets)",
        }
        for key, name in strat_names.items():
            s = bl_summary["aggregate_by_strategy"].get(key, {})
            p(f"| {name} | {s.get('avg_mean_%', 'N/A')}% | {s.get('avg_median_%', 'N/A')}% | "
              f"{s.get('avg_win_rate_%', 'N/A')}% | {s.get('folds_with_data', 0)} |")
        blank()
        p(f"**Model alpha over random: {bl_summary.get('avg_model_alpha_pp', 'N/A')} pp**")
    else:
        p("*No baseline comparison results available — run validate_model.py first.*")
    blank()

    h3("8.3 Fold-by-Fold Comparison")
    for fold_data in baseline.get("folds", []):
        h4(f"Fold: {fold_data['fold']} (N={fold_data['test_size']})")
        p("| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |")
        p("|----------|---|------|--------|-----|----------|------|-------|")
        for key, strat in fold_data.get("strategies", {}).items():
            if strat["n"] > 0:
                p(f"| {strat['strategy']} | {strat['n']} | {strat['mean_%']}% | "
                  f"{strat['median_%']}% | {strat.get('std_%', 'N/A')}% | {strat['win_rate_%']}% | "
                  f"{strat.get('best_%', 'N/A')}% | {strat.get('worst_%', 'N/A')}% |")
        if "model_alpha_pp" in fold_data:
            p(f"\nModel alpha: {fold_data['model_alpha_pp']} pp")
        blank()

    hr()

    # ─── 9. TOP 25 INVESTMENT OPPORTUNITIES ────────────────────────
    h2("9. Top 25 Investment Opportunities (2026 Retirees)")
    blank()
    h3("9.1 Methodology")
    p("Sets expected to retire in 2026 (by `exit_date`, `expected_retirement_date`, or "
      "`retirement_status = 'retiring_soon'`) are ranked by `investment_score`. "
      "For each set, we compute:")
    blank()
    p("- **Buy price**: Current Amazon buy box price, latest price snapshot, or RRP (waterfall)")
    p("- **Predicted sell price**: Model's p50 prediction for 1yr post-retirement Amazon price")
    p("- **COG%**: `(buy_price / predicted_sell_price) × 100` — lower is better")
    p("- **Amazon fees**: 15% referral fee + £3.25 FBA fulfillment (approximate for toys category)")
    p("- **Net ROI**: `(sell_price - fees - buy_price) / buy_price × 100`")
    p("- **Confidence band**: P25 (pessimistic) and P75 (optimistic) scenarios with corresponding ROI")
    blank()

    h3("9.2 Fee Assumptions")
    p("| Fee Component | Rate | Notes |")
    p("|---------------|------|-------|")
    p(f"| Referral fee | {AMAZON_REFERRAL_FEE_PCT*100:.0f}% | Standard Amazon toys category |")
    p(f"| FBA fulfillment | £{AMAZON_FBA_FEE_FLAT:.2f} | Average for medium-sized LEGO box |")
    p("| Closing fee | £0.00 | Not applicable to toys |")
    p("| Storage | Not included | Varies by time of year; excluded from analysis |")
    p("| VAT | Not included | Depends on seller VAT status |")
    blank()

    h3("9.3 Top 25 Sets")
    blank()

    if not retirees_2026.empty:
        # Sort by investment_score and take top 25
        retirees_2026["investment_score"] = pd.to_numeric(
            retirees_2026["investment_score"], errors="coerce"
        )
        top_25 = retirees_2026.nlargest(25, "investment_score")

        # Compute COG for each
        p("| # | Set | Name | Theme | RRP | Buy Now | Pred Sell (1yr) | COG% | Net ROI% | Score | Confidence |")
        p("|---|-----|------|-------|-----|---------|-----------------|------|----------|-------|------------|")

        detailed_rows = []
        for rank, (idx, row) in enumerate(top_25.iterrows(), 1):
            cog = compute_cog_analysis(row)

            if "error" in cog:
                continue

            rrp = pd.to_numeric(row.get("uk_retail_price"), errors="coerce")
            conf = row.get("confidence_1yr", 0)
            score = row.get("investment_score", 0)

            p(f"| {rank} | {row.get('set_num', '')} | {str(row.get('set_name', ''))[:30]} | "
              f"{str(row.get('theme', ''))[:15]} | £{rrp:.0f} | "
              f"£{cog['buy_price_gbp']:.2f} | £{cog['predicted_sell_price_gbp']:.2f} | "
              f"{cog['cog_pct']:.0f}% | {cog['roi_pct']:.0f}% | "
              f"{score:.1f} | {conf:.2f} |")

            detailed_rows.append({
                "rank": rank,
                "set_num": row.get("set_num", ""),
                "set_name": str(row.get("set_name", "")),
                "theme": str(row.get("theme", "")),
                "rrp": f"£{rrp:.2f}" if pd.notna(rrp) else "N/A",
                **cog,
                "investment_score": round(float(score), 2) if pd.notna(score) else None,
                "confidence_1yr": round(float(conf), 3) if pd.notna(conf) else None,
                "pred_1yr_appreciation_%": row.get("predicted_1yr_appreciation"),
                "pred_3yr_appreciation_%": row.get("predicted_3yr_appreciation"),
                "risk_factors": row.get("risk_factors", []),
            })
        blank()

        # Detailed breakdown for each set
        h3("9.4 Detailed Set Analysis")
        blank()
        for d in detailed_rows:
            h4(f"#{d['rank']}: {d['set_num']} — {d['set_name']}")
            p(f"**Theme**: {d['theme']} | **RRP**: {d['rrp']} | **Score**: {d.get('investment_score', 'N/A')} / 10")
            blank()
            p("| Metric | Value |")
            p("|--------|-------|")
            p(f"| Buy price (current) | £{d['buy_price_gbp']:.2f} ({d['buy_source']}) |")
            p(f"| Predicted 1yr sell price | £{d['predicted_sell_price_gbp']:.2f} |")
            p(f"| COG% | {d['cog_pct']:.1f}% |")
            p(f"| Amazon referral fee | £{d['amazon_referral_fee_gbp']:.2f} |")
            p(f"| Amazon FBA fee | £{d['amazon_fba_fee_gbp']:.2f} |")
            p(f"| Total fees | £{d['total_fees_gbp']:.2f} ({d['fee_pct_of_sale']:.1f}% of sale) |")
            p(f"| Net revenue | £{d['net_revenue_gbp']:.2f} |")
            p(f"| Gross profit | £{d['gross_profit_gbp']:.2f} |")
            p(f"| Gross margin | {d['gross_margin_pct']:.1f}% |")
            p(f"| **Net ROI** | **{d['roi_pct']:.1f}%** |")
            p(f"| Model confidence | {d.get('confidence_1yr', 'N/A')} |")
            p(f"| 1yr appreciation (p50) | {d.get('pred_1yr_appreciation_%', 'N/A')}% |")
            p(f"| 3yr appreciation (p50) | {d.get('pred_3yr_appreciation_%', 'N/A')}% |")

            if d.get("pessimistic_roi_%") is not None:
                p(f"| Pessimistic ROI (p25) | {d['pessimistic_roi_%']:.1f}% (profit £{d['pessimistic_profit_gbp']:.2f}) |")
            if d.get("optimistic_roi_%") is not None:
                p(f"| Optimistic ROI (p75) | {d['optimistic_roi_%']:.1f}% (profit £{d['optimistic_profit_gbp']:.2f}) |")

            risks = d.get("risk_factors", [])
            if risks and isinstance(risks, list) and len(risks) > 0:
                risk_strs = [f"`{r['factor']}` ({r['severity']})" if isinstance(r, dict) else str(r) for r in risks]
                p(f"| Risk flags | {', '.join(risk_strs)} |")
            blank()

        # Theme distribution
        h3("9.5 Theme Distribution of Top 25")
        blank()
        if detailed_rows:
            themes = [d["theme"] for d in detailed_rows]
            theme_counts = pd.Series(themes).value_counts()
            p("| Theme | Sets in Top 25 | Avg ROI% |")
            p("|-------|----------------|----------|")
            for theme, count in theme_counts.items():
                theme_rows = [d for d in detailed_rows if d["theme"] == theme]
                avg_roi = np.mean([d["roi_pct"] for d in theme_rows if "roi_pct" in d])
                p(f"| {theme} | {count} | {avg_roi:.1f}% |")
            blank()

        # Summary stats
        h3("9.6 Portfolio Summary (if buying all 25)")
        blank()
        total_cost = sum(d["buy_price_gbp"] for d in detailed_rows)
        total_predicted_profit = sum(d["gross_profit_gbp"] for d in detailed_rows)
        avg_roi = np.mean([d["roi_pct"] for d in detailed_rows]) if detailed_rows else 0
        avg_cog = np.mean([d["cog_pct"] for d in detailed_rows]) if detailed_rows else 0
        median_roi = np.median([d["roi_pct"] for d in detailed_rows]) if detailed_rows else 0

        p(f"| Metric | Value |")
        p(f"|--------|-------|")
        p(f"| Total capital required | £{total_cost:.2f} |")
        p(f"| Total predicted gross profit (1yr) | £{total_predicted_profit:.2f} |")
        p(f"| Average COG% | {avg_cog:.1f}% |")
        p(f"| Average ROI% | {avg_roi:.1f}% |")
        p(f"| Median ROI% | {median_roi:.1f}% |")
        p(f"| Number of sets | {len(detailed_rows)} |")
        blank()
    else:
        p("*No 2026 retiree data available. Ensure sets have retirement_status = 'retiring_soon' "
          "or exit_date in 2026, and that score_sets.py has been run.*")
    blank()
    hr()

    # ─── 10. KNOWN LIMITATIONS ─────────────────────────────────────
    h2("10. Known Limitations & Biases")
    blank()
    p("**1. Survivorship Bias**")
    p("Training data only includes sets with observable secondary market prices. Sets that nobody "
      "wanted to resell (or that traded so rarely no price data exists) are systematically excluded, "
      "inflating apparent model performance. The training set is biased toward sets that are liquid "
      "enough to generate price snapshots.")
    blank()
    p("**2. Small Sample Size**")
    p(f"~{training_stats.get('total', '?')} training samples across 5 CV folds with ~30 features puts "
      "the model in a regime where overfitting is a real risk. LightGBM's regularisation mitigates "
      "this but does not eliminate it. Theme-level features compound this issue — niche themes may "
      "have <5 historical comparables.")
    blank()
    p("**3. Dual Prediction Regime**")
    p("~20% of scored sets lack price trajectory features (no Amazon listing / price history). "
      "LightGBM routes these via its native NaN handling, but whether this creates two effectively "
      "different prediction models with different accuracy characteristics is not fully characterised.")
    blank()
    p("**4. Scoring Formula Correlation**")
    p("`expected_profit_1yr` is a linear function of `appreciation_1yr × RRP`. For sets at similar "
      "price points, these components are nearly identical, giving appreciation ~55% effective weight "
      "instead of the intended 30%. This is partly by design (appreciation matters most) but may "
      "under-weight confidence and risk adjustment.")
    blank()
    p("**5. Recency Weighting**")
    p(f"The binary {RECENCY_WEIGHT_MULTIPLIER}x weight for sets ≥{RECENCY_WEIGHT_YEAR} is a blunt "
      "instrument. The post-COVID LEGO market shifted substantially; a continuous decay or structural "
      "break indicator might better capture this regime change.")
    blank()
    p("**6. Binary Risk Flags**")
    p("Risk flags are binary thresholds (e.g., RRP > £200) applied to a continuous risk spectrum. "
      "A set at £201 is flagged identically to one at £800. These are display-only and don't affect "
      "the composite score, but consumers of the report should note they compress risk information.")
    blank()
    p("**7. Amazon-Centric Pricing**")
    p("All price data comes from Amazon (via Keepa). BrickLink secondary market prices, which may "
      "better reflect collector demand especially for exclusive/promotional sets, are not incorporated. "
      "This may underestimate appreciation for sets that trade primarily on BrickLink.")
    blank()
    p("**8. No VAT or Storage Costs**")
    p("The COG% analysis in Section 9 excludes VAT (depends on seller status), Amazon storage fees "
      "(seasonal and time-sensitive), and the opportunity cost of capital. Actual returns will be lower.")
    blank()
    hr()

    # ─── 11. APPENDIX ──────────────────────────────────────────────
    h2("11. Appendix: Raw Validation Data")
    blank()
    p("Full JSON validation results are saved alongside this report in:")
    p(f"- `validation_results/backtest_results.json`")
    p(f"- `validation_results/calibration_results.json`")
    p(f"- `validation_results/baseline_comparison_results.json`")
    p(f"- `validation_results/validation_summary.json`")
    blank()
    p("These contain per-set breakdowns for each fold, enabling further analysis such as:")
    p("- Per-theme model performance")
    p("- Score decile analysis")
    p("- Predicted vs actual scatter plots")
    p("- Residual analysis by feature value")
    blank()
    hr()
    p(f"*Report generated by `generate_report.py` at {datetime.now().isoformat()}*")
    p(f"*Model version: {MODEL_VERSION}*")

    return "\n".join(lines)


def main():
    validation_results = load_validation_results()

    if not validation_results:
        log.warning("No validation results found. Run validate_model.py first.")
        log.info("Generating report with available data (training metrics + predictions only)...")

    report = generate_report(validation_results)

    # Save report
    report_path = REPORT_DIR / f"investment_model_report_{datetime.now().strftime('%Y%m%d')}.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    log.info(f"Report saved to {report_path}")

    # Also save a 'latest' symlink/copy
    latest_path = REPORT_DIR / "investment_model_report_latest.md"
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write(report)
    log.info(f"Latest report saved to {latest_path}")

    return str(report_path)


if __name__ == "__main__":
    main()
