/**
 * Amazon SP-API Feeds Client
 *
 * Client for submitting JSON_LISTINGS_FEED to Amazon's Selling Partner API.
 * Handles feed document creation, upload, submission, and result retrieval.
 *
 * Feed submission workflow:
 * 1. createFeedDocument() - Get pre-signed upload URL
 * 2. uploadFeedContent() - Upload JSON payload to S3
 * 3. createFeed() - Submit feed for processing
 * 4. getFeedStatus() / pollFeedStatus() - Wait for completion
 * 5. getFeedResultDocument() - Get result download URL
 * 6. downloadFeedResult() - Download and parse results
 */

import type { AmazonCredentials } from './types';
import type {
  CreateFeedDocumentResponse,
  CreateFeedResponse,
  FeedStatusResponse,
  FeedResultDocumentResponse,
  AmazonFeedProcessingStatus,
  ListingsFeedPayload,
  FeedProcessingReport,
} from './amazon-sync.types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** Feeds API version path */
const FEEDS_API_PATH = '/feeds/2021-06-30';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Delay between API calls for rate limiting */
const API_DELAY_MS = 200;

/** Default poll interval when waiting for feed (30 seconds) */
const DEFAULT_POLL_INTERVAL_MS = 30000;

/** Maximum time to wait for feed processing (15 minutes) */
const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

// ============================================================================
// TYPES
// ============================================================================

/** Token data for auth management */
interface TokenData {
  accessToken: string;
  expiresAt: Date;
}

/** Error response from API */
interface AmazonApiError {
  code: string;
  message: string;
  details?: string;
}

/** Feed types supported by this client */
export type FeedType = 'JSON_LISTINGS_FEED';

// ============================================================================
// CLIENT CLASS
// ============================================================================

/**
 * Amazon SP-API Feeds Client
 *
 * Provides methods to create, submit, and monitor feeds in Amazon's
 * Selling Partner API. Uses OAuth 2.0 with LWA token refresh.
 */
