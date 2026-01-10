/**
 * Amazon SP-API Reports Client
 *
 * Client for fetching reports from Amazon's Selling Partner API Reports endpoint.
 * Supports the GET_MERCHANT_LISTINGS_ALL_DATA report for stock reconciliation.
 *
 * Report workflow:
 * 1. createReport() - Request report generation
 * 2. waitForReport() - Poll until report is ready
 * 3. getReportDocument() - Get download URL
 * 4. downloadReport() - Download and decompress content
 */

import type { AmazonCredentials } from '@/lib/amazon/types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** Reports API version path */
const REPORTS_API_PATH = '/reports/2021-06-30';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Default poll interval when waiting for report (10 seconds) */
const DEFAULT_POLL_INTERVAL_MS = 10000;

/** Maximum time to wait for report generation (5 minutes) */
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000;

/** Delay between API calls for rate limiting */
const API_DELAY_MS = 200;

// ============================================================================
// TYPES
// ============================================================================

/** Report types supported by this client */
export type AmazonReportType =
  | 'GET_MERCHANT_LISTINGS_ALL_DATA'
  | 'GET_MERCHANT_LISTINGS_DATA'
  | 'GET_MERCHANT_LISTINGS_INACTIVE_DATA'
  | 'GET_MERCHANT_LISTINGS_DATA_BACK_COMPAT';

/** Report processing status */
export type ReportProcessingStatus =
  | 'CANCELLED'
  | 'DONE'
  | 'FATAL'
  | 'IN_PROGRESS'
  | 'IN_QUEUE';

/** Create report request body */
export interface CreateReportRequest {
  reportType: AmazonReportType;
  marketplaceIds: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
}

/** Create report response */
export interface CreateReportResponse {
  reportId: string;
}

/** Report status response */
export interface ReportStatusResponse {
  reportId: string;
  reportType: string;
  dataStartTime?: string;
  dataEndTime?: string;
  marketplaceIds?: string[];
  processingStatus: ReportProcessingStatus;
  processingStartTime?: string;
  processingEndTime?: string;
  reportDocumentId?: string;
}

/** Report document response */
export interface ReportDocumentResponse {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: 'GZIP';
}

/** Error response from API */
export interface AmazonApiError {
  code: string;
  message: string;
  details?: string;
}

/** Token data for auth management */
interface TokenData {
  accessToken: string;
  expiresAt: Date;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

/**
 * Amazon SP-API Reports Client
 *
 * Provides methods to request, monitor, and download reports from Amazon's
 * Selling Partner API. Uses OAuth 2.0 with LWA token refresh.
 */
export class AmazonReportsClient {
  private credentials: AmazonCredentials;
  private endpoint: string;
  private tokenData: TokenData | null = null;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    // Use EU endpoint for EU marketplaces (UK, DE, FR, IT, ES)
    this.endpoint = EU_ENDPOINT;
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Request a new report to be generated
   *
   * @param reportType - Type of report to generate
   * @param marketplaceIds - Optional marketplace IDs (defaults to credentials)
   * @returns Report ID for tracking
   */
  async createReport(
    reportType: AmazonReportType,
    marketplaceIds?: string[]
  ): Promise<string> {
    const body: CreateReportRequest = {
      reportType,
      marketplaceIds: marketplaceIds || this.credentials.marketplaceIds,
    };

    const response = await this.request<CreateReportResponse>(
      `${REPORTS_API_PATH}/reports`,
      'POST',
      body
    );

    console.log(`[AmazonReportsClient] Report requested: ${response.reportId}`);
    return response.reportId;
  }

  /**
   * Get the status of a report
   *
   * @param reportId - Report ID to check
   * @returns Report status including processing state and document ID if ready
   */
  async getReportStatus(reportId: string): Promise<ReportStatusResponse> {
    return this.request<ReportStatusResponse>(
      `${REPORTS_API_PATH}/reports/${reportId}`,
      'GET'
    );
  }

  /**
   * Wait for a report to complete processing
   *
   * @param reportId - Report ID to wait for
   * @param maxWaitMs - Maximum time to wait (default 5 minutes)
   * @param pollIntervalMs - Interval between status checks (default 10 seconds)
   * @returns Completed report status with document ID
   * @throws Error if report fails or times out
   */
  async waitForReport(
    reportId: string,
    maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ): Promise<ReportStatusResponse> {
    const startTime = Date.now();

    console.log(`[AmazonReportsClient] Waiting for report ${reportId}...`);

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getReportStatus(reportId);

      console.log(
        `[AmazonReportsClient] Report status: ${status.processingStatus}`
      );

      if (status.processingStatus === 'DONE') {
        console.log(
          `[AmazonReportsClient] Report ready: ${status.reportDocumentId}`
        );
        return status;
      }

      if (
        status.processingStatus === 'CANCELLED' ||
        status.processingStatus === 'FATAL'
      ) {
        throw new Error(
          `Report generation failed with status: ${status.processingStatus}`
        );
      }

      // Wait before next poll
      await this.sleep(pollIntervalMs);
    }

