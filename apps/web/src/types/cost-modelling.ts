/**
 * Cost Modelling Types
 * TypeScript interfaces for the cost modelling feature
 */

/**
 * Package types for cost matrix
 */
export type PackageType =
  | 'large_parcel_amazon'
  | 'small_parcel_amazon'
  | 'large_letter_amazon'
  | 'large_parcel_ebay'
  | 'small_parcel_ebay'
  | 'large_letter_ebay';

/**
 * Package cost entry from database
 */
export interface PackageCost {
  id: string;
  scenario_id: string;
  package_type: PackageType;
  postage: number;
  cardboard: number;
  bubble_wrap: number;
  lego_card: number;
  business_card: number;
  created_at: string;
  updated_at: string;
}

/**
 * Database schema for cost_model_scenarios table
 */
export interface CostModelScenario {
  id: string;
  user_id: string;
  name: string;
  description: string | null;

  // Sales Volume & Pricing (per month)
  bl_sales_per_month: number;
  bl_avg_sale_value: number;
  bl_avg_postage_cost: number;
  amazon_sales_per_month: number;
  amazon_avg_sale_value: number;
  amazon_avg_postage_cost: number;
  ebay_sales_per_month: number;
  ebay_avg_sale_value: number;
  ebay_avg_postage_cost: number;

  // Fee Rates (as decimals)
  bl_fee_rate: number;
  amazon_fee_rate: number;
  ebay_fee_rate: number;

  // COG Percentages (as decimals)
  bl_cog_percent: number;
  amazon_cog_percent: number;
  ebay_cog_percent: number;

  // Fixed Costs (Monthly)
  fixed_shopify: number;
  fixed_ebay_store: number;
  fixed_seller_tools: number;
  fixed_amazon: number;
  fixed_storage: number;

  // Annual Costs
  annual_accountant_cost: number;
  annual_misc_costs: number;

  // VAT Settings
  is_vat_registered: boolean;
  vat_flat_rate: number;
  accountant_cost_if_vat: number;

  // Tax Settings
  target_annual_profit: number;
  personal_allowance: number;
  income_tax_rate: number;
  ni_rate: number;

  // Lego Parts
  lego_parts_percent: number;
  lego_parts_percent_bl: number;

  // Draft for auto-save
  draft_data: CostModelScenarioFormData | null;
  draft_updated_at: string | null;

  // Metadata
  is_default: boolean;
  created_at: string;
  updated_at: string;

  // Relations (optional, loaded when needed)
  package_costs?: PackageCost[];
}

/**
 * Form data for editing a scenario (client-side state)
 */
export interface CostModelScenarioFormData {
  name: string;
  description: string;

  // Sales Volume & Pricing (per month)
  blSalesPerMonth: number;
  blAvgSaleValue: number;
  blAvgPostageCost: number;
  amazonSalesPerMonth: number;
  amazonAvgSaleValue: number;
  amazonAvgPostageCost: number;
  ebaySalesPerMonth: number;
  ebayAvgSaleValue: number;
  ebayAvgPostageCost: number;

  // Fee Rates (as decimals, displayed as percentages)
  blFeeRate: number;
  amazonFeeRate: number;
  ebayFeeRate: number;

  // COG Percentages (as decimals)
  blCogPercent: number;
  amazonCogPercent: number;
  ebayCogPercent: number;

  // Fixed Costs (Monthly)
  fixedShopify: number;
  fixedEbayStore: number;
  fixedSellerTools: number;
  fixedAmazon: number;
  fixedStorage: number;

  // Annual Costs
  annualAccountantCost: number;
  annualMiscCosts: number;

  // VAT Settings
  isVatRegistered: boolean;
  vatFlatRate: number;
  accountantCostIfVat: number;

  // Tax Settings
  targetAnnualProfit: number;
  personalAllowance: number;
  incomeTaxRate: number;
  niRate: number;

  // Lego Parts
  legoPartsPercent: number;
  legoPartsPercentBl: number;

  // Package Costs (optional for form, loaded separately)
  packageCosts?: PackageCostFormData[];
}

/**
 * Package cost form data
 */
export interface PackageCostFormData {
  id?: string;
  packageType: PackageType;
  postage: number;
  cardboard: number;
  bubbleWrap: number;
  legoCard: number;
  businessCard: number;
}

/**
 * Calculated P&L results
 */
export interface CalculatedResults {
  // Turnover
  blTurnover: number;
  amazonTurnover: number;
  ebayTurnover: number;
  totalTurnover: number;

  // Fees
  blFees: number;
  amazonFees: number;
  ebayFees: number;
  totalFees: number;

  // VAT
  vatAmount: number;

  // COG
  blCog: number;
  amazonCog: number;
  ebayCog: number;
  totalCog: number;

  // Other costs
  monthlyFixedCosts: number;
  annualFixedCosts: number;
  packagingMaterials: number;
  totalPostage: number;
  legoParts: number;
  accountantCost: number;
  totalOtherCosts: number;

