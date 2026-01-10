# eBay Stock Comparison Page - Implementation Plan

## Overview

Implementation of an eBay Stock comparison page that mirrors the Amazon stock functionality, with eBay-specific adaptations.

**Key Decisions (Confirmed)**:
1. **API**: Trading API (`GetMyeBaySelling`) - provides rich listing data
2. **Matching**: SKU-based with condition mismatch warnings
3. **Duplicates**: SKU must be unique - error screen for non-unique/empty SKUs
4. **Navigation**: Separate page at `/ebay-stock`
5. **Data Capture**: Full data (watchers, time left, categories, best offer, etc.)
6. **XML Parsing**: `fast-xml-parser` package

---

## Database Schema

### Migration: `20260111000001_ebay_stock.sql`

```sql
-- eBay Stock Tables and Extensions
-- Extends platform_listing_imports for eBay-specific tracking

-- Add eBay-specific columns to platform_listing_imports
ALTER TABLE platform_listing_imports
ADD COLUMN IF NOT EXISTS ebay_page_number INT,
ADD COLUMN IF NOT EXISTS ebay_total_pages INT,
ADD COLUMN IF NOT EXISTS ebay_total_entries INT;

-- Index for eBay platform queries
CREATE INDEX IF NOT EXISTS idx_platform_listings_ebay_sku
ON platform_listings(user_id, platform_sku)
WHERE platform = 'ebay';

-- View for eBay SKU validation (duplicates and empty SKUs)
CREATE OR REPLACE VIEW ebay_sku_issues AS
SELECT
  pl.user_id,
  pl.platform_sku,
  pl.platform_item_id,
  pl.title,
  COUNT(*) OVER (PARTITION BY pl.user_id, pl.platform_sku) as sku_count,
  CASE
    WHEN pl.platform_sku IS NULL OR pl.platform_sku = '' THEN 'empty'
    WHEN COUNT(*) OVER (PARTITION BY pl.user_id, pl.platform_sku) > 1 THEN 'duplicate'
    ELSE 'ok'
  END as issue_type
FROM platform_listings pl
WHERE pl.platform = 'ebay'
  AND (
    pl.platform_sku IS NULL
    OR pl.platform_sku = ''
    OR EXISTS (
      SELECT 1 FROM platform_listings pl2
      WHERE pl2.user_id = pl.user_id
        AND pl2.platform = 'ebay'
        AND pl2.platform_sku = pl.platform_sku
        AND pl2.id != pl.id
    )
  );
```

### EbayData JSONB Structure

The `platform_listings.ebay_data` column will store:

```typescript
interface EbayListingData {
  // Core identifiers
  listingId: string;           // eBay ItemID

  // Listing type & format
  listingType: 'FixedPriceItem' | 'StoreInventory' | 'Auction' | 'AuctionWithBIN';
  format: 'FixedPrice' | 'Auction';

  // Condition
  condition: string;           // "New", "Used", etc.
  conditionId: number;         // eBay condition ID (1000=New, 3000=Used, etc.)

  // Categories
  categoryId: string | null;
  categoryName: string | null;
  storeCategory: string | null;
  storeCategoryId: string | null;

  // Engagement metrics
  watchers: number;
  hitCount: number | null;     // Views if available

  // Auction-specific
  timeLeft: string | null;     // P3D2H15M (ISO 8601 duration)
  bidCount: number | null;
  currentBid: number | null;

  // Best offer
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  minimumBestOfferPrice: number | null;

  // Dates
  listingStartDate: string;
  listingEndDate: string | null;

  // Sales tracking
  quantitySold: number;
  quantityAvailable: number;

  // Image
  galleryUrl: string | null;
}
```

---

## Type Definitions

### New File: `apps/web/src/lib/platform-stock/ebay/types.ts`