    throw new Error(
      `Report generation timed out after ${maxWaitMs / 1000} seconds`
    );
  }

  /**
   * Get the download URL for a report document
   *
   * @param reportDocumentId - Document ID from completed report
   * @returns Document info including download URL and compression type
   */
  async getReportDocument(
    reportDocumentId: string
  ): Promise<ReportDocumentResponse> {
    return this.request<ReportDocumentResponse>(
      `${REPORTS_API_PATH}/documents/${reportDocumentId}`,
      'GET'
    );
  }

  /**
   * Download and decompress report content
   *
   * @param documentUrl - URL from getReportDocument
   * @param isCompressed - Whether the content is GZIP compressed
   * @returns Raw report content (TSV/CSV string)
   */
  async downloadReport(
    documentUrl: string,
    isCompressed: boolean
  ): Promise<string> {
    console.log(
      `[AmazonReportsClient] Downloading report (compressed: ${isCompressed})...`
    );

    const response = await fetch(documentUrl);

    if (!response.ok) {
      throw new Error(`Failed to download report: ${response.status}`);
    }

    if (isCompressed) {
      // Decompress GZIP content
      const arrayBuffer = await response.arrayBuffer();
      return this.decompressGzip(arrayBuffer);
    }

    return response.text();
  }

  /**
   * Complete workflow: request report → wait → download
   *
   * @param reportType - Type of report to fetch
   * @param marketplaceIds - Optional marketplace IDs
   * @returns Raw report content
   */
  async fetchReport(
    reportType: AmazonReportType,
    marketplaceIds?: string[]
  ): Promise<string> {
    // 1. Request report
    const reportId = await this.createReport(reportType, marketplaceIds);

    // 2. Wait for completion
    const status = await this.waitForReport(reportId);

    if (!status.reportDocumentId) {
      throw new Error('Report completed but no document ID returned');
    }

    // 3. Get download URL
    const document = await this.getReportDocument(status.reportDocumentId);

    // 4. Download and return content
    const content = await this.downloadReport(
      document.url,
      document.compressionAlgorithm === 'GZIP'
    );

    console.log(
      `[AmazonReportsClient] Report downloaded: ${content.length} characters`
    );

    return content;
  }

  /**
   * Fetch merchant listings report (GET_MERCHANT_LISTINGS_ALL_DATA)
   *
   * Convenience method for the most common use case.
   *
   * @param marketplaceIds - Optional marketplace IDs
   * @returns Raw TSV report content
   */
  async fetchMerchantListingsReport(marketplaceIds?: string[]): Promise<string> {
    return this.fetchReport('GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds);
  }

  /**
   * Test connection by creating and checking a report
   *
   * @returns true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Just try to get access token - this validates credentials
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('[AmazonReportsClient] Connection test failed:', error);
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - HTTP
  // ==========================================================================

  /**
   * Make an authenticated request to the SP-API
   */
  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    // Rate limiting delay
    await this.sleep(API_DELAY_MS);

    const response = await fetch(url, options);

    // Handle rate limiting
    if (response.status === 429) {
      console.warn('[AmazonReportsClient] Rate limited, waiting 60s...');
      await this.sleep(60000);
      return this.request<T>(path, method, body);
    }

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      this.tokenData = null; // Clear token to force refresh
      throw new Error('Invalid or expired access token');
    }

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = (await response.json()) as {
          errors?: AmazonApiError[];
        };
        if (errorData.errors && errorData.errors.length > 0) {
          errorMessage = errorData.errors
            .map((e) => e.message)
            .join('; ');
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  }

  // ==========================================================================
  // PRIVATE METHODS - AUTH
  // ==========================================================================

  /**
   * Get or refresh the access token
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (
      this.tokenData &&
      this.tokenData.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.tokenData.accessToken;
    }

    console.log('[AmazonReportsClient] Refreshing access token...');

    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AmazonReportsClient] Token refresh failed:', errorText);
      throw new Error(`Failed to refresh token: ${response.status}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokenData = {
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    };

    console.log(
      '[AmazonReportsClient] Token refreshed, expires at:',
      this.tokenData.expiresAt
    );

    return this.tokenData.accessToken;
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Decompress GZIP data
   */
  private async decompressGzip(data: ArrayBuffer): Promise<string> {
    try {
      // Use native DecompressionStream API (available in modern browsers/Node 18+)
      const stream = new DecompressionStream('gzip');
      const decompressedStream = new Response(data).body!.pipeThrough(stream);
      const decompressedBuffer = await new Response(
        decompressedStream
      ).arrayBuffer();
      return new TextDecoder().decode(decompressedBuffer);
    } catch (error) {
      console.error('[AmazonReportsClient] Decompression failed:', error);
      throw new Error('Failed to decompress report content');
    }
  }
}

/**
 * Factory function to create an Amazon Reports client
 */
export function createAmazonReportsClient(
  credentials: AmazonCredentials
): AmazonReportsClient {
  return new AmazonReportsClient(credentials);
}