  // Profit
  grossProfit: number;
  netProfit: number;
  profitVsTarget: number;

  // Tax
  taxableIncome: number;
  incomeTax: number;
  nationalInsurance: number;
  totalTax: number;

  // Take-home
  takeHome: number;
  weeklyTakeHome: number;

  // Per-item
  blCogPerItem: number;
  amazonCogPerItem: number;
  ebayCogPerItem: number;
  fixedCostPerSale: number;

  // Total sales
  totalMonthlySales: number;
  totalAnnualSales: number;

  // Time breakdowns
  salesPerDay: number;
  salesPerWeek: number;
  turnoverPerDay: number;
  turnoverPerWeek: number;
  cogBudgetPerDay: number;
  cogBudgetPerWeek: number;

  // Platform-specific metrics for summary views
  blSalesPerDay: number;
  amazonSalesPerDay: number;
  ebaySalesPerDay: number;
  blTurnoverPerDay: number;
  amazonTurnoverPerDay: number;
  ebayTurnoverPerDay: number;
  blCogBudgetPerDay: number;
  amazonCogBudgetPerDay: number;
  ebayCogBudgetPerDay: number;
  blCogBudgetPerWeek: number;
  amazonCogBudgetPerWeek: number;
  ebayCogBudgetPerWeek: number;
}

/**
 * Comparison delta result
 */
export interface ComparisonDelta {
  metric: string;
  scenarioAValue: number;
  scenarioBValue: number;
  delta: number;
  percentChange: number;
  isHighlighted: boolean; // > 10% change
  isBetter: boolean; // B is better than A for this metric
}

/**
 * Create scenario request payload
 */
export interface CreateScenarioRequest {
  name: string;
  description?: string;
}

/**
 * Update scenario request payload
 */
export interface UpdateScenarioRequest extends Partial<CostModelScenarioFormData> {
  packageCosts?: PackageCostFormData[];
}

/**
 * Scenario list item (for dropdown)
 */
export interface ScenarioListItem {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  is_default: boolean;
}

/**
 * Default package costs for new scenarios
 */
export const DEFAULT_PACKAGE_COSTS: PackageCostFormData[] = [
  {
    packageType: 'large_parcel_amazon',
    postage: 3.95,
    cardboard: 0.5,
    bubbleWrap: 0.3,
    legoCard: 0.0,
    businessCard: 0.0,
  },
  {
    packageType: 'small_parcel_amazon',
    postage: 3.35,
    cardboard: 0.3,
    bubbleWrap: 0.2,
    legoCard: 0.0,
    businessCard: 0.0,
  },
  {
    packageType: 'large_letter_amazon',
    postage: 1.55,
    cardboard: 0.15,
    bubbleWrap: 0.1,
    legoCard: 0.0,
    businessCard: 0.0,
  },
  {
    packageType: 'large_parcel_ebay',
    postage: 3.95,
    cardboard: 0.5,
    bubbleWrap: 0.3,
    legoCard: 0.1,
    businessCard: 0.05,
  },
  {
    packageType: 'small_parcel_ebay',
    postage: 3.35,
    cardboard: 0.3,
    bubbleWrap: 0.2,
    legoCard: 0.1,
    businessCard: 0.05,
  },
  {
    packageType: 'large_letter_ebay',
    postage: 1.55,
    cardboard: 0.15,
    bubbleWrap: 0.1,
    legoCard: 0.1,
    businessCard: 0.05,
  },
];

/**
 * Default scenario form values
 */
export const DEFAULT_SCENARIO_VALUES: Omit<CostModelScenarioFormData, 'name' | 'description'> = {
  // Sales Volume & Pricing
  blSalesPerMonth: 165,
  blAvgSaleValue: 15.0,
  blAvgPostageCost: 2.7,
  amazonSalesPerMonth: 75,
  amazonAvgSaleValue: 40.0,
  amazonAvgPostageCost: 3.95,
  ebaySalesPerMonth: 80,
  ebayAvgSaleValue: 25.0,
  ebayAvgPostageCost: 3.2,

  // Fee Rates
  blFeeRate: 0.1,
  amazonFeeRate: 0.183,
  ebayFeeRate: 0.2,

  // COG Percentages
  blCogPercent: 0.2,
  amazonCogPercent: 0.35,
  ebayCogPercent: 0.3,

  // Fixed Costs (Monthly)
  fixedShopify: 25.0,
  fixedEbayStore: 35.0,
  fixedSellerTools: 50.0,
  fixedAmazon: 30.0,
  fixedStorage: 110.0,

  // Annual Costs
  annualAccountantCost: 200.0,
  annualMiscCosts: 1000.0,

  // VAT Settings
  isVatRegistered: false,
  vatFlatRate: 0.075,
  accountantCostIfVat: 1650.0,

  // Tax Settings
  targetAnnualProfit: 26000.0,
  personalAllowance: 12570.0,
  incomeTaxRate: 0.2,
  niRate: 0.06,

  // Lego Parts
  legoPartsPercent: 0.02,
  legoPartsPercentBl: 0.02,
};
