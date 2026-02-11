"""
Generate the full retirement predictions list as a markdown table.

Queries all investment_predictions, joins with brickset_sets metadata,
and outputs a ranked markdown table.

Usage:
    python generate_full_list.py                          # all predictions
    python generate_full_list.py --filter-csv path.csv    # only sets in CSV
"""

import argparse
import csv
import logging
import math
from datetime import datetime
from pathlib import Path

import pandas as pd
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY, MODEL_VERSION

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

REPORT_DIR = Path(__file__).resolve().parent / "reports"
REPORT_DIR.mkdir(exist_ok=True)
OUTPUT_PATH = REPORT_DIR / "retirement_predictions_full_list.md"


def load_filter_csv(csv_path: str) -> set[str]:
    """Load BrickTap CSV and return set of brickset-format set numbers (e.g. '71051-1')."""
    nums = set()
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = row.get("Set #", "").strip()
            if raw:
                nums.add(f"{raw}-1")
    return nums


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--filter-csv", help="BrickTap CSV to filter sets by")
    args = parser.parse_args()

    filter_set_nums = None
    filter_label = None
    if args.filter_csv:
        filter_set_nums = load_filter_csv(args.filter_csv)
        filter_label = Path(args.filter_csv).stem
        log.info(f"Filter CSV loaded: {len(filter_set_nums)} sets from {filter_label}")

    # Fetch all predictions
    all_preds = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("investment_predictions")
            .select("set_num, investment_score, predicted_1yr_appreciation, "
                     "predicted_1yr_price_gbp, confidence_1yr, model_version")
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

    log.info(f"Loaded {len(all_preds)} predictions")

    if not all_preds:
        log.warning("No predictions found")
        return

    pred_df = pd.DataFrame(all_preds)

    # Apply filter if provided
    if filter_set_nums is not None:
        before = len(pred_df)
        pred_df = pred_df[pred_df["set_num"].isin(filter_set_nums)]
        log.info(f"Filtered to {len(pred_df)} predictions (from {before}) matching CSV")

    # Fetch set metadata
    set_nums = pred_df["set_num"].tolist()
    all_meta = []
    batch_size = 100
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, set_name, theme, uk_retail_price, "
                     "retirement_status, exit_date")
            .in_("set_number", batch)
            .execute()
        )
        all_meta.extend(resp.data)

    meta_df = pd.DataFrame(all_meta)
    merged = pred_df.merge(meta_df, left_on="set_num", right_on="set_number", how="left")

    # Sort by investment_score descending
    merged["investment_score"] = pd.to_numeric(merged["investment_score"], errors="coerce")
    merged = merged.sort_values("investment_score", ascending=False).reset_index(drop=True)

    # Build markdown
    lines = []
    if filter_set_nums is not None:
        title = f"LEGO Retirement Investment Predictions — {filter_label}"
        lines.append(f"# {title}\n")
        lines.append(f"*Generated: {datetime.now().strftime('%Y-%m-%d')}*")
        lines.append(f"*Model Version: {MODEL_VERSION}*")
        lines.append(f"*Sets in CSV: {len(filter_set_nums)} | With predictions: {len(merged)}*\n")
    else:
        title = "LEGO Retirement Investment Predictions — Full List"
        lines.append(f"# {title}\n")
        lines.append(f"*Generated: {datetime.now().strftime('%Y-%m-%d')}*")
        lines.append(f"*Model Version: {MODEL_VERSION}*")
        lines.append(f"*Total sets: {len(merged)}*\n")
    lines.append("**Max Buy (40% COG)** = 0.4 x Predicted 1yr Price (fees excluded)\n")
    lines.append("| # | Set | Name | Theme | RRP | Pred 1yr Price | Max Buy (40% COG) | Pred 1yr % | Score | Retirement Date | Status |")
    lines.append("|---|-----|------|-------|-----|----------------|-------------------|------------|-------|-----------------|--------|")

    for rank, (_, row) in enumerate(merged.iterrows(), 1):
        rrp = pd.to_numeric(row.get("uk_retail_price"), errors="coerce")
        pred_price = pd.to_numeric(row.get("predicted_1yr_price_gbp"), errors="coerce")
        pred_pct = pd.to_numeric(row.get("predicted_1yr_appreciation"), errors="coerce")
        score = pd.to_numeric(row.get("investment_score"), errors="coerce")
        exit_date = row.get("exit_date", "")
        status = row.get("retirement_status", "")
        name = str(row.get("set_name", ""))[:35]
        theme = str(row.get("theme", ""))[:22]

        max_buy = ""
        if pd.notna(pred_price):
            max_buy = f"£{pred_price * 0.4:.2f}"

        rrp_str = f"£{rrp:.2f}" if pd.notna(rrp) else ""
        pred_price_str = f"£{pred_price:.2f}" if pd.notna(pred_price) else ""
        pred_pct_str = f"{pred_pct:.1f}%" if pd.notna(pred_pct) else ""
        score_str = f"{score:.1f}" if pd.notna(score) else ""
        exit_str = str(exit_date)[:10] if exit_date else ""

        lines.append(
            f"| {rank} | {row.get('set_num', '')} | {name} | {theme} | "
            f"{rrp_str} | {pred_price_str} | {max_buy} | {pred_pct_str} | "
            f"{score_str} | {exit_str} | {status} |"
        )

    if filter_set_nums is not None:
        output_path = REPORT_DIR / f"retirement_predictions_{filter_label}.md"
    else:
        output_path = OUTPUT_PATH

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    log.info(f"Report written to {output_path} ({len(merged)} sets)")


if __name__ == "__main__":
    main()