```typescript
/**
 * eBay Stock Types
 *
 * Types specific to eBay stock management and Trading API responses.
 */

// ============================================================================
// TRADING API RESPONSE TYPES
// ============================================================================

/** GetMyeBaySelling API Response */
export interface GetMyeBaySellingResponse {
  GetMyeBaySellingResponse: {
    Ack: 'Success' | 'Failure' | 'Warning' | 'PartialFailure';
    Errors?: TradingApiError[];
    ActiveList?: {
      ItemArray?: {
        Item: TradingApiItem | TradingApiItem[];
      };
      PaginationResult?: {
        TotalNumberOfEntries: number;
        TotalNumberOfPages: number;
      };
    };
    SoldList?: { /* similar structure */ };
    UnsoldList?: { /* similar structure */ };
  };
}

export interface TradingApiError {
  ShortMessage: string;
  LongMessage: string;
  ErrorCode: string;
  SeverityCode: 'Error' | 'Warning';
  ErrorParameters?: Array<{ Value: string }>;
}

export interface TradingApiItem {
  ItemID: string;
  Title: string;
  SKU?: string;
  Quantity: number;
  QuantityAvailable: number;
  SellingStatus: {
    CurrentPrice: {
      _: string;
      currencyID: string;
    };
    QuantitySold: number;
    ListingStatus: string;
    BidCount?: number;
    HighBidder?: { UserID: string };
  };
  ListingType: string;
  ListingDetails: {
    StartTime: string;
    EndTime?: string;
    ViewItemURL: string;
  };
  ConditionID?: number;
  ConditionDisplayName?: string;
  PrimaryCategory?: {
    CategoryID: string;
    CategoryName: string;
  };
  Storefront?: {
    StoreCategoryID: string;
    StoreCategoryName: string;
  };
  WatchCount?: number;
  HitCount?: number;
  TimeLeft?: string;
  BestOfferEnabled?: boolean;
  BestOfferDetails?: {
    BestOfferAutoAcceptPrice?: { _: string; currencyID: string };
    MinimumBestOfferPrice?: { _: string; currencyID: string };
  };
  PictureDetails?: {
    GalleryURL?: string;
  };
}

// ============================================================================
// EBAY LISTING TYPES (Normalized)
// ============================================================================

export interface EbayListingData {
  listingId: string;
  listingType: string;
  format: 'FixedPrice' | 'Auction';
  condition: string | null;
  conditionId: number | null;
  categoryId: string | null;
  categoryName: string | null;
  storeCategory: string | null;
  storeCategoryId: string | null;
  watchers: number;
  hitCount: number | null;
  timeLeft: string | null;
  bidCount: number | null;
  currentBid: number | null;
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  minimumBestOfferPrice: number | null;
  listingStartDate: string;
  listingEndDate: string | null;
  quantitySold: number;
  quantityAvailable: number;
  galleryUrl: string | null;
  viewItemUrl: string | null;
}

export interface EbayListing extends PlatformListing {
  platform: 'ebay';
  itemId: string;              // Alias for platformItemId
  ebayData: EbayListingData;
}

// ============================================================================
// SKU VALIDATION TYPES
// ============================================================================

export type SkuIssueType = 'empty' | 'duplicate' | 'ok';

export interface SkuIssue {
  sku: string | null;
  itemId: string;
  title: string;
  issueType: SkuIssueType;
  duplicateCount?: number;
  duplicateItems?: Array<{ itemId: string; title: string }>;
}

export interface SkuValidationResult {
  hasIssues: boolean;
  emptySkuCount: number;
  duplicateSkuCount: number;
  issues: SkuIssue[];
}

// ============================================================================
// COMPARISON TYPES (eBay-specific extensions)
// ============================================================================

export interface EbayStockComparison extends StockComparison {
  // Additional eBay-specific fields
  ebayCondition: string | null;
  inventoryCondition: string | null;
  conditionMismatch: boolean;
  listingType: string | null;
}
```

---

## Service Layer

### New File: `apps/web/src/lib/platform-stock/ebay/ebay-stock.service.ts`

