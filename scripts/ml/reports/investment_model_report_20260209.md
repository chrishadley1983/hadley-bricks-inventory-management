# LEGO Investment Model v2.1 — Comprehensive Validation Report

*Generated: 2026-02-09 22:10*

*Model Version: v2.1*


---

## Table of Contents

1. [Executive Summary](#1-executive-summary)

2. [Model Architecture & Methodology](#2-model-architecture--methodology)

3. [Training Data & Feature Engineering](#3-training-data--feature-engineering)

4. [Training Process](#4-training-process)

5. [Scoring Methodology](#5-scoring-methodology)

6. [Validation 1: Portfolio Backtest](#6-validation-1-portfolio-backtest)

7. [Validation 2: Quantile Calibration](#7-validation-2-quantile-calibration)

8. [Validation 3: Baseline Heuristic Comparison](#8-validation-3-baseline-heuristic-comparison)

9. [Top 25 Investment Opportunities (2026 Retirees)](#9-top-25-investment-opportunities-2026-retirees)

10. [Known Limitations & Biases](#10-known-limitations--biases)

11. [Appendix: Raw Validation Data](#11-appendix-raw-validation-data)


---

## 1. Executive Summary


This report presents a comprehensive validation of the LEGO Investment Prediction Model v2.1, a LightGBM-based quantile regression system designed to predict post-retirement price appreciation of LEGO sets. The model scores currently-available sets on a 1-10 investment scale using predicted 1-year appreciation, model confidence, expected absolute profit, and risk-adjusted returns.


**Key Findings:**


- **Out-of-sample R²**: 0.4405 (averaged across 5 temporal CV folds)

- **Out-of-sample MAE**: 0.2117 (log-return scale)

- **Top vs Bottom separation**: 124.48 percentage points (model's top-ranked sets outperform bottom-ranked by this margin)

- **Top-N win rate**: 99.0% of top-ranked sets appreciated post-retirement

- **Model alpha vs random**: 84.9 pp above random selection baseline


---

## 2. Model Architecture & Methodology


### 2.1 Overview

The system uses a **dual quantile regression** approach: for each prediction horizon, three separate LightGBM models predict the 25th, 50th, and 75th percentiles of the log-return distribution. This provides both point estimates (p50) and uncertainty quantification (IQR from p25/p75) in a single framework.


**Models trained:** 12 total (4 horizons × 3 quantiles)


| Horizon | Target | Description |

|---------|--------|-------------|

| 6m | `log(price_6m / RRP)` | 6 months post-retirement |

| 1yr | `log(price_1yr / RRP)` | 1 year post-retirement |

| 2yr | `log(price_2yr / RRP)` | 2 years post-retirement |

| 3yr | `log(price_3yr / RRP)` | 3 years post-retirement |


| Quantile | Alpha | Purpose |

|----------|-------|---------|

| p25 | 0.25 | Pessimistic estimate (lower bound of 50% CI) |

| p50 | 0.50 | Median estimate (point prediction) |

| p75 | 0.75 | Optimistic estimate (upper bound of 50% CI) |


### 2.2 Why Log-Returns

Targets are expressed as `log(post_retirement_price / RRP)` rather than raw percentage returns. Log-returns are additive across time periods, approximately normally distributed (enabling quantile regression to work well), and naturally handle the bounded-below nature of prices (a set cannot lose more than 100% but can gain 1000%+). Conversion to percentage appreciation is: `appreciation_% = (exp(log_return) - 1) × 100`.


### 2.3 Why LightGBM

Gradient-boosted trees were chosen over neural networks or linear models for several reasons:

- **Native handling of missing values**: LightGBM routes NaN features to the optimal child node during tree splits, which is critical given ~20% of sets lack price trajectory features

- **Feature importance**: Gain-based importance provides interpretability

- **Small-data performance**: Tree ensembles outperform deep learning on tabular datasets below ~10,000 samples (our training set is ~1,200)

- **Quantile regression support**: Native `objective='quantile'` with alpha parameter

- **Regularization**: Built-in L1/L2, feature subsampling, and early stopping to combat overfitting on small datasets


---

## 3. Training Data & Feature Engineering


### 3.1 Training Data

- **Total training rows**: 2675 retired sets

  - Good quality (all 4 horizons): 180

  - Partial quality (1-3 horizons): 820

- **Date range**: 2012-03-10 to 2025-07-31

- **RRP range**: £6 - £285 (median £23)

- **Minimum RRP**: £5 (sets below this threshold excluded)

- **Minimum exit year**: 2012


### 3.2 Target Variable Construction

For each retired set, median buy-box prices are computed at four post-retirement milestones:


| Milestone | Centre (days from exit) | Window (±days) | Min snapshots |

|-----------|----------------------|----------------|---------------|

| retirement | 0 | ±15 | 3 |

| 6m | 180 | ±30 | 3 |

| 1yr | 365 | ±30 | 3 |

| 2yr | 730 | ±30 | 3 |

| 3yr | 1095 | ±30 | 3 |


Targets are winsorised at the 2th and 98th percentiles to cap extreme outliers (e.g., a set that 20x'd due to an error in pricing data).


### 3.3 Feature Groups (~30 features per set)


#### Group 1: Set-Intrinsic Features (15 features)

| Feature | Source | Description |

|---------|--------|-------------|

| `piece_count` | Brickset | Total piece count |

| `rrp_gbp` | Brickset/Keepa/LEGO.com | UK retail price at launch |

| `price_per_piece` | Derived | RRP / piece_count |

| `minifig_count` | Brickset | Number of minifigures included |

| `age_min` | Brickset | Minimum recommended age |

| `rating` | Brickset | Community rating (0-5) |

| `want_own_ratio` | Brickset | want_count / own_count (demand proxy) |

| `is_licensed` | Brickset | Boolean: licensed theme (Star Wars, Marvel, etc.) |

| `is_ucs` | Brickset | Boolean: Ultimate Collector Series |

| `is_modular` | Brickset | Boolean: Modular Buildings series |

| `exclusivity_tier` | Brickset | Ordinal 0-5: retail→unknown→limited→LEGO_exclusive→park→promotional |

| `production_run_months` | Derived | (exit_date - launch_date) / 30.44 |

| `box_volume` | Brickset | width × height × depth (cm³) |

| `retirement_year` | Derived | Year of retirement |

| `retirement_quarter` | Derived | Quarter of retirement (1-4) |


#### Group 2: Price Trajectory Features (5 features)

These capture the price dynamics around retirement. For training data, they use actual post-retirement snapshots. For scoring active sets, they use current market data as a proxy (latest price, recent momentum, etc.).


| Feature | Description |

|---------|-------------|

| `discount_at_retirement` | `(RRP - median_price_at_retirement) / RRP`. Positive = selling below RRP at retirement |

| `price_momentum_90d` | Linear slope of prices over first 90 days post-retirement, normalised by mean price |

| `price_volatility_180d` | Std dev of prices over first 180 days post-retirement |

| `seller_count_at_retirement` | Number of Amazon sellers at retirement date |

| `buy_box_is_amazon` | 1 if Amazon holds the buy box at retirement, 0 otherwise |


**Note**: ~111 of the 548 currently-scored sets lack trajectory data (no Amazon price history). These features are NaN for those sets, handled by LightGBM's native missing-value routing. Whether this effectively creates two prediction regimes is tested in the validation below.


#### Group 3: Theme Historical Features (4 features × 4 horizons = 16 features)

For each theme, the mean, median, and standard deviation of log-returns at each horizon are computed from **only sets retired before the current set**. This is the critical temporal leakage prevention mechanism.


| Feature | Description |

|---------|-------------|

| `theme_mean_log_{h}` | Mean log-return for theme at horizon h |

| `theme_median_log_{h}` | Median log-return for theme at horizon h |

| `theme_std_log_{h}` | Std dev of log-returns for theme at horizon h |

| `theme_sample_size_{h}` | Number of prior sets in theme with data at horizon h |


A minimum of 3 prior sets in the same theme is required; below that, theme features are NaN. This can be sparse for new or niche themes.


---

## 4. Training Process


### 4.1 Temporal Walk-Forward Cross-Validation

To prevent data leakage, the model uses temporal walk-forward CV with 5 folds. Each fold trains on sets retired up to year T, validates on year T+1, and the final held-out test set is 2024+.


| Fold | Train (retirement year ≤) | Validation (year =) | Test (year =) |

|------|---------------------------|---------------------|---------------|

| 2019 | ≤ 2018 | 2019 | 2020 |

| 2020 | ≤ 2019 | 2020 | 2021 |

| 2021 | ≤ 2020 | 2021 | 2022 |

| 2022 | ≤ 2021 | 2022 | 2023 |

| 2023 | ≤ 2022 | 2023 | 2024 |


The best hyperparameters from the fold with lowest validation MAE are used for the final model, which is trained on all data up to 2023 and tested on 2024+.


### 4.2 Hyperparameter Tuning

Optuna Bayesian optimization with **50 trials per fold** (total ~250 evaluations).


| Parameter | Search Space |

|-----------|-------------|

| `num_leaves` | 15-63 |

| `learning_rate` | 0.01-0.1 (log scale) |

| `min_child_samples` | 10-50 |

| `feature_fraction` | 0.6-0.9 |

| `lambda_l1` | 0.0-10.0 |

| `lambda_l2` | 0.0-10.0 |

| `max_depth` | 3-7 |

| `n_estimators` | 500 (fixed) |


Early stopping with patience=50 on the validation set prevents overfitting within each trial.


### 4.3 Sample Weighting

Sets retired ≥ 2020 receive 2.0x sample weight during training. This gives greater influence to recent market dynamics (post-COVID LEGO investment landscape) while retaining historical data for pattern learning.


### 4.4 Model Performance (Latest Training Run)


*No model run metrics available — run the training pipeline to populate.*


---

## 5. Scoring Methodology


### 5.1 Prediction Pipeline

For each active/retiring_soon set:

1. Build the same ~30 feature vector used in training

2. Run through 12 models (4 horizons × 3 quantiles)

3. Convert log predictions to percentage appreciation: `(exp(log_pred) - 1) × 100`

4. Compute predicted prices: `RRP × exp(log_pred)`

5. Compute confidence from quantile spread: `confidence = 1 / (1 + |p75_log - p25_log|)`


### 5.2 Composite Investment Score (1-10)

The final score combines four components via percentile ranking:


```

investment_score = (

    0.30 × percentile_rank(predicted_1yr_appreciation)

  + 0.25 × confidence_1yr

  + 0.25 × percentile_rank(expected_profit_1yr_gbp)

  + 0.20 × percentile_rank(appreciation × confidence)

) × 10

```


**Component correlation concern**: `expected_profit_1yr` = `RRP × appreciation_% / 100`. For sets at similar price points, this is highly correlated with `appreciation_1yr`, effectively giving appreciation ~55% weight instead of 30%. The backtest below tests whether this matters for ranking quality.


### 5.3 Risk Factors

Risk flags are **display-only** (not fed back into the composite score). They are binary indicators surfaced in the UI for human judgement:


| Flag | Trigger | Severity |

|------|---------|----------|

| `high_rrp` | RRP > £200 | Medium |

| `low_piece_count` | < 100 pieces AND RRP > £30 | Low |

| `thin_theme_data` | < 5 historical comparables in theme | Medium |

| `negative_forecast` | Predicted 1yr appreciation < 0% | High |

| `high_uncertainty` | Confidence < 0.3 | Medium |


---

## 6. Validation 1: Portfolio Backtest


### 6.1 Methodology

For each temporal CV fold, we:

1. Train the model on sets retired up to year T

2. Score all test-year sets using the trained model

3. Rank by composite investment_score

4. Take the top-N and bottom-N sets

5. Compare their **realized** 1-year post-retirement returns


This is the ultimate test: does the model's ranking translate into profitable selection?


### 6.2 Aggregate Results


| Metric | Value |

|--------|-------|

| Folds evaluated | 5 |

| Average OOS R² | 0.4405 |

| Average OOS MAE | 0.2117 |

| Avg top-N actual appreciation | 119.79% |

| Avg bottom-N actual appreciation | -4.69% |

| Avg top-bottom separation | 124.48 pp |

| Avg top-N win rate | 99.0% |

| Avg bottom-N win rate | 35.0% |


### 6.3 Fold-by-Fold R² Breakdown

| Fold | OOS R² |

|------|--------|

| train≤2018, test=2020 | 0.3037 |

| train≤2019, test=2021 | 0.3506 |

| train≤2020, test=2022 | 0.5012 |

| train≤2021, test=2023 | 0.4998 |

| train≤2022, test=2024 | 0.547 |


### 6.4 Fold Detail

#### Fold: train≤2018, test=2020

Train size: 488, Test size: 169, R²: 0.3037, MAE: 0.2195


| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |

|-------|---|-------------|---------------|----------------|----------|

| Top-20 | 20 | 115.18% | 115.53% | 151.44% | 100.0% |

| Bottom-20 | 20 | 24.67% | 8.27% | 16.11% | 70.0% |

| Middle | 129 | 84.91% | 76.93% | — | 96.1% |


**Separation: 90.51 pp**


Top-ranked sets in this fold:

| Set | Name | Theme | Actual | Predicted | Score |

|-----|------|-------|--------|-----------|-------|

| 60183-1 | Heavy Cargo Transport | City | 199.7% | 204.6% | 9.1 |

| 41256-1 | Rainbow Caterbus | Trolls World Tour | 84.1% | 141.3% | 8.9 |

| 70672-1 | Cole's Dirt Bike | Ninjago | 97.5% | 134.6% | 8.9 |

| 21047-1 | Las Vegas | Architecture | 118.3% | 145.4% | 8.7 |

| 41376-1 | Turtles Rescue Mission | Friends | 140.8% | 135.0% | 8.5 |

| 41372-1 | Stephanie's Gymnastics Show | Friends | 100.0% | 146.5% | 8.5 |

| 75264-1 | Kylo Ren's Shuttle Microfighter | Star Wars | 155.0% | 254.0% | 8.4 |

| 40350-1 | Chick | Brickheadz | 154.6% | 182.2% | 8.3 |

| 75214-1 | Anakin's Jedi Starfighter | Star Wars | 130.8% | 129.4% | 8.2 |

| 10768-1 | Buzz and Bo Peep's Playground Adven | Disney | 128.3% | 148.7% | 8.2 |


#### Fold: train≤2019, test=2021

Train size: 661, Test size: 283, R²: 0.3506, MAE: 0.2276


| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |

|-------|---|-------------|---------------|----------------|----------|

| Top-20 | 20 | 137.77% | 114.89% | 149.87% | 95.0% |

| Bottom-20 | 20 | -3.76% | -13.4% | -1.61% | 35.0% |

| Middle | 243 | 66.83% | 56.06% | — | 90.1% |


**Separation: 141.53 pp**


Top-ranked sets in this fold:

| Set | Name | Theme | Actual | Predicted | Score |

|-----|------|-------|--------|-----------|-------|

| 10894-1 | Toy Story Train | Disney | 209.3% | 195.6% | 9.4 |

| 76152-1 | Avengers Wrath of Loki | Super Heroes Marvel | 72.7% | 115.3% | 9.3 |

| 75274-1 | TIE Fighter Pilot | Star Wars | 275.4% | 201.9% | 9.2 |

| 43176-1 | Ariel's Storybook Adventures | Disney | 116.7% | 167.5% | 9.2 |

| 75249-1 | Resistance Y-Wing Starfighter | Star Wars | 76.8% | 113.3% | 9.1 |

| 60261-1 | Central Airport | City | 265.6% | 147.7% | 9.1 |

| 10903-1 | Fire Station | Duplo | 146.0% | 140.1% | 9.1 |

| 80014-1 | Sandy's Speedboat | Monkie Kid | 64.4% | 201.7% | 9.0 |

| 71703-1 | Storm Fighter Battle | Ninjago | 145.7% | 144.0% | 9.0 |

| 10264-1 | Corner Garage | Modular Buildings | 96.9% | 102.9% | 8.9 |


#### Fold: train≤2020, test=2022

Train size: 830, Test size: 256, R²: 0.5012, MAE: 0.2067


| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |

|-------|---|-------------|---------------|----------------|----------|

| Top-20 | 20 | 118.55% | 103.7% | 123.32% | 100.0% |

| Bottom-20 | 20 | -7.26% | -8.86% | -6.13% | 30.0% |

| Middle | 216 | 61.6% | 47.89% | — | 86.6% |


**Separation: 125.81 pp**


Top-ranked sets in this fold:

| Set | Name | Theme | Actual | Predicted | Score |

|-----|------|-------|--------|-----------|-------|

| 76199-1 | Carnage | Super Heroes Marvel | 136.3% | 128.5% | 9.6 |

| 21160-1 | The Illager Raid | Minecraft | 104.1% | 120.4% | 9.6 |

| 75316-1 | Mandalorian Starfighter | Star Wars | 65.7% | 121.6% | 9.5 |

| 75311-1 | Imperial Armored Marauder | Star Wars | 136.9% | 182.1% | 9.3 |

| 41691-1 | Doggy Day Care | Friends | 38.9% | 147.5% | 9.3 |

| 75319-1 | The Armorer's Mandalorian Forge | Star Wars | 275.4% | 177.9% | 9.3 |

| 75314-1 | The Bad Batch Attack Shuttle | Star Wars | 142.2% | 121.5% | 9.2 |

| 60262-1 | Passenger Airplane | City | 91.8% | 106.7% | 9.1 |

| 80026-1 | Pigsy's Noodle Tank | Monkie Kid | 144.4% | 126.5% | 9.1 |

| 75551-1 | Brick-Built Minions and Their Lair | Minions | 91.8% | 110.6% | 9.1 |


#### Fold: train≤2021, test=2023

Train size: 1113, Test size: 241, R²: 0.4998, MAE: 0.2105


| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |

|-------|---|-------------|---------------|----------------|----------|

| Top-20 | 20 | 107.52% | 93.28% | 101.51% | 100.0% |

| Bottom-20 | 20 | -16.62% | -21.27% | -9.68% | 25.0% |

| Middle | 201 | 56.48% | 41.25% | — | 87.6% |


**Separation: 124.15 pp**


Top-ranked sets in this fold:

| Set | Name | Theme | Actual | Predicted | Score |

|-----|------|-------|--------|-----------|-------|

| 71765-1 | Ninja Ultra Combo Mech | Ninjago | 211.1% | 107.6% | 9.5 |

| 10497-1 | Galaxy Explorer | Icons | 44.2% | 92.7% | 9.3 |

| 76193-1 | The Guardians' Ship | Super Heroes Marvel | 22.4% | 79.3% | 9.2 |

| 41809-1 | Hedwig Pencil Holder | Dots | 242.6% | 151.4% | 9.0 |

| 40646-1 | Daffodils | Icons | 107.8% | 166.4% | 9.0 |

| 10289-1 | Bird of Paradise | Botanicals | 114.4% | 75.8% | 9.0 |

| 10278-1 | Police Station | Modular Buildings | 46.0% | 75.8% | 8.9 |

| 76945-1 | Atrociraptor Dinosaur: Bike Chase | Jurassic World | 105.6% | 111.2% | 8.9 |

| 75343-1 | Dark Trooper Helmet | Star Wars | 55.2% | 84.3% | 8.9 |

| 40495-1 | Harry, Hermione, Ron & Hagrid | BrickHeadz | 104.6% | 113.6% | 8.9 |


#### Fold: train≤2022, test=2024

Train size: 1369, Test size: 271, R²: 0.547, MAE: 0.1942


| Group | N | Mean Actual | Median Actual | Mean Predicted | Win Rate |

|-------|---|-------------|---------------|----------------|----------|

| Top-20 | 20 | 119.94% | 99.91% | 112.61% | 100.0% |

| Bottom-20 | 20 | -20.46% | -26.67% | -19.1% | 15.0% |

| Middle | 231 | 52.15% | 42.86% | — | 83.5% |


**Separation: 140.4 pp**


Top-ranked sets in this fold:

| Set | Name | Theme | Actual | Predicted | Score |

|-----|------|-------|--------|-----------|-------|

| 910030-1 | Snack Shack | BrickLink Designer P | 99.9% | 98.4% | 9.3 |

| 40632-1 | Aragorn and Arwen | Brickheadz | 122.3% | 152.7% | 9.2 |

| 42162-1 | Bugatti Bolide Agile Blue | Technic | 90.8% | 88.3% | 9.2 |

| 40751-1 | Legolas & Gimli | Brickheadz | 144.4% | 124.0% | 9.1 |

| 40631-1 | Gandalf the Grey and Balrog | Brickheadz | 139.0% | 125.5% | 9.0 |

| 31120-1 | Medieval Castle | Creator | 71.4% | 75.7% | 9.0 |

| 76944-1 | T. rex Dinosaur Breakout | Jurassic World | 55.6% | 90.6% | 9.0 |

| 75370-1 | Stormtrooper Mech | Star Wars | 129.9% | 137.6% | 8.9 |

| 21056-1 | Taj Mahal | Architecture | 12.4% | 70.0% | 8.8 |

| 40630-1 | Frodo & Gollum | Brickheadz | 142.3% | 124.2% | 8.8 |


---

## 7. Validation 2: Quantile Calibration


### 7.1 Methodology

For perfectly calibrated quantile predictions:

- 25% of actual outcomes should fall **below** the p25 prediction

- 50% should fall below p50

- 75% should fall below p75

- 50% should fall **within** the IQR (between p25 and p75)


Deviations indicate systematic over-confidence (intervals too narrow) or under-confidence (intervals too wide).


### 7.2 Results by Horizon


#### Horizon: 6m

Total OOS samples: 1210


| Quantile | Target Coverage | Actual Coverage | Calibration Error |

|----------|----------------|-----------------|-------------------|

| p25 | 25.0% | 37.4% | 12.4 pp |

| p50 | 50.0% | 52.0% | 2.0 pp |

| p75 | 75.0% | 67.1% | 7.9 pp |

| IQR | 50.0% | 30.2% | — |


Median IQR width: 19.9 pp | Mean IQR width: 23.9 pp

**Assessment: moderately_calibrated**


| Fold | N | Below p25 | Below p50 | Below p75 | Within IQR |

|------|---|-----------|-----------|-----------|------------|

| train≤2018, test=2020 | 172 | 26.7% | 43.6% | 58.1% | 32.0% |

| train≤2019, test=2021 | 283 | 35.3% | 52.7% | 65.7% | 30.7% |

| train≤2020, test=2022 | 245 | 41.2% | 50.2% | 69.8% | 28.6% |

| train≤2021, test=2023 | 222 | 40.5% | 56.3% | 68.0% | 28.8% |

| train≤2022, test=2024 | 288 | 40.3% | 54.5% | 70.8% | 31.2% |


#### Horizon: 1yr

Total OOS samples: 1220


| Quantile | Target Coverage | Actual Coverage | Calibration Error |

|----------|----------------|-----------------|-------------------|

| p25 | 25.0% | 37.9% | 12.9 pp |

| p50 | 50.0% | 54.3% | 4.3 pp |

| p75 | 75.0% | 73.4% | 1.6 pp |

| IQR | 50.0% | 35.7% | — |


Median IQR width: 34.7 pp | Mean IQR width: 40.8 pp

**Assessment: moderately_calibrated**


| Fold | N | Below p25 | Below p50 | Below p75 | Within IQR |

|------|---|-----------|-----------|-----------|------------|

| train≤2018, test=2020 | 169 | 24.9% | 49.7% | 76.3% | 51.5% |

| train≤2019, test=2021 | 283 | 37.5% | 57.6% | 78.8% | 41.7% |

| train≤2020, test=2022 | 256 | 46.1% | 56.6% | 73.8% | 28.1% |

| train≤2021, test=2023 | 241 | 42.3% | 55.6% | 74.3% | 32.0% |

| train≤2022, test=2024 | 271 | 34.7% | 50.6% | 64.6% | 29.9% |


#### Horizon: 2yr

Total OOS samples: 884


| Quantile | Target Coverage | Actual Coverage | Calibration Error |

|----------|----------------|-----------------|-------------------|

| p25 | 25.0% | 51.5% | 26.5 pp |

| p50 | 50.0% | 66.1% | 16.1 pp |

| p75 | 75.0% | 79.6% | 4.6 pp |

| IQR | 50.0% | 28.4% | — |


Median IQR width: 53.7 pp | Mean IQR width: 57.9 pp

**Assessment: poorly_calibrated**


| Fold | N | Below p25 | Below p50 | Below p75 | Within IQR |

|------|---|-----------|-----------|-----------|------------|

| train≤2018, test=2020 | 150 | 65.3% | 75.3% | 88.0% | 22.7% |

| train≤2019, test=2021 | 272 | 57.7% | 73.2% | 81.6% | 24.3% |

| train≤2020, test=2022 | 258 | 46.5% | 60.9% | 79.1% | 32.6% |

| train≤2021, test=2023 | 204 | 39.2% | 56.4% | 71.6% | 32.8% |


#### Horizon: 3yr

Total OOS samples: 590


| Quantile | Target Coverage | Actual Coverage | Calibration Error |

|----------|----------------|-----------------|-------------------|

| p25 | 25.0% | 54.7% | 29.7 pp |

| p50 | 50.0% | 64.7% | 14.7 pp |

| p75 | 75.0% | 74.9% | 0.1 pp |

| IQR | 50.0% | 21.2% | — |


Median IQR width: 52.5 pp | Mean IQR width: 62.2 pp

**Assessment: poorly_calibrated**


| Fold | N | Below p25 | Below p50 | Below p75 | Within IQR |

|------|---|-----------|-----------|-----------|------------|

| train≤2018, test=2020 | 119 | 63.9% | 75.6% | 82.4% | 18.5% |

| train≤2019, test=2021 | 251 | 55.8% | 64.9% | 75.3% | 19.5% |

| train≤2020, test=2022 | 220 | 48.6% | 58.6% | 70.5% | 24.5% |



---

## 8. Validation 3: Baseline Heuristic Comparison


### 8.1 Heuristics Tested

| Strategy | Rule |

|----------|------|

| **Model Top-N** | Top N sets by composite investment_score |

| **Licensed ≤£100** | All licensed sets with RRP ≤ £100 |

| **Licensed + Short Run** | Licensed, ≤£100 RRP, ≤24 month production run |

| **Exclusive + Licensed** | LEGO exclusive / promotional + licensed |

| **Random (All Sets)** | Average of all test-year sets (the baseline) |


### 8.2 Aggregate Results (Averaged Across OOS Folds)


| Strategy | Avg Mean Return | Avg Median Return | Avg Win Rate | Folds |

|----------|-----------------|-------------------|--------------|-------|

| Model Top-N | 147.96% | 133.52% | 99.0% | 5 |

| Licensed ≤£100 | 65.65% | 56.87% | 89.1% | 5 |

| Licensed + Short Run | 64.21% | 53.92% | 87.7% | 5 |

| Exclusive + Licensed | 70.95% | 68.58% | 97.5% | 5 |

| Random (All Sets) | 63.07% | 52.13% | 85.3% | 5 |


**Model alpha over random: 84.9 pp**


### 8.3 Fold-by-Fold Comparison

#### Fold: test=2020 (N=169)

| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |

|----------|---|------|--------|-----|----------|------|-------|

| Model Top-20 | 20 | 123.85% | 125.29% | 46.4% | 100.0% | 199.7% | 18.1% |

| Licensed ≤£100 | 45 | 99.0% | 97.06% | 65.99% | 95.6% | 275.4% | -39.6% |

| Licensed ≤£100 + ≤24mo run | 40 | 94.02% | 87.85% | 67.35% | 95.0% | 275.4% | -39.6% |

| LEGO Exclusive + Licensed | 2 | 121.18% | 121.18% | 73.32% | 100.0% | 173.0% | 69.3% |

| All Sets (Random) | 169 | 81.37% | 74.84% | 61.72% | 93.5% | 275.4% | -39.6% |


Model alpha: 42.49 pp


#### Fold: test=2021 (N=283)

| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |

|----------|---|------|--------|-----|----------|------|-------|

| Model Top-20 | 20 | 152.3% | 140.44% | 95.5% | 95.0% | 275.4% | -17.3% |

| Licensed ≤£100 | 79 | 77.07% | 61.21% | 70.25% | 89.9% | 275.4% | -39.6% |

| Licensed ≤£100 + ≤24mo run | 59 | 82.8% | 66.7% | 74.64% | 88.1% | 275.4% | -28.0% |

| LEGO Exclusive + Licensed | 9 | 92.9% | 77.54% | 50.07% | 100.0% | 181.5% | 48.1% |

| All Sets (Random) | 283 | 66.86% | 55.62% | 64.82% | 86.6% | 275.4% | -39.6% |


Model alpha: 85.44 pp


#### Fold: test=2022 (N=256)

| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |

|----------|---|------|--------|-----|----------|------|-------|

| Model Top-20 | 20 | 155.31% | 143.22% | 72.27% | 100.0% | 275.4% | 38.9% |

| Licensed ≤£100 | 92 | 63.77% | 52.3% | 60.32% | 92.4% | 275.4% | -26.7% |

| Licensed ≤£100 + ≤24mo run | 80 | 62.0% | 49.05% | 62.49% | 92.5% | 275.4% | -26.7% |

| LEGO Exclusive + Licensed | 8 | 61.81% | 61.89% | 51.66% | 87.5% | 144.4% | -26.7% |

| All Sets (Random) | 256 | 60.67% | 47.57% | 66.41% | 83.2% | 275.4% | -39.6% |


Model alpha: 94.64 pp


#### Fold: test=2023 (N=241)

| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |

|----------|---|------|--------|-----|----------|------|-------|

| Model Top-20 | 20 | 157.93% | 132.53% | 77.42% | 100.0% | 275.4% | 47.5% |

| Licensed ≤£100 | 71 | 46.25% | 38.57% | 47.44% | 87.3% | 275.4% | -39.6% |

| Licensed ≤£100 + ≤24mo run | 59 | 42.79% | 34.17% | 47.26% | 86.4% | 275.4% | -28.6% |

| LEGO Exclusive + Licensed | 4 | 24.86% | 25.98% | 8.72% | 100.0% | 34.2% | 13.3% |

| All Sets (Random) | 241 | 54.65% | 40.62% | 62.5% | 83.4% | 275.4% | -39.6% |


Model alpha: 103.28 pp


#### Fold: test=2024 (N=271)

| Strategy | N | Mean | Median | Std | Win Rate | Best | Worst |

|----------|---|------|--------|-----|----------|------|-------|

| Model Top-20 | 20 | 150.43% | 126.12% | 69.68% | 100.0% | 275.4% | 74.9% |

| Licensed ≤£100 | 76 | 42.16% | 35.21% | 43.95% | 80.3% | 163.8% | -39.6% |

| Licensed ≤£100 + ≤24mo run | 59 | 39.44% | 31.85% | 45.77% | 76.3% | 163.8% | -39.6% |

| LEGO Exclusive + Licensed | 5 | 54.02% | 56.31% | 35.76% | 100.0% | 100.0% | 13.0% |

| All Sets (Random) | 271 | 51.8% | 42.01% | 60.46% | 79.7% | 275.4% | -39.6% |


Model alpha: 98.63 pp


---

## 9. Top 25 Investment Opportunities (2026 Retirees)


### 9.1 Methodology

Sets expected to retire in 2026 (by `exit_date`, `expected_retirement_date`, or `retirement_status = 'retiring_soon'`) are ranked by `investment_score`. For each set, we compute:


- **Buy price**: Current Amazon buy box price, latest price snapshot, or RRP (waterfall)

- **Predicted sell price**: Model's p50 prediction for 1yr post-retirement Amazon price

- **COG%**: `(buy_price / predicted_sell_price) × 100` — lower is better

- **Amazon fees**: 15% referral fee + £3.25 FBA fulfillment (approximate for toys category)

- **Net ROI**: `(sell_price - fees - buy_price) / buy_price × 100`

- **Confidence band**: P25 (pessimistic) and P75 (optimistic) scenarios with corresponding ROI


### 9.2 Fee Assumptions

| Fee Component | Rate | Notes |

|---------------|------|-------|

| Referral fee | 15% | Standard Amazon toys category |

| FBA fulfillment | £3.25 | Average for medium-sized LEGO box |

| Closing fee | £0.00 | Not applicable to toys |

| Storage | Not included | Varies by time of year; excluded from analysis |

| VAT | Not included | Depends on seller VAT status |


### 9.3 Top 25 Sets


| # | Set | Name | Theme | RRP | Buy Now | Pred Sell (1yr) | COG% | Net ROI% | Score | Confidence |

|---|-----|------|-------|-----|---------|-----------------|------|----------|-------|------------|

| 1 | 76297-1 | Dancing Groot | Super Heroes Ma | £40 | £39.99 | £63.84 | 63% | 28% | 8.7 | 0.73 |

| 2 | 77002-1 | Cyclone vs. Metal Sonic | Sonic The Hedge | £23 | £23.00 | £38.95 | 59% | 30% | 8.6 | 0.69 |

| 3 | 75429-1 | AT-AT Driver Helmet | Star Wars | £70 | £69.99 | £105.15 | 67% | 23% | 8.3 | 0.72 |

| 4 | 31175-1 | Unicorn Castle | Creator | £35 | £34.99 | £53.92 | 65% | 22% | 8.3 | 0.70 |

| 5 | 21355-1 | The Evolution of STEM | LEGO Ideas and  | £70 | £69.99 | £105.22 | 66% | 23% | 8.3 | 0.72 |

| 6 | 71854-1 | Cole's Mission Mech & Dragon Z | Ninjago | £25 | £24.99 | £39.55 | 63% | 22% | 8.3 | 0.68 |

| 7 | 21584-1 | Nether & End Portal Journey | Minecraft | £13 | £12.99 | £22.48 | 58% | 22% | 8.2 | 0.65 |

| 8 | 42217-1 | Chevrolet Corvette Stingray Bl | Technic | £55 | £54.99 | £82.75 | 66% | 22% | 8.2 | 0.72 |

| 9 | 10461-1 | Grandpa Pig's Garden and Green | Duplo | £75 | £74.99 | £110.14 | 68% | 20% | 8.2 | 0.74 |

| 10 | 71831-1 | Ninja Spinjitzu Temple | Ninjago | £35 | £34.99 | £52.95 | 66% | 19% | 8.1 | 0.71 |

| 11 | 43278-1 | Mini Arendelle Castle & Elsa's | Disney | £45 | £44.99 | £67.30 | 67% | 20% | 8.0 | 0.70 |

| 12 | 42692-1 | Ice Cream & Balloon Stand | Friends | £9 | £8.99 | £15.06 | 60% | 6% | 7.9 | 0.65 |

| 13 | 71826-1 | Dragon Spinjitzu Battle Pack | Ninjago | £18 | £17.99 | £28.16 | 64% | 15% | 7.9 | 0.66 |

| 14 | 30714-1 | Orange Cat | Creator | £10 | £9.97 | £15.54 | 64% | -0% | 7.8 | 0.66 |

| 15 | 71494-1 | Zoey's Time Owl | Dreamzzz | £25 | £24.99 | £37.61 | 66% | 15% | 7.8 | 0.69 |

| 16 | 11043-1 | Cool Creative Box | Classic | £25 | £24.99 | £38.10 | 66% | 17% | 7.8 | 0.65 |

| 17 | 21268-1 | The Baby Pig House | Minecraft | £18 | £17.99 | £27.79 | 65% | 13% | 7.7 | 0.66 |

| 18 | 76308-1 | Spider-Man Mech vs. Anti-Venom | Super Heroes Ma | £13 | £12.99 | £20.63 | 63% | 10% | 7.7 | 0.64 |

| 19 | 21353-1 | The Botanical Garden | LEGO Ideas and  | £290 | £289.99 | £403.38 | 72% | 17% | 7.7 | 0.70 |

| 20 | 71495-1 | Mateo vs. Cyber Brain Mech | Dreamzzz | £25 | £24.99 | £37.55 | 67% | 15% | 7.7 | 0.69 |

| 21 | 43303-1 | Mini Jasmine & Rapunzel | Disney | £9 | £9.00 | £14.85 | 61% | 4% | 7.7 | 0.64 |

| 22 | 43285-1 | Ariel's Magical Mini Palace | Disney | £18 | £17.99 | £27.25 | 66% | 11% | 7.7 | 0.69 |

| 23 | 71850-1 | Lloyd vs. Earth Monster Spinne | Ninjago | £9 | £8.99 | £14.78 | 61% | 4% | 7.7 | 0.63 |

| 24 | 40814-1 | Baby Elephant in the Sky | Other | £25 | £24.99 | £37.76 | 66% | 15% | 7.7 | 0.66 |

| 25 | 42654-1 | Pony Ranch & Stable | Friends | £60 | £59.99 | £85.75 | 70% | 16% | 7.6 | 0.69 |


### 9.4 Detailed Set Analysis


#### #1: 76297-1 — Dancing Groot

**Theme**: Super Heroes Marvel | **RRP**: £39.99 | **Score**: 8.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £39.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £63.84 |

| COG% | 62.6% |

| Amazon referral fee | £9.58 |

| Amazon FBA fee | £3.25 |

| Total fees | £12.83 (20.1% of sale) |

| Net revenue | £51.01 |

| Gross profit | £11.02 |

| Gross margin | 17.3% |

| **Net ROI** | **27.6%** |

| Model confidence | 0.732 |

| 1yr appreciation (p50) | 59.64% |

| 3yr appreciation (p50) | 67.4% |

| Pessimistic ROI (p25) | -3.6% (profit £-1.42) |

| Optimistic ROI (p75) | 42.7% (profit £17.09) |


#### #2: 77002-1 — Cyclone vs. Metal Sonic

**Theme**: Sonic The Hedgehog | **RRP**: £23.00 | **Score**: 8.6 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £23.00 (Amazon Buy Box) |

| Predicted 1yr sell price | £38.95 |

| COG% | 59.1% |

| Amazon referral fee | £5.84 |

| Amazon FBA fee | £3.25 |

| Total fees | £9.09 (23.3% of sale) |

| Net revenue | £29.86 |

| Gross profit | £6.86 |

| Gross margin | 17.6% |

| **Net ROI** | **29.8%** |

| Model confidence | 0.686 |

| 1yr appreciation (p50) | 69.35% |

| 3yr appreciation (p50) | 40.38% |

| Pessimistic ROI (p25) | -18.0% (profit £-4.14) |

| Optimistic ROI (p75) | 37.8% (profit £8.69) |


#### #3: 75429-1 — AT-AT Driver Helmet

**Theme**: Star Wars | **RRP**: £69.99 | **Score**: 8.3 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £69.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £105.15 |

| COG% | 66.6% |

| Amazon referral fee | £15.77 |

| Amazon FBA fee | £3.25 |

| Total fees | £19.02 (18.1% of sale) |

| Net revenue | £86.13 |

| Gross profit | £16.14 |

| Gross margin | 15.3% |

| **Net ROI** | **23.1%** |

| Model confidence | 0.716 |

| 1yr appreciation (p50) | 50.24% |

| 3yr appreciation (p50) | 42.98% |

| Pessimistic ROI (p25) | -19.6% (profit £-13.70) |

| Optimistic ROI (p75) | 21.9% (profit £15.31) |


#### #4: 31175-1 — Unicorn Castle

**Theme**: Creator | **RRP**: £34.99 | **Score**: 8.3 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £34.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £53.92 |

| COG% | 64.9% |

| Amazon referral fee | £8.09 |

| Amazon FBA fee | £3.25 |

| Total fees | £11.34 (21.0% of sale) |

| Net revenue | £42.58 |

| Gross profit | £7.59 |

| Gross margin | 14.1% |

| **Net ROI** | **21.7%** |

| Model confidence | 0.7 |

| 1yr appreciation (p50) | 54.09% |

| 3yr appreciation (p50) | 41.5% |

| Pessimistic ROI (p25) | -17.8% (profit £-6.21) |

| Optimistic ROI (p75) | 31.4% (profit £10.98) |


#### #5: 21355-1 — The Evolution of STEM

**Theme**: LEGO Ideas and CUUSOO | **RRP**: £69.99 | **Score**: 8.3 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £69.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £105.22 |

| COG% | 66.5% |

| Amazon referral fee | £15.78 |

| Amazon FBA fee | £3.25 |

| Total fees | £19.03 (18.1% of sale) |

| Net revenue | £86.19 |

| Gross profit | £16.20 |

| Gross margin | 15.4% |

| **Net ROI** | **23.1%** |

| Model confidence | 0.716 |

| 1yr appreciation (p50) | 50.34% |

| 3yr appreciation (p50) | 34.07% |

| Pessimistic ROI (p25) | -18.4% (profit £-12.89) |

| Optimistic ROI (p75) | 23.5% (profit £16.43) |


#### #6: 71854-1 — Cole's Mission Mech & Dragon Zane

**Theme**: Ninjago | **RRP**: £24.99 | **Score**: 8.3 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £24.99 (Latest Price Snapshot) |

| Predicted 1yr sell price | £39.55 |

| COG% | 63.2% |

| Amazon referral fee | £5.93 |

| Amazon FBA fee | £3.25 |

| Total fees | £9.18 (23.2% of sale) |

| Net revenue | £30.37 |

| Gross profit | £5.38 |

| Gross margin | 13.6% |

| **Net ROI** | **21.5%** |

| Model confidence | 0.677 |

| 1yr appreciation (p50) | 58.25% |

| 3yr appreciation (p50) | 30.81% |

| Pessimistic ROI (p25) | -20.7% (profit £-5.18) |

| Optimistic ROI (p75) | 35.8% (profit £8.94) |


#### #7: 21584-1 — Nether & End Portal Journey

**Theme**: Minecraft | **RRP**: £12.99 | **Score**: 8.2 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £12.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £22.48 |

| COG% | 57.8% |

| Amazon referral fee | £3.37 |

| Amazon FBA fee | £3.25 |

| Total fees | £6.62 (29.5% of sale) |

| Net revenue | £15.86 |

| Gross profit | £2.87 |

| Gross margin | 12.8% |

| **Net ROI** | **22.1%** |

| Model confidence | 0.648 |

| 1yr appreciation (p50) | 73.09% |

| 3yr appreciation (p50) | 54.03% |

| Pessimistic ROI (p25) | -27.5% (profit £-3.58) |

| Optimistic ROI (p75) | 42.9% (profit £5.57) |


#### #8: 42217-1 — Chevrolet Corvette Stingray Blue

**Theme**: Technic | **RRP**: £54.99 | **Score**: 8.2 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £54.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £82.75 |

| COG% | 66.5% |

| Amazon referral fee | £12.41 |

| Amazon FBA fee | £3.25 |

| Total fees | £15.66 (18.9% of sale) |

| Net revenue | £67.09 |

| Gross profit | £12.10 |

| Gross margin | 14.6% |

| **Net ROI** | **22.0%** |

| Model confidence | 0.717 |

| 1yr appreciation (p50) | 50.48% |

| 3yr appreciation (p50) | 38.08% |

| Pessimistic ROI (p25) | -17.1% (profit £-9.42) |

| Optimistic ROI (p75) | 25.7% (profit £14.16) |


#### #9: 10461-1 — Grandpa Pig's Garden and Greenhouse

**Theme**: Duplo | **RRP**: £74.99 | **Score**: 8.2 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £74.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £110.14 |

| COG% | 68.1% |

| Amazon referral fee | £16.52 |

| Amazon FBA fee | £3.25 |

| Total fees | £19.77 (18.0% of sale) |

| Net revenue | £90.37 |

| Gross profit | £15.38 |

| Gross margin | 14.0% |

| **Net ROI** | **20.5%** |

| Model confidence | 0.743 |

| 1yr appreciation (p50) | 46.87% |

| 3yr appreciation (p50) | 18.55% |

| Pessimistic ROI (p25) | -10.0% (profit £-7.51) |

| Optimistic ROI (p75) | 28.9% (profit £21.70) |


#### #10: 71831-1 — Ninja Spinjitzu Temple

**Theme**: Ninjago | **RRP**: £34.99 | **Score**: 8.1 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £34.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £52.95 |

| COG% | 66.1% |

| Amazon referral fee | £7.94 |

| Amazon FBA fee | £3.25 |

| Total fees | £11.19 (21.1% of sale) |

| Net revenue | £41.76 |

| Gross profit | £6.77 |

| Gross margin | 12.8% |

| **Net ROI** | **19.3%** |

| Model confidence | 0.708 |

| 1yr appreciation (p50) | 51.34% |

| 3yr appreciation (p50) | 32.15% |

| Pessimistic ROI (p25) | -16.0% (profit £-5.58) |

| Optimistic ROI (p75) | 31.7% (profit £11.10) |


#### #11: 43278-1 — Mini Arendelle Castle & Elsa's Ice Palace

**Theme**: Disney | **RRP**: £44.99 | **Score**: 8.0 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £44.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £67.30 |

| COG% | 66.8% |

| Amazon referral fee | £10.09 |

| Amazon FBA fee | £3.25 |

| Total fees | £13.34 (19.8% of sale) |

| Net revenue | £53.95 |

| Gross profit | £8.96 |

| Gross margin | 13.3% |

| **Net ROI** | **19.9%** |

| Model confidence | 0.696 |

| 1yr appreciation (p50) | 49.59% |

| 3yr appreciation (p50) | 28.39% |

| Pessimistic ROI (p25) | -19.8% (profit £-8.92) |

| Optimistic ROI (p75) | 28.1% (profit £12.62) |


#### #12: 42692-1 — Ice Cream & Balloon Stand

**Theme**: Friends | **RRP**: £9.00 | **Score**: 7.9 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £8.99 (Latest Price Snapshot) |

| Predicted 1yr sell price | £15.06 |

| COG% | 59.7% |

| Amazon referral fee | £2.26 |

| Amazon FBA fee | £3.25 |

| Total fees | £5.51 (36.6% of sale) |

| Net revenue | £9.55 |

| Gross profit | £0.56 |

| Gross margin | 3.7% |

| **Net ROI** | **6.2%** |

| Model confidence | 0.652 |

| 1yr appreciation (p50) | 67.36% |

| 3yr appreciation (p50) | 60.49% |

| Pessimistic ROI (p25) | -46.4% (profit £-4.17) |

| Optimistic ROI (p75) | 16.8% (profit £1.51) |


#### #13: 71826-1 — Dragon Spinjitzu Battle Pack

**Theme**: Ninjago | **RRP**: £17.99 | **Score**: 7.9 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £17.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £28.16 |

| COG% | 63.9% |

| Amazon referral fee | £4.22 |

| Amazon FBA fee | £3.25 |

| Total fees | £7.47 (26.5% of sale) |

| Net revenue | £20.69 |

| Gross profit | £2.70 |

| Gross margin | 9.6% |

| **Net ROI** | **15.0%** |

| Model confidence | 0.664 |

| 1yr appreciation (p50) | 56.55% |

| 3yr appreciation (p50) | 40.02% |

| Pessimistic ROI (p25) | -23.6% (profit £-4.24) |

| Optimistic ROI (p75) | 38.8% (profit £6.98) |


#### #14: 30714-1 — Orange Cat

**Theme**: Creator | **RRP**: £9.57 | **Score**: 7.8 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £9.97 (Latest Price Snapshot) |

| Predicted 1yr sell price | £15.54 |

| COG% | 64.2% |

| Amazon referral fee | £2.33 |

| Amazon FBA fee | £3.25 |

| Total fees | £5.58 (35.9% of sale) |

| Net revenue | £9.96 |

| Gross profit | £-0.01 |

| Gross margin | -0.1% |

| **Net ROI** | **-0.1%** |

| Model confidence | 0.661 |

| 1yr appreciation (p50) | 62.39% |

| 3yr appreciation (p50) | 87.93% |

| Pessimistic ROI (p25) | -34.0% (profit £-3.39) |

| Optimistic ROI (p75) | 31.9% (profit £3.18) |


#### #15: 71494-1 — Zoey's Time Owl

**Theme**: Dreamzzz | **RRP**: £24.99 | **Score**: 7.8 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £24.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £37.61 |

| COG% | 66.4% |

| Amazon referral fee | £5.64 |

| Amazon FBA fee | £3.25 |

| Total fees | £8.89 (23.6% of sale) |

| Net revenue | £28.72 |

| Gross profit | £3.73 |

| Gross margin | 9.9% |

| **Net ROI** | **14.9%** |

| Model confidence | 0.688 |

| 1yr appreciation (p50) | 50.51% |

| 3yr appreciation (p50) | 37.73% |

| Pessimistic ROI (p25) | -27.4% (profit £-6.84) |

| Optimistic ROI (p75) | 21.8% (profit £5.45) |


#### #16: 11043-1 — Cool Creative Box

**Theme**: Classic | **RRP**: £24.99 | **Score**: 7.8 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £24.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £38.10 |

| COG% | 65.6% |

| Amazon referral fee | £5.71 |

| Amazon FBA fee | £3.25 |

| Total fees | £8.96 (23.5% of sale) |

| Net revenue | £29.14 |

| Gross profit | £4.15 |

| Gross margin | 10.9% |

| **Net ROI** | **16.6%** |

| Model confidence | 0.649 |

| 1yr appreciation (p50) | 52.47% |

| 3yr appreciation (p50) | 42.82% |

| Pessimistic ROI (p25) | -31.0% (profit £-7.74) |

| Optimistic ROI (p75) | 28.0% (profit £7.00) |


#### #17: 21268-1 — The Baby Pig House

**Theme**: Minecraft | **RRP**: £17.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £17.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £27.79 |

| COG% | 64.7% |

| Amazon referral fee | £4.17 |

| Amazon FBA fee | £3.25 |

| Total fees | £7.42 (26.7% of sale) |

| Net revenue | £20.37 |

| Gross profit | £2.38 |

| Gross margin | 8.6% |

| **Net ROI** | **13.2%** |

| Model confidence | 0.66 |

| 1yr appreciation (p50) | 54.47% |

| 3yr appreciation (p50) | 61.76% |

| Pessimistic ROI (p25) | -27.4% (profit £-4.92) |

| Optimistic ROI (p75) | 33.7% (profit £6.07) |


#### #18: 76308-1 — Spider-Man Mech vs. Anti-Venom

**Theme**: Super Heroes Marvel | **RRP**: £12.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £12.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £20.63 |

| COG% | 63.0% |

| Amazon referral fee | £3.09 |

| Amazon FBA fee | £3.25 |

| Total fees | £6.34 (30.8% of sale) |

| Net revenue | £14.29 |

| Gross profit | £1.30 |

| Gross margin | 6.3% |

| **Net ROI** | **10.0%** |

| Model confidence | 0.636 |

| 1yr appreciation (p50) | 58.83% |

| 3yr appreciation (p50) | 45.22% |

| Pessimistic ROI (p25) | -30.8% (profit £-4.01) |

| Optimistic ROI (p75) | 41.9% (profit £5.44) |


#### #19: 21353-1 — The Botanical Garden

**Theme**: LEGO Ideas and CUUSOO | **RRP**: £289.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £289.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £403.38 |

| COG% | 71.9% |

| Amazon referral fee | £60.51 |

| Amazon FBA fee | £3.25 |

| Total fees | £63.76 (15.8% of sale) |

| Net revenue | £339.62 |

| Gross profit | £49.63 |

| Gross margin | 12.3% |

| **Net ROI** | **17.1%** |

| Model confidence | 0.697 |

| 1yr appreciation (p50) | 39.1% |

| 3yr appreciation (p50) | 32.01% |

| Pessimistic ROI (p25) | -18.9% (profit £-54.86) |

| Optimistic ROI (p75) | 25.9% (profit £75.07) |

| Risk flags | `high_rrp` (medium) |


#### #20: 71495-1 — Mateo vs. Cyber Brain Mech

**Theme**: Dreamzzz | **RRP**: £24.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £24.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £37.55 |

| COG% | 66.6% |

| Amazon referral fee | £5.63 |

| Amazon FBA fee | £3.25 |

| Total fees | £8.88 (23.7% of sale) |

| Net revenue | £28.67 |

| Gross profit | £3.68 |

| Gross margin | 9.8% |

| **Net ROI** | **14.7%** |

| Model confidence | 0.687 |

| 1yr appreciation (p50) | 50.25% |

| 3yr appreciation (p50) | 38.24% |

| Pessimistic ROI (p25) | -27.5% (profit £-6.88) |

| Optimistic ROI (p75) | 21.8% (profit £5.44) |


#### #21: 43303-1 — Mini Jasmine & Rapunzel

**Theme**: Disney | **RRP**: £9.00 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £9.00 (RRP (no current price data)) |

| Predicted 1yr sell price | £14.85 |

| COG% | 60.6% |

| Amazon referral fee | £2.23 |

| Amazon FBA fee | £3.25 |

| Total fees | £5.48 (36.9% of sale) |

| Net revenue | £9.37 |

| Gross profit | £0.37 |

| Gross margin | 2.5% |

| **Net ROI** | **4.1%** |

| Model confidence | 0.635 |

| 1yr appreciation (p50) | 65.04% |

| 3yr appreciation (p50) | 45.13% |

| Pessimistic ROI (p25) | -48.7% (profit £-4.39) |

| Optimistic ROI (p75) | 19.1% (profit £1.72) |


#### #22: 43285-1 — Ariel's Magical Mini Palace

**Theme**: Disney | **RRP**: £17.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £17.99 (Latest Price Snapshot) |

| Predicted 1yr sell price | £27.25 |

| COG% | 66.0% |

| Amazon referral fee | £4.09 |

| Amazon FBA fee | £3.25 |

| Total fees | £7.34 (26.9% of sale) |

| Net revenue | £19.91 |

| Gross profit | £1.92 |

| Gross margin | 7.1% |

| **Net ROI** | **10.7%** |

| Model confidence | 0.694 |

| 1yr appreciation (p50) | 51.49% |

| 3yr appreciation (p50) | 32.19% |

| Pessimistic ROI (p25) | -25.6% (profit £-4.60) |

| Optimistic ROI (p75) | 25.8% (profit £4.65) |


#### #23: 71850-1 — Lloyd vs. Earth Monster Spinner

**Theme**: Ninjago | **RRP**: £8.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £8.99 (Latest Price Snapshot) |

| Predicted 1yr sell price | £14.78 |

| COG% | 60.8% |

| Amazon referral fee | £2.22 |

| Amazon FBA fee | £3.25 |

| Total fees | £5.47 (37.0% of sale) |

| Net revenue | £9.31 |

| Gross profit | £0.32 |

| Gross margin | 2.2% |

| **Net ROI** | **3.6%** |

| Model confidence | 0.632 |

| 1yr appreciation (p50) | 64.45% |

| 3yr appreciation (p50) | 57.47% |

| Pessimistic ROI (p25) | -39.6% (profit £-3.56) |

| Optimistic ROI (p75) | 36.6% (profit £3.29) |


#### #24: 40814-1 — Baby Elephant in the Sky

**Theme**: Other | **RRP**: £24.99 | **Score**: 7.7 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £24.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £37.76 |

| COG% | 66.2% |

| Amazon referral fee | £5.66 |

| Amazon FBA fee | £3.25 |

| Total fees | £8.91 (23.6% of sale) |

| Net revenue | £28.85 |

| Gross profit | £3.86 |

| Gross margin | 10.2% |

| **Net ROI** | **15.4%** |

| Model confidence | 0.664 |

| 1yr appreciation (p50) | 51.1% |

| 3yr appreciation (p50) | 45.89% |

| Pessimistic ROI (p25) | -27.8% (profit £-6.94) |

| Optimistic ROI (p75) | 28.4% (profit £7.10) |


#### #25: 42654-1 — Pony Ranch & Stable

**Theme**: Friends | **RRP**: £59.99 | **Score**: 7.6 / 10


| Metric | Value |

|--------|-------|

| Buy price (current) | £59.99 (RRP (no current price data)) |

| Predicted 1yr sell price | £85.75 |

| COG% | 70.0% |

| Amazon referral fee | £12.86 |

| Amazon FBA fee | £3.25 |

| Total fees | £16.11 (18.8% of sale) |

| Net revenue | £69.64 |

| Gross profit | £9.65 |

| Gross margin | 11.3% |

| **Net ROI** | **16.1%** |

| Model confidence | 0.692 |

| 1yr appreciation (p50) | 42.94% |

| 3yr appreciation (p50) | 35.89% |

| Pessimistic ROI (p25) | -23.4% (profit £-14.05) |

| Optimistic ROI (p75) | 22.5% (profit £13.48) |


### 9.5 Theme Distribution of Top 25


| Theme | Sets in Top 25 | Avg ROI% |

|-------|----------------|----------|

| Ninjago | 4 | 14.8% |

| Disney | 3 | 11.6% |

| Super Heroes Marvel | 2 | 18.8% |

| Creator | 2 | 10.8% |

| LEGO Ideas and CUUSOO | 2 | 20.1% |

| Minecraft | 2 | 17.6% |

| Friends | 2 | 11.2% |

| Dreamzzz | 2 | 14.8% |

| Sonic The Hedgehog | 1 | 29.8% |

| Star Wars | 1 | 23.1% |

| Technic | 1 | 22.0% |

| Duplo | 1 | 20.5% |

| Classic | 1 | 16.6% |

| Other | 1 | 15.4% |


### 9.6 Portfolio Summary (if buying all 25)


| Metric | Value |

|--------|-------|

| Total capital required | £1039.75 |

| Total predicted gross profit (1yr) | £193.51 |

| Average COG% | 64.7% |

| Average ROI% | 16.3% |

| Median ROI% | 16.6% |

| Number of sets | 25 |



---

## 10. Known Limitations & Biases


**1. Survivorship Bias**

Training data only includes sets with observable secondary market prices. Sets that nobody wanted to resell (or that traded so rarely no price data exists) are systematically excluded, inflating apparent model performance. The training set is biased toward sets that are liquid enough to generate price snapshots.


**2. Small Sample Size**

~2675 training samples across 5 CV folds with ~30 features puts the model in a regime where overfitting is a real risk. LightGBM's regularisation mitigates this but does not eliminate it. Theme-level features compound this issue — niche themes may have <5 historical comparables.


**3. Dual Prediction Regime**

~20% of scored sets lack price trajectory features (no Amazon listing / price history). LightGBM routes these via its native NaN handling, but whether this creates two effectively different prediction models with different accuracy characteristics is not fully characterised.


**4. Scoring Formula Correlation**

`expected_profit_1yr` is a linear function of `appreciation_1yr × RRP`. For sets at similar price points, these components are nearly identical, giving appreciation ~55% effective weight instead of the intended 30%. This is partly by design (appreciation matters most) but may under-weight confidence and risk adjustment.


**5. Recency Weighting**

The binary 2.0x weight for sets ≥2020 is a blunt instrument. The post-COVID LEGO market shifted substantially; a continuous decay or structural break indicator might better capture this regime change.


**6. Binary Risk Flags**

Risk flags are binary thresholds (e.g., RRP > £200) applied to a continuous risk spectrum. A set at £201 is flagged identically to one at £800. These are display-only and don't affect the composite score, but consumers of the report should note they compress risk information.


**7. Amazon-Centric Pricing**

All price data comes from Amazon (via Keepa). BrickLink secondary market prices, which may better reflect collector demand especially for exclusive/promotional sets, are not incorporated. This may underestimate appreciation for sets that trade primarily on BrickLink.


**8. No VAT or Storage Costs**

The COG% analysis in Section 9 excludes VAT (depends on seller status), Amazon storage fees (seasonal and time-sensitive), and the opportunity cost of capital. Actual returns will be lower.


---

## 11. Appendix: Raw Validation Data


Full JSON validation results are saved alongside this report in:

- `validation_results/backtest_results.json`

- `validation_results/calibration_results.json`

- `validation_results/baseline_comparison_results.json`

- `validation_results/validation_summary.json`


These contain per-set breakdowns for each fold, enabling further analysis such as:

- Per-theme model performance

- Score decile analysis

- Predicted vs actual scatter plots

- Residual analysis by feature value


---

*Report generated by `generate_report.py` at 2026-02-09T22:10:58.710304*

*Model version: v2.1*
