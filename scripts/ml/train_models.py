"""
Phase 3+4: Train LightGBM models with temporal walk-forward CV and quantile regression.

Trains 12 models total (4 horizons x 3 quantiles: p25, p50, p75).
Uses Optuna for hyperparameter tuning with temporal CV folds.
Logs metrics and feature importances to investment_model_runs.
"""

import json
import logging
import pickle
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import optuna
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
    OPTUNA_TRIALS,
    RECENCY_WEIGHT_YEAR,
    RECENCY_WEIGHT_MULTIPLIER,
    MODEL_VERSION,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Suppress Optuna info logs
optuna.logging.set_verbosity(optuna.logging.WARNING)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Feature columns expected from engineer_features.py
FEATURE_COLS = [
    "piece_count", "rrp_gbp", "price_per_piece", "minifig_count",
    "age_min", "rating", "want_own_ratio",
    "is_licensed", "is_ucs", "is_modular", "exclusivity_tier",
    "production_run_months", "box_volume",
    "retirement_year", "retirement_quarter",
    "discount_at_retirement", "price_momentum_90d",
    "price_volatility_180d", "seller_count_at_retirement", "buy_box_is_amazon",
    # Theme features (per horizon — filled dynamically)
]

THEME_FEATURE_TEMPLATE = [
    "theme_mean_log_{h}", "theme_median_log_{h}",
    "theme_std_log_{h}", "theme_sample_size_{h}",
]


def get_feature_cols(horizon: str) -> list[str]:
    """Get feature column names for a specific horizon."""
    base = FEATURE_COLS.copy()
    for tmpl in THEME_FEATURE_TEMPLATE:
        base.append(tmpl.format(h=horizon))
    return base


def load_training_data() -> pd.DataFrame:
    """Load training data with features from Supabase."""
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

    # Expand features JSONB into columns
    if "features" in df.columns and not df.empty:
        features_df = pd.json_normalize(df["features"])
        features_df.index = df.index
        # Drop columns from features_df that already exist in df to avoid duplicates
        overlap = features_df.columns.intersection(df.columns)
        if len(overlap) > 0:
            features_df = features_df.drop(columns=overlap)
        df = pd.concat([df, features_df], axis=1)

    log.info(f"Loaded {len(df)} training rows spanning {df['retirement_year'].min()}-{df['retirement_year'].max()}")
    return df


def compute_sample_weights(df: pd.DataFrame) -> np.ndarray:
    """Apply recency weighting — recent sets get higher weight."""
    weights = np.ones(len(df))
    recent_mask = df["retirement_year"] >= RECENCY_WEIGHT_YEAR
    weights[recent_mask] = RECENCY_WEIGHT_MULTIPLIER
    return weights


def create_objective(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    sample_weights: np.ndarray,
):
    """Create an Optuna objective for LightGBM hyperparameter tuning."""

    def objective(trial):
        params = {
            "objective": "regression",
            "metric": "mae",
            "verbosity": -1,
            "num_leaves": trial.suggest_int("num_leaves", 15, 63),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
            "min_child_samples": trial.suggest_int("min_child_samples", 10, 50),
            "feature_fraction": trial.suggest_float("feature_fraction", 0.6, 0.9),
            "lambda_l1": trial.suggest_float("lambda_l1", 0.0, 10.0),
            "lambda_l2": trial.suggest_float("lambda_l2", 0.0, 10.0),
            "max_depth": trial.suggest_int("max_depth", 3, 7),
            "n_estimators": 500,
        }

        train_data = lgb.Dataset(X_train, label=y_train, weight=sample_weights)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        callbacks = [lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)]
        model = lgb.train(
            params,
            train_data,
            valid_sets=[val_data],
            callbacks=callbacks,
        )

        preds = model.predict(X_val)
        return mean_absolute_error(y_val, preds)

    return objective


def train_quantile_model(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    best_params: dict,
    quantile: float,
    sample_weights: np.ndarray,
) -> lgb.Booster:
    """Train a single quantile regression model."""
    params = {
        **best_params,
        "objective": "quantile",
        "alpha": quantile,
        "metric": "quantile",
        "verbosity": -1,
        "n_estimators": 500,
    }

    train_data = lgb.Dataset(X_train, label=y_train, weight=sample_weights)
    model = lgb.train(params, train_data)
    return model