```typescript
export class EbayStockService extends PlatformStockService {
  platform: StockPlatform = 'ebay';

  constructor(supabase: SupabaseClient, userId: string) {
    super(supabase, userId, 'ebay');
  }

  /**
   * Trigger a full import of eBay listings via Trading API
   */
  async triggerImport(): Promise<ListingImport> {
    // 1. Get eBay credentials from ebay_credentials table
    const credentials = await this.getEbayCredentials();
    if (!credentials) {
      throw new Error('eBay not connected. Please connect your eBay account first.');
    }

    // 2. Ensure token is fresh
    const accessToken = await this.refreshTokenIfNeeded(credentials);

    // 3. Create import record
    const importRecord = await this.createImportRecord('full');

    try {
      // 4. Create Trading API client
      const tradingClient = new EbayTradingClient({
        accessToken,
        siteId: 3, // UK
      });

      // 5. Fetch all active listings (paginated)
      const allListings: ParsedEbayListing[] = [];
      let pageNumber = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await tradingClient.getMyeBaySelling({
          ActiveList: true,
          pageNumber,
          entriesPerPage: 200, // Max allowed
        });

        const items = response.items || [];
        allListings.push(...items);

        hasMore = pageNumber < response.totalPages;
        pageNumber++;

        // Update progress
        await this.updateImportRecord(importRecord.id, {
          processedRows: allListings.length,
          totalRows: response.totalEntries,
        });
      }

      // 6. Delete old listings
      await this.deleteOldListings();

      // 7. Insert new listings in batches
      await this.insertListingsBatch(importRecord.id, allListings);

      // 8. Validate SKUs
      const skuValidation = await this.validateSkus();

      // 9. Complete import
      await this.updateImportRecord(importRecord.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        totalRows: allListings.length,
        processedRows: allListings.length,
        errorCount: skuValidation.emptySkuCount + skuValidation.duplicateSkuCount,
        errorDetails: skuValidation.hasIssues ? skuValidation : null,
      });

      return this.getImportStatus(importRecord.id);

    } catch (error) {
      await this.updateImportRecord(importRecord.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Validate SKUs for issues (empty or duplicate)
   */
  async validateSkus(): Promise<SkuValidationResult> {
    const { data: listings } = await this.supabase
      .from('platform_listings')
      .select('id, platform_sku, platform_item_id, title')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay');

    const issues: SkuIssue[] = [];
    const skuCounts = new Map<string, typeof listings>();

    // Count SKUs
    for (const listing of listings || []) {
      const sku = listing.platform_sku || '';
      if (!skuCounts.has(sku)) {
        skuCounts.set(sku, []);
      }
      skuCounts.get(sku)!.push(listing);
    }

    // Find issues
    for (const [sku, items] of skuCounts) {
      if (sku === '' || sku === null) {
        // Empty SKU issue
        for (const item of items) {
          issues.push({
            sku: null,
            itemId: item.platform_item_id,
            title: item.title || '',
            issueType: 'empty',
          });
        }
      } else if (items.length > 1) {
        // Duplicate SKU issue
        for (const item of items) {
          issues.push({
            sku,
            itemId: item.platform_item_id,
            title: item.title || '',
            issueType: 'duplicate',
            duplicateCount: items.length,
            duplicateItems: items.map(i => ({
              itemId: i.platform_item_id,
              title: i.title || '',
            })),
          });
        }
      }
    }

    return {
      hasIssues: issues.length > 0,
      emptySkuCount: issues.filter(i => i.issueType === 'empty').length,
      duplicateSkuCount: new Set(
        issues.filter(i => i.issueType === 'duplicate').map(i => i.sku)
      ).size,
      issues,
    };
  }

  /**
   * Get stock comparison between eBay and inventory
   */
  async getStockComparison(filters: ComparisonFilters): Promise<{
    comparisons: EbayStockComparison[];
    summary: ComparisonSummary;
  }> {
    // 1. Get all eBay listings
    const ebayListings = await this.getAllListings();

    // 2. Get inventory items listed on eBay with SKU
    const { data: inventoryItems } = await this.supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, condition, listing_value, storage_location, status, created_at')
      .eq('user_id', this.userId)
      .eq('status', 'LISTED')
      .ilike('listing_platform', '%ebay%')
      .not('sku', 'is', null);

    // 3. Also get manual SKU mappings
    const { data: skuMappings } = await this.supabase
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', this.userId);

    // 4. Build comparison map (keyed by SKU)
    const comparisonMap = new Map<string, EbayStockComparison>();

    // Process eBay listings first
    for (const listing of ebayListings) {
      const sku = listing.platformSku;
      if (!sku) continue; // Skip empty SKUs

      const ebayData = listing.rawData as EbayListingData;

      comparisonMap.set(sku, {
        platformItemId: sku, // Use SKU as the key
        platformTitle: listing.title,
        platformQuantity: listing.quantity,
        platformListingStatus: listing.listingStatus,
        platformFulfillmentChannel: null,
        platformPrice: listing.price,
        platformSku: sku,
        inventoryQuantity: 0,
        inventoryTotalValue: 0,
        inventoryItems: [],
        discrepancyType: 'platform_only',
        quantityDifference: listing.quantity,
        priceDifference: null,
        // eBay-specific
        ebayCondition: ebayData?.condition || null,
        inventoryCondition: null,
        conditionMismatch: false,
        listingType: ebayData?.listingType || null,
      });
    }

    // Process inventory items
    for (const item of inventoryItems || []) {
      const sku = item.sku;
      if (!sku) continue;

      const comparison = comparisonMap.get(sku);
      if (comparison) {
        // Add to existing comparison
        comparison.inventoryQuantity += 1;
        comparison.inventoryTotalValue += item.listing_value || 0;
        comparison.inventoryItems.push({
          id: item.id,
          setNumber: item.set_number,
          itemName: item.item_name,
          condition: item.condition,
          listingValue: item.listing_value,
          storageLocation: item.storage_location,
          sku: item.sku,
          status: item.status || '',
          createdAt: item.created_at,
        });

        // Check condition mismatch
        if (!comparison.inventoryCondition) {
          comparison.inventoryCondition = item.condition;
        }
        if (comparison.ebayCondition && item.condition) {
          const ebayNew = comparison.ebayCondition.toLowerCase().includes('new');
          const invNew = item.condition.toLowerCase().includes('new');
          if (ebayNew !== invNew) {
            comparison.conditionMismatch = true;
          }
        }
      } else {
        // Inventory only
        comparisonMap.set(sku, {
          platformItemId: sku,
          platformTitle: null,
          platformQuantity: 0,
          platformListingStatus: null,
          platformFulfillmentChannel: null,
          platformPrice: null,
          platformSku: sku,
          inventoryQuantity: 1,
          inventoryTotalValue: item.listing_value || 0,
          inventoryItems: [{
            id: item.id,
            setNumber: item.set_number,
            itemName: item.item_name,
            condition: item.condition,
            listingValue: item.listing_value,
            storageLocation: item.storage_location,
            sku: item.sku,
            status: item.status || '',
            createdAt: item.created_at,
          }],
          discrepancyType: 'inventory_only',
          quantityDifference: -1,
          priceDifference: null,
          ebayCondition: null,
          inventoryCondition: item.condition,
          conditionMismatch: false,
          listingType: null,
        });
      }
    }

    // 5. Calculate discrepancy types
    const comparisons: EbayStockComparison[] = [];
    for (const comparison of comparisonMap.values()) {
      comparison.quantityDifference = comparison.platformQuantity - comparison.inventoryQuantity;

      if (comparison.platformQuantity === comparison.inventoryQuantity) {
        comparison.discrepancyType = 'match';
      } else if (comparison.platformQuantity > 0 && comparison.inventoryQuantity === 0) {
        comparison.discrepancyType = 'platform_only';
      } else if (comparison.platformQuantity === 0 && comparison.inventoryQuantity > 0) {
        comparison.discrepancyType = 'inventory_only';
      } else {
        comparison.discrepancyType = 'quantity_mismatch';
      }

      comparisons.push(comparison);
    }

    // 6. Apply filters and sort
    let filtered = comparisons;

    if (filters.discrepancyType && filters.discrepancyType !== 'all') {
      filtered = filtered.filter(c => c.discrepancyType === filters.discrepancyType);
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(c =>
        c.platformSku?.toLowerCase().includes(search) ||
        c.platformTitle?.toLowerCase().includes(search) ||
        c.inventoryItems.some(i =>
          i.setNumber.toLowerCase().includes(search) ||
          i.itemName?.toLowerCase().includes(search)
        )
      );
    }

    if (filters.hideZeroQuantities) {
      filtered = filtered.filter(c =>
        c.platformQuantity > 0 || c.inventoryQuantity > 0
      );
    }

    // Sort: issues first, then by title
    filtered.sort((a, b) => {
      const order = { platform_only: 0, inventory_only: 1, quantity_mismatch: 2, match: 3 };
      const orderDiff = (order[a.discrepancyType] || 99) - (order[b.discrepancyType] || 99);
      if (orderDiff !== 0) return orderDiff;
      return (a.platformTitle || a.platformSku || '').localeCompare(b.platformTitle || b.platformSku || '');
    });

    // 7. Calculate summary
    const summary: ComparisonSummary = {
      totalPlatformListings: ebayListings.length,
      totalPlatformQuantity: ebayListings.reduce((sum, l) => sum + l.quantity, 0),
      totalInventoryItems: inventoryItems?.length || 0,
      matchedItems: comparisons.filter(c => c.discrepancyType === 'match').length,
      platformOnlyItems: comparisons.filter(c => c.discrepancyType === 'platform_only').length,
      inventoryOnlyItems: comparisons.filter(c => c.discrepancyType === 'inventory_only').length,
      quantityMismatches: comparisons.filter(c => c.discrepancyType === 'quantity_mismatch').length,
      priceMismatches: 0,
      lastImportAt: (await this.getLatestImport())?.completedAt || null,
    };

    return { comparisons: filtered, summary };
  }
}
```

