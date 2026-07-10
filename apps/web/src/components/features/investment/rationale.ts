/**
 * Turns a prediction row into human-readable rationale chips: why the model
 * likes a set (positives) and what to watch (risk_factors, translated).
 */

import type { PredictionItem } from '@/lib/api/investment';

export interface RationaleChip {
  label: string;
  tone: 'positive' | 'caution';
}

const RISK_LABELS: Record<string, string> = {
  no_amazon_listing: 'No Amazon listing',
  unknown_retirement_date: 'Retirement date unknown',
  standard_retail_availability: 'Still widely retailed',
  low_demand_high_sales_rank: 'Low demand (high sales rank)',
  high_competition_many_sellers: 'Many competing sellers',
  predicted_depreciation: 'Model predicts depreciation',
  high_rrp_capital_required: 'High capital per unit',
  prediction_at_model_bound: 'Prediction clamped at model bound',
  no_ml_model_available: 'Rule-based score (no ML model)',
};

export function getRationaleChips(item: PredictionItem): RationaleChip[] {
  const chips: RationaleChip[] = [];
  const { prediction, max_buy } = item;

  if (max_buy?.tier === 'HIGH') {
    chips.push({ label: 'High-confidence pick', tone: 'positive' });
  }
  if (prediction.amazon_viable) {
    chips.push({ label: 'Amazon viable', tone: 'positive' });
  }
  if (
    prediction.predicted_1yr_appreciation != null &&
    prediction.predicted_1yr_appreciation >= 50
  ) {
    chips.push({
      label: `Strong 1yr outlook (+${prediction.predicted_1yr_appreciation.toFixed(0)}%)`,
      tone: 'positive',
    });
  }
  if (item.retirement_status === 'retiring_soon') {
    chips.push({ label: 'Retiring soon', tone: 'positive' });
  }
  if (
    item.exclusivity_tier &&
    !['standard', 'none', 'unknown'].includes(item.exclusivity_tier)
  ) {
    chips.push({ label: item.exclusivity_tier.replace(/_/g, ' '), tone: 'positive' });
  }

  for (const risk of prediction.risk_factors ?? []) {
    chips.push({ label: RISK_LABELS[risk] ?? risk.replace(/_/g, ' '), tone: 'caution' });
  }

  return chips;
}

/** "3 mo" / "11 mo" style distance between today and a date. */
export function monthsFromNow(date: string): number {
  const target = new Date(date);
  const now = new Date();
  return (
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  );
}
