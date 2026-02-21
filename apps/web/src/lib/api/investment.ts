/**
 * API client functions for the investment tracker
 */

export interface InvestmentSet {
  id: string;
  set_number: string;
  set_name: string | null;
  theme: string | null;
  subtheme: string | null;
  year_from: number | null;
  pieces: number | null;
  minifigs: number | null;
  uk_retail_price: number | null;
  retirement_status: string | null;
  expected_retirement_date: string | null;
  retirement_confidence: string | null;
  exclusivity_tier: string | null;
  is_licensed: boolean | null;
  is_ucs: boolean | null;
  is_modular: boolean | null;
  image_url: string | null;
  availability: string | null;
  amazon_asin: string | null;
  has_amazon_listing: boolean | null;
  // Amazon pricing (enriched from amazon_arbitrage_pricing)
  buy_box_price: number | null;
  was_price: number | null;
  sales_rank: number | null;
  offer_count: number | null;
  latest_snapshot_date: string | null;
  // Investment predictions (enriched from investment_predictions)
  investment_score: number | null;
  predicted_1yr_appreciation: number | null;
  predicted_3yr_appreciation: number | null;
  confidence: number | null;
}

export interface InvestmentPrediction {
  set_num: string;
  investment_score: number;
  predicted_1yr_appreciation: number | null;
  predicted_3yr_appreciation: number | null;
  predicted_1yr_price_gbp: number | null;
  predicted_3yr_price_gbp: number | null;
  confidence: number;
  risk_factors: string[];
  amazon_viable: boolean;
  model_version: string | null;
  scored_at: string;
}

export interface InvestmentSetDetail extends InvestmentSet {
  pricing: {
    buy_box_price: number | null;
    was_price: number | null;
    sales_rank: number | null;
    offer_count: number | null;
    lowest_offer_price: number | null;
    total_offer_count: number | null;
    latest_snapshot_date: string | null;
  } | null;
  retirement_sources: {
    source: string;
    expected_retirement_date: string | null;
    status: string | null;
    confidence: string;
    updated_at: string;
  }[];
  prediction: InvestmentPrediction | null;
}

export interface PriceHistoryPoint {
  snapshot_date: string;
  buy_box_price: number | null;
  was_price_90d: number | null;
  lowest_offer_price: number | null;
  sales_rank: number | null;
  offer_count: number | null;
}

export interface PriceHistoryResponse {
  data: PriceHistoryPoint[];
  rrp: number | null;
  asin?: string;
  message?: string;
}

export interface InvestmentFilters {
  search?: string;
  retirementStatus?: 'available' | 'retiring_soon' | 'retired';
  theme?: string;
  minYear?: number;
  maxYear?: number;
  retiringWithinMonths?: number;
  minPieces?: number;
  maxPieces?: number;
  minRrp?: number;
  maxRrp?: number;
  isLicensed?: boolean;
  isUcs?: boolean;
  isModular?: boolean;
  exclusivityTier?: string;
  hasAmazon?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface InvestmentPaginationParams {
  page?: number;
  pageSize?: number;
}

interface InvestmentResponse {
  data: InvestmentSet[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchInvestmentSets(
  filters?: InvestmentFilters,
  pagination?: InvestmentPaginationParams
): Promise<InvestmentResponse> {
  const params = new URLSearchParams();

  if (pagination?.page != null) params.set('page', String(pagination.page));
  if (pagination?.pageSize != null) params.set('pageSize', String(pagination.pageSize));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.retirementStatus) params.set('retirementStatus', filters.retirementStatus);
  if (filters?.theme) params.set('theme', filters.theme);
  if (filters?.minYear != null) params.set('minYear', String(filters.minYear));
  if (filters?.maxYear != null) params.set('maxYear', String(filters.maxYear));
  if (filters?.retiringWithinMonths != null)
    params.set('retiringWithinMonths', String(filters.retiringWithinMonths));
  if (filters?.minPieces != null) params.set('minPieces', String(filters.minPieces));
  if (filters?.maxPieces != null) params.set('maxPieces', String(filters.maxPieces));
  if (filters?.minRrp != null) params.set('minRrp', String(filters.minRrp));
  if (filters?.maxRrp != null) params.set('maxRrp', String(filters.maxRrp));
  if (filters?.isLicensed != null) params.set('isLicensed', String(filters.isLicensed));
  if (filters?.isUcs != null) params.set('isUcs', String(filters.isUcs));
  if (filters?.isModular != null) params.set('isModular', String(filters.isModular));
  if (filters?.exclusivityTier) params.set('exclusivityTier', filters.exclusivityTier);
  if (filters?.hasAmazon != null) params.set('hasAmazon', String(filters.hasAmazon));
  if (filters?.sortBy) params.set('sortBy', filters.sortBy);
  if (filters?.sortOrder) params.set('sortOrder', filters.sortOrder);

  const response = await fetch(`/api/investment?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch investment sets (${response.status})`);
  }

  return response.json();
}

export async function fetchInvestmentSetDetail(setNumber: string): Promise<InvestmentSetDetail> {
  const response = await fetch(`/api/investment/${encodeURIComponent(setNumber)}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch set detail (${response.status})`);
  }

  return response.json();
}

export async function fetchPriceHistory(setNumber: string): Promise<PriceHistoryResponse> {
  const response = await fetch(`/api/investment/${encodeURIComponent(setNumber)}/price-history`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch price history (${response.status})`);
  }

  return response.json();
}

export interface PredictionsFilters {
  minScore?: number;
  retiringWithinMonths?: number;
  theme?: string;
  page?: number;
  pageSize?: number;
}

interface PredictionsResponse {
  data: (InvestmentSet & { prediction: InvestmentPrediction })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchPredictions(filters?: PredictionsFilters): Promise<PredictionsResponse> {
  const params = new URLSearchParams();

  if (filters?.minScore != null) params.set('minScore', String(filters.minScore));
  if (filters?.retiringWithinMonths != null)
    params.set('retiringWithinMonths', String(filters.retiringWithinMonths));
  if (filters?.theme) params.set('theme', filters.theme);
  if (filters?.page != null) params.set('page', String(filters.page));
  if (filters?.pageSize != null) params.set('pageSize', String(filters.pageSize));

  const response = await fetch(`/api/investment/predictions?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch predictions (${response.status})`);
  }

  return response.json();
}

export async function fetchSetPrediction(setNumber: string): Promise<InvestmentPrediction | null> {
  const response = await fetch(`/api/investment/predictions/${encodeURIComponent(setNumber)}`);

  if (!response.ok) {
    if (response.status === 404) return null;
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch prediction (${response.status})`);
  }

  return response.json();
}

export async function fetchInvestmentThemes(): Promise<string[]> {
  const response = await fetch('/api/investment/themes');

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch themes (${response.status})`);
  }

  const result = await response.json();
  return result.themes;
}