### New File: `apps/web/src/lib/platform-stock/ebay/ebay-trading.client.ts`

```typescript
/**
 * eBay Trading API Client
 *
 * Handles communication with eBay's Trading API (XML-based).
 * Uses OAuth 2.0 access tokens for authentication.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';

interface TradingApiConfig {
  accessToken: string;
  siteId?: number; // 3 = UK, 0 = US, etc.
}

interface GetMyeBaySellingParams {
  ActiveList?: boolean;
  SoldList?: boolean;
  UnsoldList?: boolean;
  pageNumber?: number;
  entriesPerPage?: number;
}

export class EbayTradingClient {
  private accessToken: string;
  private siteId: number;
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;

  constructor(config: TradingApiConfig) {
    this.accessToken = config.accessToken;
    this.siteId = config.siteId || 3; // Default to UK

    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '_',
      textNodeName: '_',
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '_',
    });
  }

  /**
   * Call GetMyeBaySelling API
   */
  async getMyeBaySelling(params: GetMyeBaySellingParams): Promise<{
    items: ParsedEbayListing[];
    totalEntries: number;
    totalPages: number;
  }> {
    const requestXml = this.buildGetMyeBaySellingRequest(params);

    const response = await fetch(EBAY_TRADING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-SITEID': String(this.siteId),
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1349',
        'X-EBAY-API-IAF-TOKEN': this.accessToken,
      },
      body: requestXml,
    });

    if (!response.ok) {
      throw new Error(`eBay Trading API error: ${response.status} ${response.statusText}`);
    }

    const responseXml = await response.text();
    const parsed = this.xmlParser.parse(responseXml);

    return this.parseGetMyeBaySellingResponse(parsed);
  }

  private buildGetMyeBaySellingRequest(params: GetMyeBaySellingParams): string {
    const request: any = {
      GetMyeBaySellingRequest: {
        _xmlns: 'urn:ebay:apis:eBLBaseComponents',
        RequesterCredentials: {
          eBayAuthToken: this.accessToken,
        },
        DetailLevel: 'ReturnAll',
        OutputSelector: [
          'ItemID', 'Title', 'SKU', 'Quantity', 'QuantityAvailable',
          'SellingStatus', 'ListingType', 'ListingDetails',
          'ConditionID', 'ConditionDisplayName', 'PrimaryCategory',
          'Storefront', 'WatchCount', 'HitCount', 'TimeLeft',
          'BestOfferEnabled', 'BestOfferDetails', 'PictureDetails',
        ],
      },
    };

    if (params.ActiveList) {
      request.GetMyeBaySellingRequest.ActiveList = {
        Include: 'true',
        Pagination: {
          EntriesPerPage: params.entriesPerPage || 200,
          PageNumber: params.pageNumber || 1,
        },
      };
    }

    return '<?xml version="1.0" encoding="utf-8"?>' + this.xmlBuilder.build(request);
  }

  private parseGetMyeBaySellingResponse(parsed: any): {
    items: ParsedEbayListing[];
    totalEntries: number;
    totalPages: number;
  } {
    const response = parsed.GetMyeBaySellingResponse;

    if (response.Ack !== 'Success' && response.Ack !== 'Warning') {
      const errors = Array.isArray(response.Errors) ? response.Errors : [response.Errors];
      throw new Error(`eBay API Error: ${errors.map((e: any) => e.LongMessage).join(', ')}`);
    }

    const activeList = response.ActiveList || {};
    const items = activeList.ItemArray?.Item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    const pagination = activeList.PaginationResult || {};

    return {
      items: itemArray.map(this.parseItem.bind(this)),
      totalEntries: parseInt(pagination.TotalNumberOfEntries || '0', 10),
      totalPages: parseInt(pagination.TotalNumberOfPages || '0', 10),
    };
  }

  private parseItem(item: any): ParsedEbayListing {
    const sellingStatus = item.SellingStatus || {};
    const listingDetails = item.ListingDetails || {};
    const currentPrice = sellingStatus.CurrentPrice || {};
    const bestOfferDetails = item.BestOfferDetails || {};

    return {
      platformItemId: item.ItemID,
      platformSku: item.SKU || null,
      title: item.Title,
      quantity: parseInt(item.QuantityAvailable || item.Quantity || '0', 10),
      price: parseFloat(currentPrice._ || '0'),
      currency: currentPrice._currencyID || 'GBP',
      listingStatus: this.mapListingStatus(sellingStatus.ListingStatus),
      ebayData: {
        listingId: item.ItemID,
        listingType: item.ListingType,
        format: item.ListingType?.includes('Auction') ? 'Auction' : 'FixedPrice',
        condition: item.ConditionDisplayName || null,
        conditionId: item.ConditionID ? parseInt(item.ConditionID, 10) : null,
        categoryId: item.PrimaryCategory?.CategoryID || null,
        categoryName: item.PrimaryCategory?.CategoryName || null,
        storeCategory: item.Storefront?.StoreCategoryName || null,
        storeCategoryId: item.Storefront?.StoreCategoryID || null,
        watchers: parseInt(item.WatchCount || '0', 10),
        hitCount: item.HitCount ? parseInt(item.HitCount, 10) : null,
        timeLeft: item.TimeLeft || null,
        bidCount: sellingStatus.BidCount ? parseInt(sellingStatus.BidCount, 10) : null,
        currentBid: sellingStatus.CurrentPrice ? parseFloat(sellingStatus.CurrentPrice._) : null,
        bestOfferEnabled: item.BestOfferEnabled === 'true',
        bestOfferAutoAcceptPrice: bestOfferDetails.BestOfferAutoAcceptPrice
          ? parseFloat(bestOfferDetails.BestOfferAutoAcceptPrice._)
          : null,
        minimumBestOfferPrice: bestOfferDetails.MinimumBestOfferPrice
          ? parseFloat(bestOfferDetails.MinimumBestOfferPrice._)
          : null,
        listingStartDate: listingDetails.StartTime,
        listingEndDate: listingDetails.EndTime || null,
        quantitySold: parseInt(sellingStatus.QuantitySold || '0', 10),
        quantityAvailable: parseInt(item.QuantityAvailable || '0', 10),
        galleryUrl: item.PictureDetails?.GalleryURL || null,
        viewItemUrl: listingDetails.ViewItemURL || null,
      },
    };
  }

  private mapListingStatus(status: string): ListingStatus {
    switch (status) {
      case 'Active': return 'Active';
      case 'Completed': return 'Inactive';
      case 'Ended': return 'Inactive';
      default: return 'Unknown';
    }
  }
}
```

