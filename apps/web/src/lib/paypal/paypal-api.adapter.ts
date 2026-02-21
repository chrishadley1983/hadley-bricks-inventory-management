/**
 * PayPal API Adapter
 *
 * HTTP client wrapper for PayPal REST APIs with rate limiting, error handling,
 * and automatic pagination support.
 */

import type {
  PayPalTransactionSearchResponse,
  PayPalTransactionFetchParams,
  PayPalApiError,
} from './types';
import { PayPalApiException } from './types';

// ============================================================================
// Constants
// ============================================================================

const PAYPAL_API_BASE_URL = 'https://api.paypal.com';
const PAYPAL_SANDBOX_API_BASE_URL = 'https://api.sandbox.paypal.com';

const TRANSACTION_SEARCH_PATH = '/v1/reporting/transactions';

const DEFAULT_RATE_LIMIT_DELAY_MS = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// PayPal Transaction Search API has a max date range of 31 days
const MAX_DATE_RANGE_DAYS = 31;

// ============================================================================
// Types
// ============================================================================

export interface PayPalApiAdapterConfig {
  accessToken: string;
  sandbox?: boolean;
}

export interface PayPalApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

// ============================================================================
// PayPalApiAdapter Class
// ============================================================================

export class PayPalApiAdapter {
  private accessToken: string;
  private baseUrl: string;
  private lastRequestTime = 0;

  constructor(config: PayPalApiAdapterConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = config.sandbox ? PAYPAL_SANDBOX_API_BASE_URL : PAYPAL_API_BASE_URL;
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  // ============================================================================
  // Transaction Search API Methods
  // ============================================================================

  /**
   * Get transactions with date range and filtering
   * @see https://developer.paypal.com/docs/api/transaction-search/v1/
   */
  async getTransactions(
    params: PayPalTransactionFetchParams
  ): Promise<PayPalTransactionSearchResponse> {
    const queryParams: Record<string, string | number | undefined> = {
      start_date: params.startDate,
      end_date: params.endDate,
      page_size: params.pageSize || 100,
      page: params.page || 1,
    };

    if (params.fields) {
      queryParams.fields = params.fields;
    }

    if (params.transactionType) {
      queryParams.transaction_type = params.transactionType;
    }

    if (params.transactionStatus) {
      queryParams.transaction_status = params.transactionStatus;
    }

    return this.request<PayPalTransactionSearchResponse>(TRANSACTION_SEARCH_PATH, {
      params: queryParams,
    });
  }

  /**
   * Fetch all transactions for a date range using pagination
   * Handles the 31-day date range limit by chunking into multiple requests
   */
  async getAllTransactionsInRange(
    startDate: string,
    endDate: string,
    options?: {
      fields?: string;
      transactionType?: string;
      transactionStatus?: string;
      onProgress?: (fetched: number, total: number) => void;
    }
  ): Promise<PayPalTransactionSearchResponse['transaction_details']> {
    const allTransactions: PayPalTransactionSearchResponse['transaction_details'] = [];

    // Split date range into 31-day chunks
    const dateChunks = this.splitDateRange(startDate, endDate, MAX_DATE_RANGE_DAYS);

    console.log(
      `[PayPalApiAdapter] Fetching transactions from ${startDate} to ${endDate} in ${dateChunks.length} chunk(s)`
    );

    for (const chunk of dateChunks) {
      console.log(`[PayPalApiAdapter] Fetching chunk: ${chunk.startDate} to ${chunk.endDate}`);

      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const response = await this.getTransactions({
          startDate: chunk.startDate,
          endDate: chunk.endDate,
          page,
          pageSize: 500, // Max page size
          fields: options?.fields || 'all',
          transactionType: options?.transactionType,
          transactionStatus: options?.transactionStatus,
        });

        // Handle empty responses (no transactions for this period)
        if (response.transaction_details && response.transaction_details.length > 0) {
          allTransactions.push(...response.transaction_details);
        }
        totalPages = response.total_pages || 1;

        if (options?.onProgress) {
          options.onProgress(allTransactions.length, response.total_items || 0);
        }

        page++;
      }
    }

    return allTransactions;
  }

