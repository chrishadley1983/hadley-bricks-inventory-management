# Platform Stock

> Unified view of Amazon stock with inventory comparison and repricing tools.

## Purpose

Platform Stock provides a centralised view of your listings on external selling platforms (currently Amazon), enabling you to:

- View all Amazon listings with their quantities and prices
- Compare platform stock against your local inventory
- Identify discrepancies (overselling, underselling, missing listings)
- Access repricing tools for price adjustments

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Listings View** | Browse all Amazon listings with filters |
| **Stock Comparison** | Compare Amazon quantities vs inventory |
| **Discrepancy Detection** | Identify mismatches and missing items |
| **Import Management** | Trigger fresh imports from Amazon |
| **Repricing Access** | Direct access to repricing tools |

## User Journeys

1. [Viewing Listings](./viewing-listings.md) - Browse and filter Amazon listings
2. [Comparing Stock](./comparing-stock.md) - Find inventory discrepancies
3. [Importing Listings](./importing-listings.md) - Refresh data from Amazon

## Page Structure

The Platform Stock page (`/platform-stock`) contains three tabs:

| Tab | Component | Purpose |
|-----|-----------|---------|
| **Listings** | `ListingsView` | View all Amazon listings |
| **Comparison** | `ComparisonView` | Compare platform vs inventory |
| **Repricing** | `RepricingView` | Edit and push prices |

## Feature Components

### Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `PlatformStockHeader` | Header with refresh button | [PlatformStockHeader.tsx](../../../apps/web/src/components/features/platform-stock/PlatformStockHeader.tsx) |
| `ListingsView` | Listings table with filters | [ListingsView.tsx](../../../apps/web/src/components/features/platform-stock/ListingsView.tsx) |
| `ListingsFilters` | Search and filter controls | [ListingsFilters.tsx](../../../apps/web/src/components/features/platform-stock/ListingsFilters.tsx) |
| `ComparisonView` | Stock comparison table | [ComparisonView.tsx](../../../apps/web/src/components/features/platform-stock/ComparisonView.tsx) |
| `ImportStatusBanner` | Import progress indicator | [ImportStatusBanner.tsx](../../../apps/web/src/components/features/platform-stock/ImportStatusBanner.tsx) |

### Services

| Service | Purpose | Location |
|---------|---------|----------|
| `PlatformStockService` | Abstract base class | [platform-stock.service.ts](../../../apps/web/src/lib/platform-stock/platform-stock.service.ts) |
| `AmazonStockService` | Amazon-specific implementation | [amazon-stock.service.ts](../../../apps/web/src/lib/platform-stock/amazon/amazon-stock.service.ts) |
| `EbayStockService` | eBay-specific implementation | [ebay-stock.service.ts](../../../apps/web/src/lib/platform-stock/ebay/ebay-stock.service.ts) |

### Hooks

| Hook | Purpose | Location |
|------|---------|----------|
| `usePlatformListings` | Fetch listings with pagination | [use-platform-stock.ts](../../../apps/web/src/hooks/use-platform-stock.ts) |
| `useStockComparison` | Fetch comparison data | [use-platform-stock.ts](../../../apps/web/src/hooks/use-platform-stock.ts) |
| `useTriggerImport` | Trigger new import | [use-platform-stock.ts](../../../apps/web/src/hooks/use-platform-stock.ts) |

## Data Model

### PlatformListing

```typescript
interface PlatformListing {
  id: string;
  userId: string;
  platform: 'amazon' | 'ebay';
  platformSku: string | null;      // Seller SKU
  platformItemId: string | null;   // ASIN (Amazon) or Item ID (eBay)
  title: string | null;
  quantity: number;
  price: number | null;
  currency: string | null;
  listingStatus: ListingStatus;
  fulfillmentChannel: string | null; // FBA, FBM, etc.
  importId: string | null;
  rawData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string | null;
}
```

### StockComparison

```typescript
interface StockComparison {
  platformItemId: string;           // ASIN
  platformSku: string | null;
  platformTitle: string | null;
  platformQuantity: number;
  platformPrice: number | null;
  platformListingStatus: string | null;
  platformFulfillmentChannel: string | null;
  inventoryQuantity: number;
  quantityDifference: number;       // platform - inventory
  discrepancyType: DiscrepancyType;
  inventoryItems: InventoryItemSummary[];
}

type DiscrepancyType =
  | 'match'           // Quantities match
  | 'platform_only'   // Listed on Amazon, not in inventory
  | 'inventory_only'  // In inventory, not on Amazon
  | 'quantity_mismatch'; // Different quantities
```

## Technical Architecture

### Import Process

1. **Trigger Import**: User clicks refresh button
2. **Request Report**: Amazon SP-API generates inventory report
3. **Download Report**: Parse TSV/CSV report data
4. **Store Listings**: Save to `platform_listings` table
5. **Update Import Record**: Mark import complete

### Comparison Algorithm

1. Fetch all platform listings for user
2. Fetch inventory items with Amazon ASINs
3. Match by ASIN (inventory's `amazonAsin` field)
4. Calculate quantity differences
5. Categorise discrepancy type

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/platform-stock` | GET | Fetch listings with filters |
| `/api/platform-stock/comparison` | GET | Fetch stock comparison |
| `/api/platform-stock/[platform]/import` | POST | Trigger new import |
| `/api/platform-stock/[platform]/import` | GET | Get import history |

## Database Tables

| Table | Purpose |
|-------|---------|
| `platform_listings` | Stores imported listings |
| `platform_listing_imports` | Tracks import jobs |

## Integration Points

- **Amazon SP-API**: Fetches inventory reports
- **Inventory System**: Provides local stock data
- **Repricing Module**: Embedded in same page

## Related Features

- [Amazon Integration](../amazon/overview.md) - Amazon API setup
- [Repricing](../repricing/overview.md) - Price management tools
- [eBay Stock](../ebay/ebay-stock-management.md) - eBay equivalent