---

## API Routes

### New File: `apps/web/src/app/api/ebay-stock/route.ts`

```typescript
// GET /api/ebay-stock - List eBay listings (same pattern as platform-stock)
// Query params: page, pageSize, search, status, hasQuantity
```

### New File: `apps/web/src/app/api/ebay-stock/import/route.ts`

```typescript
// POST /api/ebay-stock/import - Trigger new import
// GET /api/ebay-stock/import - Get import history/status
```

### New File: `apps/web/src/app/api/ebay-stock/comparison/route.ts`

```typescript
// GET /api/ebay-stock/comparison - Stock comparison
// Query params: discrepancyType, search, hideZeroQuantities
```

### New File: `apps/web/src/app/api/ebay-stock/sku-issues/route.ts`

```typescript
// GET /api/ebay-stock/sku-issues - Get SKU validation issues
// Returns empty/duplicate SKU problems for resolution
```

---

## Frontend Components

### Page Structure

```
apps/web/src/app/(dashboard)/ebay-stock/
├── page.tsx              # Main page with tabs
├── loading.tsx           # Loading skeleton
└── sku-issues/
    └── page.tsx          # SKU issues resolution page
```

### Main Page Tabs

1. **eBay Listings** - All imported listings with filters
   - Columns: SKU, Item ID, Title, Qty, Price, Status, Condition, Type, Watchers
   - Filters: Search, Status, Condition, Has Quantity

