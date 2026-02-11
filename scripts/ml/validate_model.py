"""
LEGO Investment Model v2.1 — Validation Suite

Three validation tests:
1. Portfolio backtest: Top-N vs Bottom-N realized returns per OOS fold
2. Quantile calibration: Do p25/p75 predictions match actual coverage rates?
3. Baseline heuristic comparison: Does the model beat naive rules?

Usage:
    python validate_model.py              # run all 3 validations
    python validate_model.py --test backtest
    python validate_model.py --test calibration
    python validate_model.py --test baseline
"""

import argparse
import json
import logging
import math
import pickle
import sys
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from supabase import create_client

from config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    MODELS_DIR,
    CV_FOLDS,
    HORIZONS,
    QUANTILES,
    SCORE_WEIGHTS,
    MODEL_VERSION,
    RECENCY_WEIGHT_YEAR,
    RECENCY_WEIGHT_MULTIPLIER,
    OPTUNA_TRIALS,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

RESULTS_DIR = Path(__file__).resolve().parent / "validation_results"
RESULTS_DIR.mkdir(exist_ok=True)

# ─── Feature columns (same as train_models.py) ─────────────────────────

FEATURE_COLS = [
    "piece_count", "rrp_gbp", "price_per_piece", "minifig_count",
    "age_min", "rating", "want_own_ratio",
    "is_licensed", "is_ucs", "is_modular", "exclusivity_tier",
    "production_run_months", "box_volume",
    "retirement_year", "retirement_quarter",
    "discount_at_retirement", "price_momentum_90d",
    "price_volatility_180d", "seller_count_at_retirement", "buy_box_is_amazon",
]

THEME_FEATURE_TEMPLATE = [
    "theme_mean_log_{h}", "theme_median_log_{h}",
    "theme_std_log_{h}", "theme_sample_size_{h}",
]


def get_feature_cols(horizon: str) -> list[str]:
    base = FEATURE_COLS.copy()
    for tmpl in THEME_FEATURE_TEMPLATE:
        base.append(tmpl.format(h=horizon))
    return base


# ─── Data loading ───────────────────────────────────────────────────────

def load_full_training_data() -> pd.DataFrame:
    """Load all training data with features and metadata."""
    log.info("Loading training data...")

    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("investment_training_data")
            .select("*")
            .in_("data_quality", ["good", "partial"])
            .not_.is_("features", "null")
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

    df = pd.DataFrame(all_rows)
    df["exit_date"] = pd.to_datetime(df["exit_date"])
    df["retirement_year"] = df["exit_date"].dt.year

    # Expand features JSONB
    if "features" in df.columns and not df.empty:
        features_df = pd.json_normalize(df["features"])
        features_df.index = df.index
        overlap = features_df.columns.intersection(df.columns)
        if len(overlap) > 0:
            features_df = features_df.drop(columns=overlap)
        df = pd.concat([df, features_df], axis=1)

    # Fetch theme from brickset_sets
    set_nums = df["set_num"].tolist()
    all_meta = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, set_name, theme, pieces, uk_retail_price, is_licensed, exclusivity_tier, exit_date")
            .in_("set_number", batch)
            .execute()
        )
        all_meta.extend(resp.data)

    meta_df = pd.DataFrame(all_meta)
    if not meta_df.empty:
        # Avoid column name clashes
        meta_cols_to_use = ["set_number", "set_name", "theme"]
        if "pieces" not in df.columns:
            meta_cols_to_use.append("pieces")
        if "is_licensed" not in df.columns:
            meta_cols_to_use.append("is_licensed")
        meta_df = meta_df[meta_cols_to_use]
        df = df.merge(meta_df, left_on="set_num", right_on="set_number", how="left")

    log.info(f"Loaded {len(df)} training rows ({df['retirement_year'].min()}-{df['retirement_year'].max()})")
    return df


def compute_sample_weights(retirement_years: pd.Series) -> np.ndarray:
    weights = np.ones(len(retirement_years))
    recent_mask = retirement_years >= RECENCY_WEIGHT_YEAR
    weights[recent_mask] = RECENCY_WEIGHT_MULTIPLIER
    return weights