def train_for_horizon(df: pd.DataFrame, horizon: str) -> dict:
    """Train p25/p50/p75 models for a single horizon using temporal CV."""
    target_col = f"target_{horizon}"
    feature_cols = get_feature_cols(horizon)

    # Filter to rows with this target
    mask = df[target_col].notna()
    hdf = df[mask].copy()

    log.info(f"\n--- Training {horizon} models ({len(hdf)} samples) ---")

    if len(hdf) < 50:
        log.warning(f"  Too few samples for {horizon} ({len(hdf)}), skipping")
        return {}

    # Available feature columns (some may be missing from JSONB)
    available_features = [c for c in feature_cols if c in hdf.columns]
    log.info(f"  Using {len(available_features)} features")

    X = hdf[available_features].copy()
    # Deduplicate columns (keep first occurrence)
    X = X.loc[:, ~X.columns.duplicated()]
    y = hdf[target_col].astype(float)

    # Fill missing features with median
    for col in X.columns:
        series = X[col]
        if series.dtype in ["object", "string"]:
            X[col] = pd.to_numeric(series, errors="coerce")
        X[col] = X[col].fillna(X[col].median())

    # Temporal CV to find best hyperparams
    log.info("  Running Optuna hyperparameter search...")
    best_val_mae = float("inf")
    best_params = None

    for fold in CV_FOLDS:
        train_mask = hdf["retirement_year"] <= fold["train_end"]
        val_mask = hdf["retirement_year"] == fold["val"]

        if train_mask.sum() < 30 or val_mask.sum() < 5:
            continue

        X_train_fold = X[train_mask]
        y_train_fold = y[train_mask]
        X_val_fold = X[val_mask]
        y_val_fold = y[val_mask]
        weights_fold = compute_sample_weights(hdf[train_mask])

        study = optuna.create_study(direction="minimize")
        study.optimize(
            create_objective(X_train_fold, y_train_fold, X_val_fold, y_val_fold, weights_fold),
            n_trials=OPTUNA_TRIALS,
            show_progress_bar=False,
        )

        if study.best_value < best_val_mae:
            best_val_mae = study.best_value
            best_params = study.best_params

    if best_params is None:
        log.warning(f"  No valid CV fold for {horizon}")
        return {}

    log.info(f"  Best CV MAE: {best_val_mae:.4f}")
    log.info(f"  Best params: {best_params}")

    # Final train/test split: train on everything up to 2023, test on 2024+
    final_train_mask = hdf["retirement_year"] <= 2023
    final_test_mask = hdf["retirement_year"] >= 2024

    X_train = X[final_train_mask]
    y_train = y[final_train_mask]
    X_test = X[final_test_mask] if final_test_mask.sum() > 0 else None
    y_test = y[final_test_mask] if final_test_mask.sum() > 0 else None
    train_weights = compute_sample_weights(hdf[final_train_mask])

    # Train 3 quantile models
    models = {}
    for q_name, q_val in QUANTILES.items():
        log.info(f"  Training {horizon}/{q_name} (alpha={q_val})...")
        model = train_quantile_model(X_train, y_train, best_params, q_val, train_weights)
        models[q_name] = model

        # Save model
        model_path = MODELS_DIR / f"{horizon}_{q_name}.pkl"
        with open(model_path, "wb") as f:
            pickle.dump(model, f)

    # Evaluate p50 model on test set
    p50_model = models["p50"]
    train_preds = p50_model.predict(X_train)
    train_r2 = r2_score(y_train, train_preds)
    train_mae = mean_absolute_error(y_train, train_preds)

    test_r2, test_mae = None, None
    if X_test is not None and len(X_test) > 0:
        test_preds = p50_model.predict(X_test)
        test_r2 = r2_score(y_test, test_preds)
        test_mae = mean_absolute_error(y_test, test_preds)

    # Feature importances
    importance = dict(
        zip(available_features, p50_model.feature_importance(importance_type="gain").tolist())
    )
    # Sort by importance descending
    importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))

    log.info(f"  Train R²: {train_r2:.4f}, Train MAE: {train_mae:.4f}")
    if test_r2 is not None:
        log.info(f"  Test R²:  {test_r2:.4f}, Test MAE:  {test_mae:.4f}")
    log.info(f"  Top 5 features: {list(importance.keys())[:5]}")

    # Save feature list for scoring
    features_path = MODELS_DIR / f"{horizon}_features.json"
    with open(features_path, "w") as f:
        json.dump(available_features, f)

    # Log to investment_model_runs
    run_record = {
        "model_version": MODEL_VERSION,
        "horizon": horizon,
        "algorithm": "lightgbm",
        "hyperparams": best_params,
        "feature_importances": importance,
        "train_r2": float(train_r2),
        "val_r2": float(best_val_mae),  # best val MAE from CV
        "test_r2": float(test_r2) if test_r2 is not None else None,
        "train_mae": float(train_mae),
        "val_mae": float(best_val_mae),
        "test_mae": float(test_mae) if test_mae is not None else None,
        "training_rows": int(final_train_mask.sum()),
        "training_date_range": f"{int(hdf['retirement_year'].min())}-{int(hdf[final_train_mask]['retirement_year'].max())}",
        "notes": f"Temporal CV with {len(CV_FOLDS)} folds, Optuna {OPTUNA_TRIALS} trials",
    }
    supabase.table("investment_model_runs").insert(run_record).execute()

    return {
        "horizon": horizon,
        "train_r2": train_r2,
        "test_r2": test_r2,
        "train_mae": train_mae,
        "test_mae": test_mae,
        "training_rows": int(final_train_mask.sum()),
        "top_features": list(importance.keys())[:5],
    }


def run() -> dict:
    """Train models for all horizons."""
    log.info("=== Train Models ===")

    df = load_training_data()
    if df.empty:
        log.warning("No training data found")
        return {"models_trained": 0}

    results = {}
    for horizon in HORIZONS:
        result = train_for_horizon(df, horizon)
        if result:
            results[horizon] = result

    log.info(f"\n=== Training Complete: {len(results)} horizons trained ===")
    for h, r in results.items():
        log.info(f"  {h}: train_r2={r['train_r2']:.4f}, test_r2={r.get('test_r2', 'N/A')}")

    return {"models_trained": len(results), "results": results}


if __name__ == "__main__":
    run()
