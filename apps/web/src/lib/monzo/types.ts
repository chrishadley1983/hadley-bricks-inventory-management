/**
 * Monzo API Types
 *
 * Type definitions for Monzo API responses and internal service types.
 */

// ============================================================================
// Monzo API Response Types
// ============================================================================

/**
 * Monzo merchant information
 */
export interface MonzoMerchant {
  id: string;
  group_id?: string;
  name: string;
  logo?: string;
  emoji?: string;
  category: string;
  online?: boolean;
  atm?: boolean;
  address?: {
    short_formatted?: string;
    formatted?: string;
    address?: string;
    city?: string;
    region?: string;
    country?: string;
    postcode?: string;
    latitude?: number;
    longitude?: number;
    zoom_level?: number;
    approximate?: boolean;
  };
  metadata?: Record<string, string>;
}

/**
 * Monzo transaction from API
 */
export interface MonzoApiTransaction {
  id: string;
  created: string; // ISO 8601
  description: string;
  amount: number; // Minor units (pence), negative = spending
  currency: string;
  merchant?: MonzoMerchant | null;
  notes: string;
  metadata: Record<string, string>;
  account_id: string;
  account_balance?: number;
  attachments?: unknown[];
  category: string;
  is_load: boolean;
  settled?: string; // ISO 8601
  local_amount?: number;
  local_currency?: string;
  updated?: string;
  decline_reason?: string;
  counterparty?: {
    account_id?: string;
    name?: string;
    preferred_name?: string;
    user_id?: string;
  };
  labels?: string[];
  originator?: boolean;
  include_in_spending?: boolean;
  can_be_excluded_from_breakdown?: boolean;
  can_be_made_subscription?: boolean;
  can_split_the_bill?: boolean;
  can_add_to_tab?: boolean;
  amount_is_pending?: boolean;
  atm_fees_detailed?: unknown;
  parent_account_id?: string;
  scheme?: string;
}

/**
 * Monzo account from API
 */
export interface MonzoApiAccount {
  id: string;
  closed: boolean;
  created: string;
  description: string;
  type: 'uk_retail' | 'uk_retail_joint' | 'uk_business' | string;
  currency: string;
  country_code: string;
  owners?: Array<{
    user_id: string;
    preferred_name?: string;
    preferred_first_name?: string;
  }>;
  account_number?: string;
  sort_code?: string;
  payment_details?: {
    locale_uk?: {
      account_number: string;
      sort_code: string;
    };
  };
}

/**
 * Monzo OAuth token response
 */
export interface MonzoTokenResponse {
  access_token: string;
  client_id: string;
  expires_in: number;
  refresh_token?: string;
  token_type: 'Bearer';
  user_id: string;
}

/**
 * Monzo API error response
 */
export interface MonzoApiError {
  code: string;
  error: string;
  error_description?: string;
  message: string;
}

// ============================================================================
// Internal Service Types
// ============================================================================

/**
 * Monzo connection status
 */
export interface MonzoConnectionStatus {
  isConnected: boolean;
  monzoUserId?: string;
  accountId?: string;
  accountType?: string;
  expiresAt?: Date;
  lastSyncAt?: Date;
  transactionCount?: number;
}

/**
 * Monzo auth state for OAuth flow
 */
export interface MonzoAuthState {
  userId: string;
  returnUrl?: string;
}

/**
 * Monzo auth configuration
 */
export interface MonzoAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Sync result for Monzo transactions
 */
export interface MonzoSyncResult {
  success: boolean;
  syncType: 'FULL' | 'INCREMENTAL';
  transactionsProcessed: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  lastTransactionId?: string;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Sync status for display
 */
export interface MonzoSyncStatus {
  isRunning: boolean;
  lastSync?: {
    type: 'FULL' | 'INCREMENTAL';
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    startedAt: Date;
    completedAt?: Date;
    transactionsProcessed?: number;
    error?: string;
  };
}

/**
 * Transaction fetch parameters
 */
export interface TransactionFetchParams {
  since?: string; // RFC3339 timestamp or transaction ID
  before?: string; // RFC3339 timestamp
  limit?: number; // Max 100
}

// ============================================================================
// Monzo Category Constants
// ============================================================================

/**
 * Monzo default categories
 */
export const MONZO_CATEGORIES = [
  'general',
  'eating_out',
  'expenses',
  'transport',
  'cash',
  'bills',
  'entertainment',
  'shopping',
  'holidays',
  'groceries',
  'personal_care',
  'family',
  'finances',
  'charity',
  'savings',
  'income',
] as const;

export type MonzoCategory = (typeof MONZO_CATEGORIES)[number];

/**
 * Display labels for Monzo categories
 */
export const MONZO_CATEGORY_LABELS: Record<MonzoCategory, string> = {
  general: 'General',
  eating_out: 'Eating Out',
  expenses: 'Expenses',
  transport: 'Transport',
  cash: 'Cash',
  bills: 'Bills',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  holidays: 'Holidays',
  groceries: 'Groceries',
  personal_care: 'Personal Care',
  family: 'Family',
  finances: 'Finances',
  charity: 'Charity',
  savings: 'Savings',
  income: 'Income',
};

/**
 * Format amount from minor units (pence) to display string
 */
export function formatMonzoAmount(amountInPence: number, currency: string = 'GBP'): string {
  const amount = amountInPence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Check if a transaction is income (positive amount)
 */
export function isIncome(amountInPence: number): boolean {
  return amountInPence > 0;
}

/**
 * Check if a transaction is an expense (negative amount)
 */
export function isExpense(amountInPence: number): boolean {
  return amountInPence < 0;
}