  // ============================================================================
  // Date Range Helpers
  // ============================================================================

  /**
   * Split a date range into chunks of maxDays
   */
  private splitDateRange(
    startDate: string,
    endDate: string,
    maxDays: number
  ): Array<{ startDate: string; endDate: string }> {
    const chunks: Array<{ startDate: string; endDate: string }> = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    let chunkStart = new Date(start);

    while (chunkStart < end) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + maxDays);

      // Don't exceed the overall end date
      if (chunkEnd > end) {
        chunkEnd.setTime(end.getTime());
      }

      chunks.push({
        startDate: chunkStart.toISOString(),
        endDate: chunkEnd.toISOString(),
      });

      // Move to next chunk (add 1 second to avoid overlap)
      chunkStart = new Date(chunkEnd.getTime() + 1000);
    }

    return chunks;
  }

  /**
   * Get the date 31 days ago from a given date (or now)
   */
  static getMaxHistoryDate(fromDate?: Date): Date {
    const date = fromDate || new Date();
    date.setDate(date.getDate() - MAX_DATE_RANGE_DAYS);
    return date;
  }

  /**
   * Check if a date range exceeds the maximum allowed
   */
  static isDateRangeValid(startDate: string, endDate: string): boolean {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= MAX_DATE_RANGE_DAYS;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make an API request with rate limiting and retry logic
   */
  private async request<T>(path: string, options: PayPalApiRequestOptions = {}): Promise<T> {
    // Rate limiting - ensure minimum delay between requests
    await this.enforceRateLimit();

    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    console.log(`[PayPalApiAdapter] Request: ${options.method || 'GET'} ${url.toString()}`);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[PayPalApiAdapter] Attempt ${attempt + 1}/${MAX_RETRIES}`);

        const response = await fetch(url.toString(), {
          method: options.method || 'GET',
          headers: requestHeaders,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        console.log(
          `[PayPalApiAdapter] Response status: ${response.status} ${response.statusText}`
        );

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : RETRY_DELAY_MS * (attempt + 1);
          console.warn(`[PayPalApiAdapter] Rate limited, retrying after ${delayMs}ms`);
          await this.delay(delayMs);
          continue;
        }

        // Handle other errors
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const errorResponse = errorBody as PayPalApiError | null;
          console.error(
            `[PayPalApiAdapter] Error response:`,
            JSON.stringify(errorResponse, null, 2)
          );

          const errorMessage =
            errorResponse?.message || `HTTP ${response.status}: ${response.statusText}`;

          throw new PayPalApiException(errorMessage, response.status, errorResponse || undefined);
        }

        const data = (await response.json()) as T;
        console.log(`[PayPalApiAdapter] Success - received data`);
        return data;
      } catch (error) {
        lastError = error as Error;
        console.error(`[PayPalApiAdapter] Request error:`, error);

        // Don't retry on non-retryable errors
        if (error instanceof PayPalApiException) {
          // 401 Unauthorized - token expired, don't retry
          if (error.statusCode === 401) {
            throw error;
          }

          // 403 Forbidden - insufficient scopes, don't retry
          if (error.statusCode === 403) {
            throw error;
          }

          // 4xx errors (except 429) - don't retry
          if (error.statusCode >= 400 && error.statusCode < 500) {
            throw error;
          }
        }

        // Exponential backoff for server errors
        if (attempt < MAX_RETRIES - 1) {
          const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[PayPalApiAdapter] Request failed, retrying in ${delayMs}ms`, error);
          await this.delay(delayMs);
        }
      }
    }

    throw lastError || new Error('Request failed after maximum retries');
  }

  /**
   * Enforce rate limiting between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < DEFAULT_RATE_LIMIT_DELAY_MS) {
      await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
