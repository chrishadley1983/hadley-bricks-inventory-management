export type Diagnosis = 'OVERPRICED' | 'LOW_DEMAND' | 'HOLDING' | 'EXIT';
export type ProposedAction = 'MARKDOWN' | 'AUCTION';
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPLIED' | 'FAILED' | 'EXPIRED';
export type MarkdownMode = 'review' | 'auto';
export type Platform = 'amazon' | 'ebay';

export interface DiagnosisResult {
  diagnosis: Diagnosis;
  reason: string;
}

export interface MarkdownConfig {
  mode: MarkdownMode;
  amazon_step1_days: number;
  amazon_step2_days: number;
  amazon_step3_days: number;
  amazon_step4_days: number;
  amazon_step2_undercut_pct: number;
  amazon_step3_undercut_pct: number;
  ebay_step1_days: number;
  ebay_step2_days: number;
  ebay_step3_days: number;
  ebay_step4_days: number;
  ebay_step1_reduction_pct: number;
  ebay_step2_reduction_pct: number;
  amazon_fee_rate: number;
  ebay_fee_rate: number;
  overpriced_threshold_pct: number;
  low_demand_sales_rank: number;
  auction_default_duration_days: number;
  auction_max_per_day: number;
  auction_enabled: boolean;
  // Unified markdown cadence (see docs/features/unified-markdown/design.md)
  suggest_interval_days: number;
  relist_age_days: number;
  min_change_pct: number;
  report_email: string | null;
  // Position-first Amazon pricing (markdown v2)
  amazon_postage_cost: number;
  ebay_postage_cost: number;
  amazon_persistence_window_days: number;
  amazon_persistence_min_pct: number;
  amazon_reference_window_days: number;
  amazon_decay_start_days: number;
  amazon_decay_interval_days: number;
  amazon_decay_step_pct: number;
  amazon_decay_floor_pct: number;
  amazon_exit_days: number;
  amazon_min_drops_90d: number;
  amazon_healthy_drops_90d: number;
}

export interface InventoryItemForMarkdown {
  id: string;
  user_id: string;
  set_number: string;
  item_name: string | null;
  condition: string | null;
  status: string | null;
  cost: number | null;
  listing_value: number | null;
  listing_platform: string | null;
  listing_date: string | null;
  purchase_date: string | null;
  created_at: string;
  markdown_hold: boolean;
  amazon_asin: string | null;
  ebay_listing_id: string | null;
  sales_rank: number | null;
  next_markdown_eval_at: string | null;
}

export interface MarkdownProposal {
  user_id: string;
  inventory_item_id: string;
  platform: Platform;
  diagnosis: Diagnosis;
  diagnosis_reason: string;
  current_price: number;
  proposed_price: number | null;
  price_floor: number;
  market_price: number | null;
  proposed_action: ProposedAction;
  markdown_step: number | null;
  aging_days: number;
  auction_end_date: string | null;
  auction_duration_days: number | null;
  status: ProposalStatus;
  set_number: string | null;
  item_name: string | null;
  sales_rank: number | null;
  /**
   * Number of in-play units this proposal covers. Amazon proposals are generated
   * once per (asin, condition) group (an Amazon price is per-ASIN and approval
   * reprices the whole ASIN), so units = the group size. eBay is per-listing → 1.
   */
  units: number;
}

export interface CronResult {
  itemsEvaluated: number;
  proposalsCreated: number;
  markdownProposals: number;
  auctionProposals: number;
  autoApplied: number;
  skipped: number;
  held: number;
  errors: number;
}
