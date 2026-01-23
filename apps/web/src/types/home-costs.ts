/**
 * Home Costs Types
 * TypeScript interfaces for the home costs feature
 */

/**
 * Cost types for home working expenses
 */
export type HomeCostType = 'use_of_home' | 'phone_broadband' | 'insurance';

/**
 * Hours per month options for Use of Home (HMRC flat rates)
 */
export type HoursPerMonth = '25-50' | '51-100' | '101+';

/**
 * Phone & Broadband preset descriptions
 */
export type PhoneBroadbandPreset = 'Mobile Phone' | 'Home Broadband' | 'Landline';

/**
 * Display mode for P&L report
 */
export type DisplayMode = 'separate' | 'consolidated';

/**
 * HMRC monthly rates for Use of Home
 */
export const HMRC_RATES: Record<HoursPerMonth, number> = {
  '25-50': 10,
  '51-100': 18,
  '101+': 26,
};

/**
 * Phone & Broadband preset options
 */
export const PHONE_BROADBAND_PRESETS: PhoneBroadbandPreset[] = [
  'Mobile Phone',
  'Home Broadband',
  'Landline',
];

/**
 * Database row type for home_costs table
 */
export interface HomeCostRow {
  id: string;
  user_id: string;
  cost_type: HomeCostType;
  description: string | null;
  start_date: string; // DATE stored as YYYY-MM-DD
  end_date: string | null;
  hours_per_month: HoursPerMonth | null;
  monthly_cost: number | null;
  business_percent: number | null;
  annual_premium: number | null;
  business_stock_value: number | null;
  total_contents_value: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for home_costs_settings table
 */
export interface HomeCostsSettingsRow {
  user_id: string;
  display_mode: DisplayMode;
  updated_at: string;
}

/**
 * API response type for home costs
 */
export interface HomeCostsResponse {
  costs: HomeCost[];
  settings: HomeCostsSettings;
}

/**
 * Normalized home cost for API responses
 */
export interface HomeCost {
  id: string;
  costType: HomeCostType;
  description: string | null;
  startDate: string; // 'YYYY-MM' format
  endDate: string | null; // 'YYYY-MM' format or null

  // Use of Home fields
  hoursPerMonth?: HoursPerMonth;

  // Phone & Broadband fields
  monthlyCost?: number;
  businessPercent?: number;

  // Insurance fields
  annualPremium?: number;
  businessStockValue?: number;
  totalContentsValue?: number;

  createdAt: string;
  updatedAt: string;
}

/**
 * Settings object for API responses
 */
export interface HomeCostsSettings {
  displayMode: DisplayMode;
}

/**
 * Create Use of Home request
 */
export interface CreateUseOfHomeRequest {
  costType: 'use_of_home';
  hoursPerMonth: HoursPerMonth;
  startDate: string; // 'YYYY-MM'
  endDate: string | null;
}

/**
 * Create Phone & Broadband request
 */
export interface CreatePhoneBroadbandRequest {
  costType: 'phone_broadband';
  description: PhoneBroadbandPreset;
  monthlyCost: number;
  businessPercent: number;
  startDate: string; // 'YYYY-MM'
  endDate: string | null;
}

/**
 * Create Insurance request
 */
export interface CreateInsuranceRequest {
  costType: 'insurance';
  annualPremium: number;
  businessStockValue: number;
  totalContentsValue: number;
  startDate: string; // 'YYYY-MM'
  endDate: string | null;
}

/**
 * Union type for create requests
 */
export type CreateHomeCostRequest =
  | CreateUseOfHomeRequest
  | CreatePhoneBroadbandRequest
  | CreateInsuranceRequest;

/**
 * Update request (partial of create)
 */
export type UpdateHomeCostRequest = Partial<
  Omit<CreateUseOfHomeRequest, 'costType'> &
    Omit<CreatePhoneBroadbandRequest, 'costType'> &
    Omit<CreateInsuranceRequest, 'costType'>
>;

/**
 * Update settings request
 */
export interface UpdateSettingsRequest {
  displayMode: DisplayMode;
}

/**
 * Transform database row to API response format
 */
export function transformHomeCostRow(row: HomeCostRow): HomeCost {
  const base = {
    id: row.id,
    costType: row.cost_type,
    description: row.description,
    startDate: row.start_date.substring(0, 7), // Convert YYYY-MM-DD to YYYY-MM
    endDate: row.end_date ? row.end_date.substring(0, 7) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  switch (row.cost_type) {
    case 'use_of_home':
      return {
        ...base,
        hoursPerMonth: row.hours_per_month as HoursPerMonth,
      };
    case 'phone_broadband':
      return {
        ...base,
        monthlyCost: row.monthly_cost ?? undefined,
        businessPercent: row.business_percent ?? undefined,
      };
    case 'insurance':
      return {
        ...base,
        annualPremium: row.annual_premium ?? undefined,
        businessStockValue: row.business_stock_value ?? undefined,
        totalContentsValue: row.total_contents_value ?? undefined,
      };
    default:
      return base;
  }
}

/**
 * Calculate monthly allowance for Use of Home
 */
export function calculateUseOfHomeMonthly(hours: HoursPerMonth): number {
  return HMRC_RATES[hours];
}

/**
 * Calculate claimable amount for Phone & Broadband
 */
export function calculatePhoneBroadbandClaimable(
  monthlyCost: number,
  businessPercent: number
): number {
  return monthlyCost * (businessPercent / 100);
}

/**
 * Calculate Insurance business proportion and claimable
 */
export function calculateInsuranceClaimable(
  annualPremium: number,
  businessStockValue: number,
  totalContentsValue: number
): { proportion: number; annualClaimable: number; monthlyClaimable: number } {
  const proportion = (businessStockValue / totalContentsValue) * 100;
  const annualClaimable = annualPremium * (proportion / 100);
  const monthlyClaimable = annualClaimable / 12;
  return { proportion, annualClaimable, monthlyClaimable };
}

/**
 * Check if a cost is active in a given month
 */
export function isActiveInMonth(
  cost: { startDate: string; endDate: string | null },
  targetMonth: string // 'YYYY-MM'
): boolean {
  if (targetMonth < cost.startDate) return false;
  if (cost.endDate && targetMonth > cost.endDate) return false;
  return true;
}

/**
 * Check if two date ranges overlap
 */
export function dateRangesOverlap(
  a: { startDate: string; endDate: string | null },
  b: { startDate: string; endDate: string | null }
): boolean {
  const aEnd = a.endDate || '9999-12';
  const bEnd = b.endDate || '9999-12';

  // Ranges overlap if neither ends before the other starts
  return !(aEnd < b.startDate || bEnd < a.startDate);
}
