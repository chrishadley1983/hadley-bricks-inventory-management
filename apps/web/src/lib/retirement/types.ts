/**
 * Retirement tracking type definitions
 */

export type RetirementSource =
  | 'brickset'
  | 'bricktap'
  | 'brickfanatics'
  | 'stonewars'
  | 'brickeconomy'
  | 'lego_official';

export type RetirementStatus =
  | 'available'
  | 'retiring_soon'
  | 'sold_out'
  | 'retired';

export type RetirementConfidence =
  | 'confirmed'
  | 'likely'
  | 'speculative';

export interface RetirementSourceRecord {
  set_num: string;
  source: RetirementSource;
  expected_retirement_date: string | null;
  status: RetirementStatus | null;
  confidence: RetirementConfidence;
  raw_data?: Record<string, unknown>;
}

export interface RetirementSyncResult {
  source: RetirementSource;
  success: boolean;
  records_processed: number;
  records_upserted: number;
  errors: number;
  error_message?: string;
  duration_ms: number;
}

export interface RetirementRollupResult {
  sets_updated: number;
  confirmed: number;
  likely: number;
  speculative: number;
  duration_ms: number;
}