2. **Stock Comparison** - Same as Amazon but with SKU focus
   - Shows condition mismatch warning badge
   - Summary cards for discrepancy counts

3. **SKU Issues** (conditional tab) - Only shows if there are issues
   - Lists empty SKUs with links to eBay to fix
   - Lists duplicate SKUs with option to merge or differentiate

### New Components

1. `EbayListingsView.tsx` - eBay-specific listings table
2. `EbayComparisonView.tsx` - Comparison with condition mismatch indicator
3. `SkuIssuesView.tsx` - Error resolution interface
4. `ConditionMismatchBadge.tsx` - Visual indicator for condition issues

---

## React Hooks

### Update: `apps/web/src/hooks/use-ebay-stock.ts`

```typescript
export const ebayStockKeys = {
  all: ['ebay-stock'] as const,
  listings: (filters: ListingFilters, page: number, pageSize: number) =>
    [...ebayStockKeys.all, 'listings', filters, page, pageSize] as const,
  comparison: (filters: ComparisonFilters) =>
    [...ebayStockKeys.all, 'comparison', filters] as const,
  imports: () => [...ebayStockKeys.all, 'imports'] as const,
  skuIssues: () => [...ebayStockKeys.all, 'sku-issues'] as const,
};

export function useEbayListings(filters, page, pageSize) { /* ... */ }
export function useEbayStockComparison(filters) { /* ... */ }
export function useEbayImportHistory() { /* ... */ }
export function useEbaySkuIssues() { /* ... */ }
export function useTriggerEbayImport() { /* ... */ }
```

