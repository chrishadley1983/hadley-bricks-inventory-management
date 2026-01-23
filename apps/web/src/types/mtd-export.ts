/**
 * MTD (Making Tax Digital) Export Types
 *
 * Types for QuickFile MTD export functionality including
 * CSV generation, QuickFile API integration, and export history.
 */

/**
 * QuickFile credentials stored in platform_credentials
 */
export interface QuickFileCredentials {
  accountNumber: string;
  apiKey: string;
}

/**
 * Sales row for CSV export
 */
export interface MtdSalesRow {
  date: string; // YYYY-MM-DD (last day of month)
  reference: string; // PLATFORM-YYYY-MM
  description: string; // Platform Sales - Month Year
  netAmount: number; // 2 decimal places
  vat: number; // Always 0.00 (below VAT threshold)
  grossAmount: number; // Same as netAmount
  nominalCode: string; // 4000 for sales
}

/**
 * Expense row for CSV export
 */
export interface MtdExpenseRow {
  date: string; // YYYY-MM-DD
  reference: string; // CATEGORY-YYYY-MM
  supplier: string; // 'Various' or 'HMRC'
  description: string;
  netAmount: number;
  vat: number;
  grossAmount: number;
  nominalCode: string; // 5000, 7008, 7300, 7502, 7503, 7600, 7901
}

/**
 * CSV data for export
 */
export interface MtdCsvData {
  sales: MtdSalesRow[];
  expenses: MtdExpenseRow[];
  month: string; // YYYY-MM
  lastDayOfMonth: string; // YYYY-MM-DD
}

/**
 * Export request payload
 */
export interface MtdExportRequest {
  month: string; // YYYY-MM
  action: 'csv' | 'quickfile';
}

/**
 * QuickFile API response for a successful push
 */
export interface MtdExportResponse {
  success: boolean;
  invoicesCreated?: number;
  purchasesCreated?: number;
  message?: string;
  error?: string;
}

/**
 * Export history entry from database
 */
export interface MtdExportHistoryEntry {
  id: string;
  userId: string;
  month: string;
  exportType: 'csv' | 'quickfile';
  entriesCount: number;
  quickfileResponse?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * Export preview for confirmation dialog
 */
export interface MtdExportPreview {
  month: string;
  monthLabel: string; // "January 2026"
  salesCount: number;
  salesTotal: number;
  expensesCount: number;
  expensesTotal: number;
  previousExport?: {
    exportedAt: string;
    exportType: 'csv' | 'quickfile';
  };
}

/**
 * QuickFile nominal code mapping
 */
export const QUICKFILE_NOMINAL_CODES = {
  // Income
  SALES: '4000',
  // Expenses
  COST_OF_GOODS_SOLD: '5000',
  USE_OF_HOME: '7008',
  TRAVEL_MOTOR: '7300',
  SELLING_FEES: '7502',
  POSTAGE_CARRIAGE: '7503',
  SOFTWARE_IT: '7600',
  SUNDRY_EXPENSES: '7901',
} as const;

/**
 * Category to nominal code mapping
 */
export const CATEGORY_NOMINAL_MAPPING: Record<string, string> = {
  'Stock Purchase': QUICKFILE_NOMINAL_CODES.COST_OF_GOODS_SOLD,
  'Selling Fees': QUICKFILE_NOMINAL_CODES.SELLING_FEES,
  'Packing & Postage': QUICKFILE_NOMINAL_CODES.POSTAGE_CARRIAGE,
  Mileage: QUICKFILE_NOMINAL_CODES.TRAVEL_MOTOR,
  'Home Costs': QUICKFILE_NOMINAL_CODES.USE_OF_HOME,
  Software: QUICKFILE_NOMINAL_CODES.SOFTWARE_IT,
  'Software/Services': QUICKFILE_NOMINAL_CODES.SOFTWARE_IT,
};

/**
 * Platform display names for CSV references
 */
export const PLATFORM_REFERENCE_NAMES: Record<string, string> = {
  ebay: 'EBAY',
  amazon: 'AMAZON',
  bricklink: 'BRICKLINK',
  brickowl: 'BRICKOWL',
};
