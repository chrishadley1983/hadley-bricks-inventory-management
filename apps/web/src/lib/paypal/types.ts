/**
 * PayPal API Types
 *
 * Type definitions for PayPal REST API responses and requests.
 * Based on PayPal Transaction Search API v1 specification.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

// ============================================================================
// Transaction Search API Types
// ============================================================================

export interface PayPalPayerName {
  given_name?: string;
  surname?: string;
  alternate_full_name?: string;
}

export interface PayPalAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country_code?: string;
  postal_code?: string;
}

export interface PayPalPayerInfo {
  account_id?: string;
  email_address?: string;
  payer_name?: PayPalPayerName;
  address?: PayPalAddress;
}

export interface PayPalShippingInfo {
  name?: string;
  address?: PayPalAddress;
}

export interface PayPalItemDetail {
  item_name?: string;
  item_description?: string;
  item_quantity?: string;
  item_unit_price?: PayPalAmount;
  item_amount?: PayPalAmount;
  tax_amounts?: Array<{
    tax_amount?: PayPalAmount;
  }>;
}

export interface PayPalCartInfo {
  item_details?: PayPalItemDetail[];
  tax_inclusive?: boolean;
  paypal_invoice_id?: string;
}

export interface PayPalStoreInfo {
  store_id?: string;
  terminal_id?: string;
}

export interface PayPalAuctionInfo {
  auction_site?: string;
  auction_item_site?: string;
  auction_buyer_id?: string;
  auction_closing_date?: string;
}

export interface PayPalIncentiveDetail {
  incentive_type?: string;
  incentive_code?: string;
  incentive_amount?: PayPalAmount;
  incentive_program_code?: string;
}

export interface PayPalIncentiveInfo {
  incentive_details?: PayPalIncentiveDetail[];
}

export interface PayPalTransactionInfo {
  transaction_id: string;
  transaction_event_code: string;
  transaction_initiation_date: string;
  transaction_updated_date: string;
  transaction_amount: PayPalAmount;
  fee_amount?: PayPalAmount;
  transaction_status: string;
  transaction_subject?: string;
  transaction_note?: string;
  ending_balance?: PayPalAmount;
  available_balance?: PayPalAmount;
  invoice_id?: string;
  custom_field?: string;
  protection_eligibility?: string;
  bank_reference_id?: string;
  credit_term?: string;
  credit_transactional_fee?: PayPalAmount;
  credit_promotional_fee?: PayPalAmount;
  annual_percentage_rate?: string;
  payment_method_type?: string;
}

export interface PayPalTransactionResponse {
  transaction_info: PayPalTransactionInfo;
  payer_info?: PayPalPayerInfo;
  shipping_info?: PayPalShippingInfo;
  cart_info?: PayPalCartInfo;
  store_info?: PayPalStoreInfo;
  auction_info?: PayPalAuctionInfo;
  incentive_info?: PayPalIncentiveInfo;
}

export interface PayPalTransactionSearchLink {
  href: string;
  rel: string;
  method: string;
}

export interface PayPalTransactionSearchResponse {
  transaction_details: PayPalTransactionResponse[];
  account_number: string;
  start_date: string;
  end_date: string;
  last_refreshed_datetime: string;
  page: number;
  total_items: number;
  total_pages: number;
  links: PayPalTransactionSearchLink[];
}

// ============================================================================
// OAuth Types
// ============================================================================

export interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  app_id: string;
  expires_in: number;
  nonce: string;
  scope: string;
}

export interface PayPalCredentialsConfig {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface PayPalTransactionFetchParams {
  startDate: string;
  endDate: string;
  fields?: string;
  pageSize?: number;
  page?: number;
  transactionType?: string;
  transactionStatus?: string;
}

// ============================================================================
// Sync Types
// ============================================================================

export type PayPalSyncMode = 'FULL' | 'INCREMENTAL' | 'HISTORICAL';

export interface PayPalSyncOptions {
  fullSync?: boolean;
  fromDate?: string;
  toDate?: string;
}

export interface PayPalSyncResult {
  success: boolean;
  syncMode: PayPalSyncMode;
  transactionsProcessed: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsSkipped: number;
  lastSyncCursor?: string;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export interface PayPalSyncConfig {
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number;
  lastAutoSyncAt?: string;
  nextAutoSyncAt?: string;
  lastSyncDateCursor?: string;
  historicalImportStartedAt?: string;
  historicalImportCompletedAt?: string;
  historicalImportFromDate?: string;
}

export interface PayPalSyncLog {
  id: string;
  syncMode: PayPalSyncMode;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  transactionsProcessed: number | null;
  transactionsCreated: number | null;
  transactionsUpdated: number | null;
  transactionsSkipped: number | null;
  fromDate?: string;
  toDate?: string;
  lastSyncCursor?: string;
  errorMessage?: string;
}

// ============================================================================
// Database Row Types (matching Supabase schema)
// ============================================================================

export interface PayPalCredentialsRow {
  id: string;
  user_id: string;
  client_id: string;
  client_secret: string;
  access_token?: string;
  access_token_expires_at?: string;
  sandbox: boolean;
  created_at: string;
  updated_at: string;
}

// Supabase Json type compatibility
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface PayPalTransactionRow {
  id: string;
  user_id: string;
  paypal_transaction_id: string;
  transaction_date: string;
  transaction_updated_date?: string | null;
  time_zone?: string | null;
  transaction_type?: string | null;
  transaction_event_code?: string | null;
  transaction_status?: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  balance_amount?: number | null;
  currency: string;
  description?: string | null;
  from_email?: string | null;
  payer_name?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  postage_amount?: number | null;
  vat_amount?: number | null;
  invoice_id?: string | null;
  reference_txn_id?: string | null;
  raw_response: Json;
  created_at: string;
  updated_at: string;
}

export interface PayPalSyncLogRow {
  id: string;
  user_id: string;
  sync_mode: PayPalSyncMode;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  started_at: string;
  completed_at?: string;
  transactions_processed: number;
  transactions_created: number;
  transactions_updated: number;
  transactions_skipped: number;
  from_date?: string;
  to_date?: string;
  last_sync_cursor?: string;
  error_message?: string;
  created_at: string;
}

export interface PayPalSyncConfigRow {
  id: string;
  user_id: string;
  auto_sync_enabled: boolean;
  auto_sync_interval_hours: number;
  last_auto_sync_at?: string;
  next_auto_sync_at?: string;
  last_sync_date_cursor?: string;
  historical_import_started_at?: string;
  historical_import_completed_at?: string;
  historical_import_from_date?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Error Types
// ============================================================================

export interface PayPalApiErrorDetail {
  issue: string;
  description: string;
  field?: string;
  value?: string;
  location?: string;
}

export interface PayPalApiError {
  name: string;
  message: string;
  debug_id?: string;
  details?: PayPalApiErrorDetail[];
  links?: PayPalTransactionSearchLink[];
}

export class PayPalApiException extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorResponse?: PayPalApiError
  ) {
    super(message);
    this.name = 'PayPalApiException';
  }
}

// ============================================================================
// Connection Status Types
// ============================================================================

export interface PayPalConnectionStatus {
  isConnected: boolean;
  sandbox?: boolean;
  transactionCount?: number;
  lastSyncAt?: string;
  syncConfig?: PayPalSyncConfig;
  recentLogs?: PayPalSyncLog[];
}
