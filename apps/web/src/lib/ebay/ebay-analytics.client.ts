/**
 * eBay Analytics API Client
 *
 * Client for accessing eBay's Sell Analytics API to retrieve traffic data
 * including listing views. Requires user OAuth token with sell.analytics.readonly scope.
 *
 * @see https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport
 */

const EBAY_ANALYTICS_API_BASE = 'https://api.ebay.com/sell/analytics/v1';

// ============================================================================
// Types
// ============================================================================

export interface TrafficReportConfig {
  accessToken: string;
  marketplaceId?: string;
}

export interface TrafficReportParams {
  /** Start date (YYYYMMDD format) */
  startDate: string;
  /** End date (YYYYMMDD format) */
  endDate: string;
  /** Optional list of listing IDs to filter (max 200) */
  listingIds?: string[];
}

export interface TrafficMetricValue {
  value: string;
  applicable: boolean;
}

export interface TrafficDimensionValue {
  value: string;
}

export interface TrafficMetadataValue {
  value: string;
  localizedValue?: string;
}

export interface TrafficRecord {
  dimensionValues: TrafficDimensionValue[];
  metricValues: TrafficMetricValue[];
}

export interface TrafficMetadataRecord {
  value: string;
  metadataValues: TrafficMetadataValue[];
}

export interface TrafficReportResponse {
  header?: {
    dimensionKeys: string[];
    metrics: string[];
  };
  records?: TrafficRecord[];
  dimensionMetadata?: {
    metadataKeys: { key: string; localizedName: string }[];
    metadataRecords: TrafficMetadataRecord[];
  };
  startDate?: string;
  endDate?: string;
  lastUpdatedDate?: string;
  warnings?: Array<{
    errorId?: number;
    domain?: string;
    category?: string;
    message?: string;
  }>;
}

export interface ListingViewsData {
  listingId: string;
  views: number;
  title?: string;
}

// ============================================================================
// Error Class
// ============================================================================

export class EbayAnalyticsApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorId?: number
  ) {
    super(message);
    this.name = 'EbayAnalyticsApiError';
  }
}

// ============================================================================
// Client Class
// ============================================================================

export class EbayAnalyticsClient {
  private accessToken: string;
  private marketplaceId: string;

  constructor(config: TrafficReportConfig) {
    this.accessToken = config.accessToken;
    this.marketplaceId = config.marketplaceId ?? 'EBAY_GB';
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Get traffic report with listing views for specified listings
   *
   * @param params - Report parameters including date range and optional listing IDs
   * @returns Map of listing ID to views count
   */
  async getListingViews(params: TrafficReportParams): Promise<Map<string, ListingViewsData>> {
    const dateRange = `[${params.startDate}..${params.endDate}]`;

    // Build filter string
    // Note: eBay uses pipe (|) separator for multiple listing IDs, not commas
    let filter = `marketplace_ids:{${this.marketplaceId}},date_range:${dateRange}`;
    if (params.listingIds && params.listingIds.length > 0) {
      // Max 20 listing IDs per request when filtering by listing_ids
      const listingIdsStr = params.listingIds.slice(0, 20).join('|');
      filter += `,listing_ids:{${listingIdsStr}}`;
    }

    const url = new URL(`${EBAY_ANALYTICS_API_BASE}/traffic_report`);
    url.searchParams.set('filter', filter);
    url.searchParams.set('dimension', 'LISTING');
    url.searchParams.set('metric', 'LISTING_VIEWS_TOTAL');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Analytics API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.errors?.[0]?.message) {
          errorMessage = errorJson.errors[0].message;
        }
      } catch {
        // Use default error message
      }
      throw new EbayAnalyticsApiError(errorMessage, response.status);
    }

    const data: TrafficReportResponse = await response.json();
    return this.parseTrafficReport(data);
  }

  /**
   * Parse traffic report response into listing views map
   */
  private parseTrafficReport(data: TrafficReportResponse): Map<string, ListingViewsData> {
    const viewsMap = new Map<string, ListingViewsData>();

    if (!data.records || data.records.length === 0) {
      return viewsMap;
    }

    // Build title lookup from metadata
    const titleLookup = new Map<string, string>();
    if (data.dimensionMetadata?.metadataRecords) {
      // Find the title key index
      const titleKeyIndex = data.dimensionMetadata.metadataKeys?.findIndex(
        (k) => k.key === 'LISTING_TITLE'
      );

      if (titleKeyIndex !== undefined && titleKeyIndex >= 0) {
        for (const record of data.dimensionMetadata.metadataRecords) {
          const listingId = record.value;
          const title = record.metadataValues?.[titleKeyIndex]?.value;
          if (listingId && title) {
            titleLookup.set(listingId, title);
          }
        }
      }
    }

    // Parse records
    for (const record of data.records) {
      if (!record.dimensionValues?.[0]?.value) continue;

      const listingId = record.dimensionValues[0].value;
      const viewsValue = record.metricValues?.[0];

      // Check if the metric is applicable
      if (viewsValue?.applicable === false) continue;

      const views = viewsValue?.value ? parseInt(viewsValue.value, 10) : 0;

      viewsMap.set(listingId, {
        listingId,
        views,
        title: titleLookup.get(listingId),
      });
    }

    return viewsMap;
  }

  /**
   * Get views for a batch of listings
   * Automatically handles the 20 listing limit by making multiple requests
   *
   * @param listingIds - Array of listing IDs
   * @param startDate - Start date (YYYYMMDD format)
   * @param endDate - End date (YYYYMMDD format)
   * @param onProgress - Optional callback for progress updates
   * @returns Map of listing ID to views data
   */
  async getBatchListingViews(
    listingIds: string[],
    startDate: string,
    endDate: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, ListingViewsData>> {
    const allViews = new Map<string, ListingViewsData>();

    // Process in batches of 20 (eBay's limit when filtering by listing_ids)
    const batchSize = 20;
    const totalBatches = Math.ceil(listingIds.length / batchSize);

    for (let i = 0; i < listingIds.length; i += batchSize) {
      const batch = listingIds.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;

      if (onProgress) {
        onProgress(currentBatch, totalBatches);
      }

      const batchViews = await this.getListingViews({
        startDate,
        endDate,
        listingIds: batch,
      });

      // Merge results
      for (const [id, data] of batchViews) {
        allViews.set(id, data);
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < listingIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return allViews;
  }
}
