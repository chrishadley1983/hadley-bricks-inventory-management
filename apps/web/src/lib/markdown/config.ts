/**
 * Shared markdown_config loader — single source for both cadences
 * (30-day suggestion sweep and 90-day eBay relist) so new knobs can't drift
 * between the two cron routes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { MarkdownConfig } from './types';

export const MARKDOWN_CONFIG_COLUMNS =
  'mode, amazon_step1_days, amazon_step2_days, amazon_step3_days, amazon_step4_days, ' +
  'amazon_step2_undercut_pct, amazon_step3_undercut_pct, ' +
  'ebay_step1_days, ebay_step2_days, ebay_step3_days, ebay_step4_days, ' +
  'ebay_step1_reduction_pct, ebay_step2_reduction_pct, ' +
  'amazon_fee_rate, ebay_fee_rate, overpriced_threshold_pct, low_demand_sales_rank, ' +
  'auction_default_duration_days, auction_max_per_day, auction_enabled, ' +
  'suggest_interval_days, relist_age_days, min_change_pct, report_email, ' +
  'amazon_postage_cost, ebay_postage_cost, ' +
  'amazon_persistence_window_days, amazon_persistence_min_pct, amazon_reference_window_days, ' +
  'amazon_decay_start_days, amazon_decay_interval_days, amazon_decay_step_pct, ' +
  'amazon_decay_floor_pct, amazon_exit_days, amazon_min_drops_90d, amazon_healthy_drops_90d';

/**
 * Load the user's markdown config. `found: false` means no config row exists
 * (the sweep should skip; the relist runs on defaults).
 */
export async function loadMarkdownConfig(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ found: boolean; config: MarkdownConfig }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
  const { data } = await (supabase as any)
    .from('markdown_config')
    .select(MARKDOWN_CONFIG_COLUMNS)
    .eq('user_id', userId)
    .single();

  const config: MarkdownConfig = {
    mode: data?.mode ?? 'review',
    amazon_step1_days: data?.amazon_step1_days ?? 30,
    amazon_step2_days: data?.amazon_step2_days ?? 90,
    amazon_step3_days: data?.amazon_step3_days ?? 120,
    amazon_step4_days: data?.amazon_step4_days ?? 150,
    amazon_step2_undercut_pct: Number(data?.amazon_step2_undercut_pct ?? 5),
    amazon_step3_undercut_pct: Number(data?.amazon_step3_undercut_pct ?? 10),
    ebay_step1_days: data?.ebay_step1_days ?? 60,
    ebay_step2_days: data?.ebay_step2_days ?? 90,
    ebay_step3_days: data?.ebay_step3_days ?? 120,
    ebay_step4_days: data?.ebay_step4_days ?? 150,
    ebay_step1_reduction_pct: Number(data?.ebay_step1_reduction_pct ?? 5),
    ebay_step2_reduction_pct: Number(data?.ebay_step2_reduction_pct ?? 10),
    amazon_fee_rate: Number(data?.amazon_fee_rate ?? 0.1836),
    ebay_fee_rate: Number(data?.ebay_fee_rate ?? 0.1566),
    overpriced_threshold_pct: Number(data?.overpriced_threshold_pct ?? 10),
    low_demand_sales_rank: data?.low_demand_sales_rank ?? 100000,
    auction_default_duration_days: data?.auction_default_duration_days ?? 7,
    auction_max_per_day: data?.auction_max_per_day ?? 2,
    auction_enabled: data?.auction_enabled ?? true,
    suggest_interval_days: data?.suggest_interval_days ?? 30,
    relist_age_days: data?.relist_age_days ?? 90,
    min_change_pct: Number(data?.min_change_pct ?? 3),
    report_email: data?.report_email ?? null,
    amazon_postage_cost: Number(data?.amazon_postage_cost ?? 2.8),
    ebay_postage_cost: Number(data?.ebay_postage_cost ?? 1.55),
    amazon_persistence_window_days: data?.amazon_persistence_window_days ?? 14,
    amazon_persistence_min_pct: Number(data?.amazon_persistence_min_pct ?? 75),
    amazon_reference_window_days: data?.amazon_reference_window_days ?? 180,
    amazon_decay_start_days: data?.amazon_decay_start_days ?? 90,
    amazon_decay_interval_days: data?.amazon_decay_interval_days ?? 60,
    amazon_decay_step_pct: Number(data?.amazon_decay_step_pct ?? 5),
    amazon_decay_floor_pct: Number(data?.amazon_decay_floor_pct ?? 60),
    amazon_exit_days: data?.amazon_exit_days ?? 365,
    amazon_min_drops_90d: data?.amazon_min_drops_90d ?? 1,
    amazon_healthy_drops_90d: data?.amazon_healthy_drops_90d ?? 10,
  };

  return { found: !!data, config };
}