def prepare_features(df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    """Prepare feature matrix from dataframe."""
    available = [c for c in feature_cols if c in df.columns]
    X = df[available].copy()
    X = X.loc[:, ~X.columns.duplicated()]
    for col in X.columns:
        if X[col].dtype in ["object", "string"]:
            X[col] = pd.to_numeric(X[col], errors="coerce")
        X[col] = X[col].fillna(X[col].median())
    return X


# ═══════════════════════════════════════════════════════════════════════
# VALIDATION 1: PORTFOLIO BACKTEST
# ═══════════════════════════════════════════════════════════════════════

def run_portfolio_backtest(df: pd.DataFrame, top_n: int = 20) -> dict:
    """
    For each OOS fold, train models, rank sets by predicted investment_score,
    and compare realized 1yr returns for top-N vs bottom-N.
    """
    log.info("=" * 60)
    log.info("VALIDATION 1: Portfolio Backtest (Top-N vs Bottom-N)")
    log.info("=" * 60)

    horizon = "1yr"
    target_col = f"target_{horizon}"
    feature_cols = get_feature_cols(horizon)

    # Filter to rows with 1yr target
    mask = df[target_col].notna()
    hdf = df[mask].copy()

    results = []

    for fold in CV_FOLDS:
        train_end = fold["train_end"]
        test_year = fold["test"]

        train_mask = hdf["retirement_year"] <= train_end
        test_mask = hdf["retirement_year"] == test_year

        n_train = train_mask.sum()
        n_test = test_mask.sum()

        if n_train < 30 or n_test < 10:
            log.info(f"  Fold {train_end}→{test_year}: skipped (train={n_train}, test={n_test})")
            continue

        log.info(f"\n  Fold: train ≤{train_end}, test={test_year} (train={n_train}, test={n_test})")

        X_train = prepare_features(hdf[train_mask], feature_cols)
        y_train = hdf[train_mask][target_col].astype(float)
        X_test = prepare_features(hdf[test_mask], feature_cols)
        y_test = hdf[test_mask][target_col].astype(float)
        weights = compute_sample_weights(hdf[train_mask]["retirement_year"])

        # Align columns
        for c in X_train.columns:
            if c not in X_test.columns:
                X_test[c] = 0
        X_test = X_test[X_train.columns]

        # Train p25/p50/p75 for this fold
        fold_models = {}
        for q_name, q_val in QUANTILES.items():
            params = {
                "objective": "quantile",
                "alpha": q_val,
                "metric": "quantile",
                "verbosity": -1,
                "num_leaves": 31,
                "learning_rate": 0.05,
                "min_child_samples": 20,
                "feature_fraction": 0.8,
                "n_estimators": 500,
                "max_depth": 5,
            }
            train_data = lgb.Dataset(X_train, label=y_train, weight=weights)
            model = lgb.train(params, train_data)
            fold_models[q_name] = model

        # Predict on test set
        p50_preds = fold_models["p50"].predict(X_test)
        p25_preds = fold_models["p25"].predict(X_test)
        p75_preds = fold_models["p75"].predict(X_test)

        # Compute investment_score (same formula as score_sets.py)
        test_df = hdf[test_mask].copy()
        test_df["pred_appreciation"] = [(math.exp(p) - 1) * 100 for p in p50_preds]
        test_df["pred_p25"] = [(math.exp(p) - 1) * 100 for p in p25_preds]
        test_df["pred_p75"] = [(math.exp(p) - 1) * 100 for p in p75_preds]
        test_df["actual_appreciation"] = [(math.exp(t) - 1) * 100 for t in y_test]

        rrp = pd.to_numeric(test_df["rrp_gbp"], errors="coerce").fillna(30)
        test_df["pred_profit"] = rrp * (test_df["pred_appreciation"] / 100)
        test_df["confidence"] = [1.0 / (1.0 + abs(p75 - p25)) for p25, p75 in zip(p25_preds, p75_preds)]
        test_df["risk_adjusted"] = test_df["pred_appreciation"] * test_df["confidence"]

        # Percentile-rank composite score
        app_rank = test_df["pred_appreciation"].rank(pct=True).fillna(0.5)
        profit_rank = test_df["pred_profit"].rank(pct=True).fillna(0.5)
        risk_rank = test_df["risk_adjusted"].rank(pct=True).fillna(0.5)
        conf_vals = test_df["confidence"].fillna(0.5)

        test_df["investment_score"] = (
            SCORE_WEIGHTS["appreciation_1yr"] * app_rank
            + SCORE_WEIGHTS["confidence_1yr"] * conf_vals
            + SCORE_WEIGHTS["expected_profit_1yr"] * profit_rank
            + SCORE_WEIGHTS["risk_adjusted"] * risk_rank
        ) * 10

        # Sort by score, take top and bottom N
        sorted_df = test_df.sort_values("investment_score", ascending=False)
        actual_top_n = min(top_n, len(sorted_df) // 3)  # At least 3 groups

        if actual_top_n < 5:
            log.info(f"  Too few test sets for meaningful top/bottom split")
            continue

        top = sorted_df.head(actual_top_n)
        bottom = sorted_df.tail(actual_top_n)
        middle = sorted_df.iloc[actual_top_n:-actual_top_n] if len(sorted_df) > 2 * actual_top_n else pd.DataFrame()

        # P50 model metrics on this fold
        r2 = r2_score(y_test, p50_preds)
        mae = mean_absolute_error(y_test, p50_preds)

        fold_result = {
            "fold": f"train≤{train_end}, test={test_year}",
            "train_size": int(n_train),
            "test_size": int(n_test),
            "top_n": actual_top_n,
            "p50_r2": round(r2, 4),
            "p50_mae": round(mae, 4),
            "top_group": {
                "n": len(top),
                "mean_actual_appreciation_%": round(top["actual_appreciation"].mean(), 2),
                "median_actual_appreciation_%": round(top["actual_appreciation"].median(), 2),
                "mean_predicted_%": round(top["pred_appreciation"].mean(), 2),
                "win_rate_%": round((top["actual_appreciation"] > 0).mean() * 100, 1),
                "mean_score": round(top["investment_score"].mean(), 2),
                "sets": top[["set_num", "set_name", "theme", "actual_appreciation", "pred_appreciation", "investment_score"]].to_dict("records") if "set_name" in top.columns else [],
            },
            "bottom_group": {
                "n": len(bottom),
                "mean_actual_appreciation_%": round(bottom["actual_appreciation"].mean(), 2),
                "median_actual_appreciation_%": round(bottom["actual_appreciation"].median(), 2),
                "mean_predicted_%": round(bottom["pred_appreciation"].mean(), 2),
                "win_rate_%": round((bottom["actual_appreciation"] > 0).mean() * 100, 1),
                "mean_score": round(bottom["investment_score"].mean(), 2),
                "sets": bottom[["set_num", "set_name", "theme", "actual_appreciation", "pred_appreciation", "investment_score"]].to_dict("records") if "set_name" in bottom.columns else [],
            },
            "separation_pp": round(
                top["actual_appreciation"].mean() - bottom["actual_appreciation"].mean(), 2
            ),
        }

        if not middle.empty:
            fold_result["middle_group"] = {
                "n": len(middle),
                "mean_actual_appreciation_%": round(middle["actual_appreciation"].mean(), 2),
                "median_actual_appreciation_%": round(middle["actual_appreciation"].median(), 2),
                "win_rate_%": round((middle["actual_appreciation"] > 0).mean() * 100, 1),
            }

        results.append(fold_result)

        log.info(f"  R²={r2:.4f}, MAE={mae:.4f}")
        log.info(f"  Top-{actual_top_n}: mean actual={fold_result['top_group']['mean_actual_appreciation_%']}%, "
                 f"win rate={fold_result['top_group']['win_rate_%']}%")
        log.info(f"  Bot-{actual_top_n}: mean actual={fold_result['bottom_group']['mean_actual_appreciation_%']}%, "
                 f"win rate={fold_result['bottom_group']['win_rate_%']}%")
        log.info(f"  Separation: {fold_result['separation_pp']} pp")

    # Aggregate
    if results:
        agg = {
            "folds_evaluated": len(results),
            "avg_r2_oos": round(np.mean([r["p50_r2"] for r in results]), 4),
            "avg_mae_oos": round(np.mean([r["p50_mae"] for r in results]), 4),
            "r2_by_fold": {r["fold"]: r["p50_r2"] for r in results},
            "avg_top_actual_%": round(np.mean([r["top_group"]["mean_actual_appreciation_%"] for r in results]), 2),
            "avg_bottom_actual_%": round(np.mean([r["bottom_group"]["mean_actual_appreciation_%"] for r in results]), 2),
            "avg_separation_pp": round(np.mean([r["separation_pp"] for r in results]), 2),
            "avg_top_win_rate_%": round(np.mean([r["top_group"]["win_rate_%"] for r in results]), 1),
            "avg_bottom_win_rate_%": round(np.mean([r["bottom_group"]["win_rate_%"] for r in results]), 1),
        }
    else:
        agg = {"folds_evaluated": 0, "error": "No valid folds"}

    output = {"summary": agg, "folds": results}

    # Save
    out_path = RESULTS_DIR / "backtest_results.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    log.info(f"\nBacktest results saved to {out_path}")

    return output


# ═══════════════════════════════════════════════════════════════════════
# VALIDATION 2: QUANTILE CALIBRATION
# ═══════════════════════════════════════════════════════════════════════

def run_quantile_calibration(df: pd.DataFrame) -> dict:
    """
    For each horizon, check whether actual coverage rates match
    the nominal quantile levels (25%, 50%, 75%).

    Perfect calibration:
    - ~25% of actuals should fall below p25 predictions
    - ~50% below p50
    - ~75% below p75
    """
    log.info("=" * 60)
    log.info("VALIDATION 2: Quantile Calibration")
    log.info("=" * 60)

    results = {}

    for horizon in HORIZONS:
        target_col = f"target_{horizon}"
        feature_cols = get_feature_cols(horizon)

        mask = df[target_col].notna()
        hdf = df[mask].copy()

        if len(hdf) < 50:
            log.info(f"  {horizon}: skipped (only {len(hdf)} samples)")
            continue

        log.info(f"\n  Horizon: {horizon} ({len(hdf)} samples)")

        horizon_results = {"folds": [], "aggregate": {}}

        all_actuals = []
        all_p25 = []
        all_p50 = []
        all_p75 = []
        all_years = []

        for fold in CV_FOLDS:
            train_mask = hdf["retirement_year"] <= fold["train_end"]
            test_mask = hdf["retirement_year"] == fold["test"]

            if train_mask.sum() < 30 or test_mask.sum() < 5:
                continue

            X_train = prepare_features(hdf[train_mask], feature_cols)
            y_train = hdf[train_mask][target_col].astype(float)
            X_test = prepare_features(hdf[test_mask], feature_cols)
            y_test = hdf[test_mask][target_col].astype(float).values

            weights = compute_sample_weights(hdf[train_mask]["retirement_year"])

            # Align columns
            for c in X_train.columns:
                if c not in X_test.columns:
                    X_test[c] = 0
            X_test = X_test[X_train.columns]

            # Train quantile models for this fold
            fold_preds = {}
            for q_name, q_val in QUANTILES.items():
                params = {
                    "objective": "quantile",
                    "alpha": q_val,
                    "metric": "quantile",
                    "verbosity": -1,
                    "num_leaves": 31,
                    "learning_rate": 0.05,
                    "min_child_samples": 20,
                    "feature_fraction": 0.8,
                    "n_estimators": 500,
                    "max_depth": 5,
                }
                train_data = lgb.Dataset(X_train, label=y_train, weight=weights)
                model = lgb.train(params, train_data)
                fold_preds[q_name] = model.predict(X_test)

            # Calibration: what fraction of actuals fall below each quantile?
            below_p25 = (y_test < fold_preds["p25"]).mean()
            below_p50 = (y_test < fold_preds["p50"]).mean()
            below_p75 = (y_test < fold_preds["p75"]).mean()
            within_iqr = ((y_test >= fold_preds["p25"]) & (y_test <= fold_preds["p75"])).mean()

            fold_cal = {
                "fold": f"train≤{fold['train_end']}, test={fold['test']}",
                "test_size": int(test_mask.sum()),
                "actual_below_p25_%": round(below_p25 * 100, 1),
                "actual_below_p50_%": round(below_p50 * 100, 1),
                "actual_below_p75_%": round(below_p75 * 100, 1),
                "actual_within_iqr_%": round(within_iqr * 100, 1),
                "p25_calibration_error": round(abs(below_p25 - 0.25) * 100, 1),
                "p50_calibration_error": round(abs(below_p50 - 0.50) * 100, 1),
                "p75_calibration_error": round(abs(below_p75 - 0.75) * 100, 1),
            }

            horizon_results["folds"].append(fold_cal)

            # Collect for aggregate
            all_actuals.extend(y_test.tolist())
            all_p25.extend(fold_preds["p25"].tolist())
            all_p50.extend(fold_preds["p50"].tolist())
            all_p75.extend(fold_preds["p75"].tolist())
            all_years.extend([fold["test"]] * len(y_test))

            log.info(f"    Fold {fold['test']}: below_p25={below_p25*100:.1f}% (target 25%), "
                     f"below_p50={below_p50*100:.1f}% (target 50%), "
                     f"below_p75={below_p75*100:.1f}% (target 75%), "
                     f"within_IQR={within_iqr*100:.1f}% (target 50%)")

        # Aggregate across all folds
        if all_actuals:
            all_actuals = np.array(all_actuals)
            all_p25 = np.array(all_p25)
            all_p50 = np.array(all_p50)
            all_p75 = np.array(all_p75)

            agg_below_p25 = (all_actuals < all_p25).mean()
            agg_below_p50 = (all_actuals < all_p50).mean()
            agg_below_p75 = (all_actuals < all_p75).mean()
            agg_within_iqr = ((all_actuals >= all_p25) & (all_actuals <= all_p75)).mean()

            # Median prediction interval width (in appreciation %)
            iqr_widths = [(math.exp(p75) - 1) * 100 - (math.exp(p25) - 1) * 100
                          for p25, p75 in zip(all_p25, all_p75)]

            horizon_results["aggregate"] = {
                "total_oos_samples": len(all_actuals),
                "actual_below_p25_%": round(agg_below_p25 * 100, 1),
                "actual_below_p50_%": round(agg_below_p50 * 100, 1),
                "actual_below_p75_%": round(agg_below_p75 * 100, 1),
                "actual_within_iqr_%": round(agg_within_iqr * 100, 1),
                "target_within_iqr_%": 50.0,
                "p25_calibration_error_pp": round(abs(agg_below_p25 - 0.25) * 100, 1),
                "p50_calibration_error_pp": round(abs(agg_below_p50 - 0.50) * 100, 1),
                "p75_calibration_error_pp": round(abs(agg_below_p75 - 0.75) * 100, 1),
                "median_iqr_width_pct_points": round(np.median(iqr_widths), 1),
                "mean_iqr_width_pct_points": round(np.mean(iqr_widths), 1),
                "calibration_assessment": (
                    "well_calibrated" if max(
                        abs(agg_below_p25 - 0.25),
                        abs(agg_below_p50 - 0.50),
                        abs(agg_below_p75 - 0.75)
                    ) < 0.10 else
                    "moderately_calibrated" if max(
                        abs(agg_below_p25 - 0.25),
                        abs(agg_below_p50 - 0.50),
                        abs(agg_below_p75 - 0.75)
                    ) < 0.15 else
                    "poorly_calibrated"
                ),
            }

        results[horizon] = horizon_results

    # Save
    out_path = RESULTS_DIR / "calibration_results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    log.info(f"\nCalibration results saved to {out_path}")

    return results


# ═══════════════════════════════════════════════════════════════════════
# VALIDATION 3: BASELINE HEURISTIC COMPARISON
# ═══════════════════════════════════════════════════════════════════════

def run_baseline_comparison(df: pd.DataFrame, top_n: int = 20) -> dict:
    """
    Compare the model's top-N picks against simple heuristic strategies:

    Heuristic 1: "Licensed sets under £100"
    Heuristic 2: "Licensed sets under £100 with short production run (<24 months)"
    Heuristic 3: "LEGO exclusive + licensed"
    Heuristic 4: "Random selection" (average of all sets in test year)

    For each OOS fold, apply both model and heuristics, compare realized returns.
    """
    log.info("=" * 60)
    log.info("VALIDATION 3: Baseline Heuristic Comparison")
    log.info("=" * 60)

    horizon = "1yr"
    target_col = f"target_{horizon}"
    feature_cols = get_feature_cols(horizon)

    mask = df[target_col].notna()
    hdf = df[mask].copy()

    # Ensure we have the metadata columns needed for heuristics
    has_licensed = "is_licensed" in hdf.columns
    has_rrp = "rrp_gbp" in hdf.columns
    has_production_run = "production_run_months" in hdf.columns
    has_exclusivity = "exclusivity_tier" in hdf.columns

    results = []

    for fold in CV_FOLDS:
        train_mask = hdf["retirement_year"] <= fold["train_end"]
        test_mask = hdf["retirement_year"] == fold["test"]

        n_test = test_mask.sum()
        if train_mask.sum() < 30 or n_test < 10:
            continue

        test_year = fold["test"]
        log.info(f"\n  Fold: test={test_year} ({n_test} sets)")

        # ── Model predictions ──
        X_train = prepare_features(hdf[train_mask], feature_cols)
        y_train = hdf[train_mask][target_col].astype(float)
        X_test = prepare_features(hdf[test_mask], feature_cols)
        y_test = hdf[test_mask][target_col].astype(float)
        weights = compute_sample_weights(hdf[train_mask]["retirement_year"])

        for c in X_train.columns:
            if c not in X_test.columns:
                X_test[c] = 0
        X_test = X_test[X_train.columns]

        # Train p50 model
        params = {
            "objective": "quantile", "alpha": 0.50,
            "metric": "quantile", "verbosity": -1,
            "num_leaves": 31, "learning_rate": 0.05,
            "min_child_samples": 20, "feature_fraction": 0.8,
            "n_estimators": 500, "max_depth": 5,
        }
        train_data = lgb.Dataset(X_train, label=y_train, weight=weights)
        model = lgb.train(params, train_data)
        preds = model.predict(X_test)

        test_df = hdf[test_mask].copy()
        test_df["pred_log"] = preds
        test_df["actual_appreciation_%"] = [(math.exp(t) - 1) * 100 for t in y_test]
        test_df["pred_appreciation_%"] = [(math.exp(p) - 1) * 100 for p in preds]

        actual_top_n = min(top_n, n_test // 3)
        if actual_top_n < 3:
            continue

        # ── Strategy: Model Top-N ──
        model_top = test_df.nlargest(actual_top_n, "pred_appreciation_%")
        model_returns = model_top["actual_appreciation_%"]

        # ── Strategy: Heuristic 1 — Licensed under £100 ──
        h1_mask = pd.Series(True, index=test_df.index)
        if has_licensed:
            h1_mask &= test_df["is_licensed"].fillna(0).astype(bool)
        if has_rrp:
            h1_mask &= pd.to_numeric(test_df["rrp_gbp"], errors="coerce").fillna(999) <= 100

        h1_pool = test_df[h1_mask]
        h1_returns = h1_pool["actual_appreciation_%"] if len(h1_pool) > 0 else pd.Series(dtype=float)

        # ── Strategy: Heuristic 2 — Licensed + £100 + short run ──
        h2_mask = h1_mask.copy()
        if has_production_run:
            h2_mask &= pd.to_numeric(test_df["production_run_months"], errors="coerce").fillna(999) <= 24

        h2_pool = test_df[h2_mask]
        h2_returns = h2_pool["actual_appreciation_%"] if len(h2_pool) > 0 else pd.Series(dtype=float)

        # ── Strategy: Heuristic 3 — LEGO exclusive + licensed ──
        h3_mask = pd.Series(True, index=test_df.index)
        if has_licensed:
            h3_mask &= test_df["is_licensed"].fillna(0).astype(bool)
        if has_exclusivity:
            h3_mask &= test_df["exclusivity_tier"].isin([3, 4, 5, "lego_exclusive", "park_exclusive", "promotional"])

        h3_pool = test_df[h3_mask]
        h3_returns = h3_pool["actual_appreciation_%"] if len(h3_pool) > 0 else pd.Series(dtype=float)

        # ── Strategy: Random (all test sets) ──
        all_returns = test_df["actual_appreciation_%"]

        def summarise(returns: pd.Series, name: str) -> dict:
            if returns.empty:
                return {"strategy": name, "n": 0, "mean_%": None, "median_%": None, "win_rate_%": None}
            return {
                "strategy": name,
                "n": len(returns),
                "mean_%": round(returns.mean(), 2),
                "median_%": round(returns.median(), 2),
                "std_%": round(returns.std(), 2) if len(returns) > 1 else 0,
                "win_rate_%": round((returns > 0).mean() * 100, 1),
                "best_%": round(returns.max(), 1),
                "worst_%": round(returns.min(), 1),
            }

        fold_result = {
            "fold": f"test={test_year}",
            "test_size": int(n_test),
            "strategies": {
                "model_top_n": summarise(model_returns, f"Model Top-{actual_top_n}"),
                "heuristic_1_licensed_under_100": summarise(h1_returns, "Licensed ≤£100"),
                "heuristic_2_licensed_short_run": summarise(h2_returns, "Licensed ≤£100 + ≤24mo run"),
                "heuristic_3_exclusive_licensed": summarise(h3_returns, "LEGO Exclusive + Licensed"),
                "random_all_sets": summarise(all_returns, "All Sets (Random)"),
            },
        }

        # Model alpha = model mean - random mean
        if model_returns.mean() is not None and not all_returns.empty:
            fold_result["model_alpha_pp"] = round(
                model_returns.mean() - all_returns.mean(), 2
            )

        results.append(fold_result)

        for name, strat in fold_result["strategies"].items():
            if strat["n"] > 0:
                log.info(f"    {strat['strategy']}: n={strat['n']}, mean={strat['mean_%']}%, "
                         f"median={strat['median_%']}%, win={strat['win_rate_%']}%")

    # Aggregate across folds
    if results:
        strategies = list(results[0]["strategies"].keys())
        agg = {}
        for strat_key in strategies:
            means = [r["strategies"][strat_key]["mean_%"]
                     for r in results if r["strategies"][strat_key]["mean_%"] is not None]
            medians = [r["strategies"][strat_key]["median_%"]
                       for r in results if r["strategies"][strat_key]["median_%"] is not None]
            wins = [r["strategies"][strat_key]["win_rate_%"]
                    for r in results if r["strategies"][strat_key]["win_rate_%"] is not None]
            agg[strat_key] = {
                "avg_mean_%": round(np.mean(means), 2) if means else None,
                "avg_median_%": round(np.mean(medians), 2) if medians else None,
                "avg_win_rate_%": round(np.mean(wins), 1) if wins else None,
                "folds_with_data": len(means),
            }

        alphas = [r.get("model_alpha_pp", 0) for r in results if "model_alpha_pp" in r]
        summary = {
            "aggregate_by_strategy": agg,
            "avg_model_alpha_pp": round(np.mean(alphas), 2) if alphas else None,
            "folds_evaluated": len(results),
        }
    else:
        summary = {"folds_evaluated": 0, "error": "No valid folds"}

    output = {"summary": summary, "folds": results}

    out_path = RESULTS_DIR / "baseline_comparison_results.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    log.info(f"\nBaseline comparison saved to {out_path}")

    return output


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="LEGO Investment Model v2.1 Validation Suite")
    parser.add_argument(
        "--test",
        choices=["backtest", "calibration", "baseline", "all"],
        default="all",
        help="Which validation to run",
    )
    parser.add_argument("--top-n", type=int, default=20, help="Top/bottom N for backtest")
    args = parser.parse_args()

    df = load_full_training_data()
    if df.empty:
        log.error("No training data — run the pipeline first")
        sys.exit(1)

    all_results = {}

    if args.test in ("backtest", "all"):
        all_results["backtest"] = run_portfolio_backtest(df, top_n=args.top_n)

    if args.test in ("calibration", "all"):
        all_results["calibration"] = run_quantile_calibration(df)

    if args.test in ("baseline", "all"):
        all_results["baseline"] = run_baseline_comparison(df, top_n=args.top_n)

    # Write combined summary
    summary_path = RESULTS_DIR / "validation_summary.json"
    with open(summary_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    log.info(f"\nAll results saved to {RESULTS_DIR}/")

    return all_results


if __name__ == "__main__":
    main()
