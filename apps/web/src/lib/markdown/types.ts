export type Diagnosis = 'OVERPRICED' | 'LOW_DEMAND' | 'HOLDING';
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
}

export interface PricingData {
  marketPrice: number | null;       // Keepa 90d avg (Amazon) or eBay avg sold
  buyBoxPrice: number | null;       // Amazon buy box
  salesRank: number | null;
  was_price_90d: number | null;
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