---

## Navigation Update

### Sidebar Entry

```typescript
// In Sidebar.tsx, add new menu item:
{
  title: 'eBay Stock',
  href: '/ebay-stock',
  icon: ShoppingBag, // or appropriate icon
}
```

---

## Implementation Order

### Phase 1: Foundation (Day 1)
1. Add `fast-xml-parser` dependency
2. Create database migration
3. Create eBay types file
4. Create Trading API client

### Phase 2: Service Layer (Day 1-2)
1. Implement `EbayStockService`
2. Implement `triggerImport()`
3. Implement `validateSkus()`
4. Implement `getStockComparison()`

### Phase 3: API Routes (Day 2)
1. Create `/api/ebay-stock/route.ts`
2. Create `/api/ebay-stock/import/route.ts`
3. Create `/api/ebay-stock/comparison/route.ts`
4. Create `/api/ebay-stock/sku-issues/route.ts`

### Phase 4: Frontend (Day 2-3)
1. Create page structure
2. Implement hooks
3. Create eBay-specific components
4. Add navigation

### Phase 5: SKU Issues Resolution (Day 3)
1. Create SKU issues page
2. Add links to eBay for fixing
3. Add duplicate detection UI

### Phase 6: Testing (Day 3-4)
1. Unit tests for Trading API client
2. Unit tests for service
3. API route tests
4. Manual E2E testing

---

## Dependencies to Add

```json
{
  "dependencies": {
    "fast-xml-parser": "^4.3.0"
  }
}
```

---

## Notes & Considerations

1. **Trading API Compatibility**: Using compatibility level 1349 (latest stable)

2. **Rate Limits**: Trading API has 5000 calls/day limit per app. With 200 items/page, most sellers won't hit this.

3. **Token Reuse**: Existing eBay OAuth tokens work with Trading API via `X-EBAY-API-IAF-TOKEN` header.

4. **Condition Mapping**: eBay uses numeric condition IDs:
   - 1000 = New
   - 1500 = New other
   - 2000 = Certified refurbished
   - 3000 = Used
   - etc.

5. **SKU Uniqueness**: eBay doesn't enforce SKU uniqueness at the platform level - that's why we need the validation/error screen.

6. **UK Site**: Using Site ID 3 for UK eBay by default.