export class AmazonFeedsClient {
  private credentials: AmazonCredentials;
  private endpoint: string;
  private tokenData: TokenData | null = null;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    // Use EU endpoint for EU marketplaces (UK, DE, FR, IT, ES)
    this.endpoint = EU_ENDPOINT;
  }

  // ==========================================================================
  // PUBLIC METHODS - FEED DOCUMENT
  // ==========================================================================

  /**
   * Create a feed document to get an upload URL
   *
   * @param contentType - MIME type of the feed content
   * @returns Feed document ID and upload URL
   */
  async createFeedDocument(
    contentType: string = 'application/json'
  ): Promise<CreateFeedDocumentResponse> {
    console.log('[AmazonFeedsClient] Creating feed document...');

    const response = await this.request<CreateFeedDocumentResponse>(
      `${FEEDS_API_PATH}/documents`,
      'POST',
      { contentType }
    );

    console.log(
      `[AmazonFeedsClient] Feed document created: ${response.feedDocumentId}`
    );
    return response;
  }

  /**
   * Upload feed content to the pre-signed URL
   *
   * @param uploadUrl - Pre-signed S3 URL from createFeedDocument
   * @param content - Feed content (JSON string)
   * @param contentType - MIME type (should match createFeedDocument)
   */
  async uploadFeedContent(
    uploadUrl: string,
    content: string,
    contentType: string = 'application/json'
  ): Promise<void> {
    console.log(
      `[AmazonFeedsClient] Uploading feed content (${content.length} bytes)...`
    );

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AmazonFeedsClient] Upload failed:', errorText);
      throw new Error(`Failed to upload feed content: ${response.status}`);
    }

    console.log('[AmazonFeedsClient] Feed content uploaded successfully');
  }

  // ==========================================================================
  // PUBLIC METHODS - FEED SUBMISSION
  // ==========================================================================

  /**
   * Create (submit) a feed for processing
   *
   * @param feedType - Type of feed (e.g., JSON_LISTINGS_FEED)
   * @param feedDocumentId - Document ID from createFeedDocument
   * @param marketplaceIds - Target marketplace IDs
   * @returns Feed ID for tracking
   */
  async createFeed(
    feedType: FeedType,
    feedDocumentId: string,
    marketplaceIds: string[]
  ): Promise<CreateFeedResponse> {
    console.log(`[AmazonFeedsClient] Submitting feed (type: ${feedType})...`);

    const response = await this.request<CreateFeedResponse>(
      `${FEEDS_API_PATH}/feeds`,
      'POST',
      {
        feedType,
        marketplaceIds,
        inputFeedDocumentId: feedDocumentId,
      }
    );

    console.log(`[AmazonFeedsClient] Feed submitted: ${response.feedId}`);
    return response;
  }

  /**
   * Get the status of a feed
   *
   * @param feedId - Feed ID to check
   * @returns Feed status including processing state
   */
  async getFeedStatus(feedId: string): Promise<FeedStatusResponse> {
    return this.request<FeedStatusResponse>(
      `${FEEDS_API_PATH}/feeds/${feedId}`,
      'GET'
    );
  }

  /**
   * Poll for feed completion
   *
   * @param feedId - Feed ID to wait for
   * @param maxWaitMs - Maximum time to wait (default 15 minutes)
   * @param pollIntervalMs - Interval between status checks (default 30 seconds)
   * @param onPoll - Optional callback for each poll attempt
   * @returns Completed feed status
   * @throws Error if feed fails or times out
   */
  async pollFeedStatus(
    feedId: string,
    maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    onPoll?: (status: FeedStatusResponse, attemptNumber: number) => void
  ): Promise<FeedStatusResponse> {
    const startTime = Date.now();
    let attemptNumber = 0;

    console.log(`[AmazonFeedsClient] Polling feed ${feedId}...`);

    while (Date.now() - startTime < maxWaitMs) {
      attemptNumber++;
      const status = await this.getFeedStatus(feedId);

      console.log(
        `[AmazonFeedsClient] Feed status (attempt ${attemptNumber}): ${status.processingStatus}`
      );

      if (onPoll) {
        onPoll(status, attemptNumber);
      }

      if (status.processingStatus === 'DONE') {
        console.log(
          `[AmazonFeedsClient] Feed complete: ${status.resultFeedDocumentId}`
        );
        return status;
      }

      if (this.isFeedTerminal(status.processingStatus)) {
        throw new Error(
          `Feed processing failed with status: ${status.processingStatus}`
        );
      }

      // Wait before next poll
      await this.sleep(pollIntervalMs);
    }

    throw new Error(
      `Feed processing timed out after ${maxWaitMs / 1000} seconds`
    );
  }

  // ==========================================================================
  // PUBLIC METHODS - FEED RESULTS
  // ==========================================================================

  /**
   * Get the result document for a completed feed
   *
   * @param resultDocumentId - Result document ID from completed feed
   * @returns Document info including download URL
   */
  async getFeedResultDocument(
    resultDocumentId: string
  ): Promise<FeedResultDocumentResponse> {
    return this.request<FeedResultDocumentResponse>(
      `${FEEDS_API_PATH}/documents/${resultDocumentId}`,
      'GET'
    );
  }

  /**
   * Download and parse feed result
   *
   * @param documentUrl - URL from getFeedResultDocument
   * @param isCompressed - Whether the content is GZIP compressed
   * @returns Parsed feed processing report
   */
  async downloadFeedResult(
    documentUrl: string,
    isCompressed: boolean
  ): Promise<FeedProcessingReport> {
    console.log(
      `[AmazonFeedsClient] Downloading feed result (compressed: ${isCompressed})...`
    );

    const response = await fetch(documentUrl);

    if (!response.ok) {
      throw new Error(`Failed to download feed result: ${response.status}`);
    }

    let content: string;
    if (isCompressed) {
      const arrayBuffer = await response.arrayBuffer();
      content = await this.decompressGzip(arrayBuffer);
    } else {
      content = await response.text();
    }

    console.log(
      `[AmazonFeedsClient] Feed result downloaded: ${content.length} characters`
    );
    console.log(`[AmazonFeedsClient] Feed result raw content:`, content);

    return JSON.parse(content) as FeedProcessingReport;
  }

  // ==========================================================================
  // PUBLIC METHODS - CONVENIENCE
  // ==========================================================================

  /**
   * Complete workflow: create document → upload → submit feed
   *
   * @param payload - Feed payload to submit
   * @param feedType - Type of feed
   * @param marketplaceIds - Target marketplaces
   * @returns Feed ID and document ID
   */
  async submitFeed(
    payload: ListingsFeedPayload,
    feedType: FeedType,
    marketplaceIds: string[]
  ): Promise<{ feedId: string; feedDocumentId: string }> {
    // 1. Create feed document
    const document = await this.createFeedDocument('application/json');

    // 2. Upload content
    const content = JSON.stringify(payload);
    await this.uploadFeedContent(document.url, content, 'application/json');

    // 3. Submit feed
    const feed = await this.createFeed(
      feedType,
      document.feedDocumentId,
      marketplaceIds
    );

    return {
      feedId: feed.feedId,
      feedDocumentId: document.feedDocumentId,
    };
  }

  /**
   * Get feed result after completion
   *
   * @param resultDocumentId - Result document ID from completed feed
   * @returns Parsed feed processing report
   */
  async getFeedResult(resultDocumentId: string): Promise<FeedProcessingReport> {
    const document = await this.getFeedResultDocument(resultDocumentId);
    return this.downloadFeedResult(
      document.url,
      document.compressionAlgorithm === 'GZIP'
    );
  }

  /**
   * Test connection by attempting to get access token
   *
   * @returns true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('[AmazonFeedsClient] Connection test failed:', error);
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Check if feed status is terminal (no more polling needed)
   */
  private isFeedTerminal(status: AmazonFeedProcessingStatus): boolean {
    return status === 'CANCELLED' || status === 'FATAL';
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
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      console.warn(
        `[AmazonFeedsClient] Rate limited, waiting ${waitTime / 1000}s...`
      );
      await this.sleep(waitTime);
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
          errorMessage = errorData.errors.map((e) => e.message).join('; ');
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

    console.log('[AmazonFeedsClient] Refreshing access token...');

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
      console.error('[AmazonFeedsClient] Token refresh failed:', errorText);
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
      '[AmazonFeedsClient] Token refreshed, expires at:',
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
      // Use native DecompressionStream API
      const stream = new DecompressionStream('gzip');
      const decompressedStream = new Response(data).body!.pipeThrough(stream);
      const decompressedBuffer = await new Response(
        decompressedStream
      ).arrayBuffer();
      return new TextDecoder().decode(decompressedBuffer);
    } catch (error) {
      console.error('[AmazonFeedsClient] Decompression failed:', error);
      throw new Error('Failed to decompress feed result');
    }
  }
}

/**
 * Factory function to create an Amazon Feeds client
 */
export function createAmazonFeedsClient(
  credentials: AmazonCredentials
): AmazonFeedsClient {
  return new AmazonFeedsClient(credentials);
}
