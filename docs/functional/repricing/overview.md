# Repricing

> Manage Amazon listing prices with real-time Buy Box comparison and one-click price updates.

## Purpose

The Repricing feature provides a comprehensive view of your Amazon FBM (Fulfilled by Merchant) listings, allowing you to:

- Compare your prices against the current Buy Box price
- Identify listings where you've lost the Buy Box
- Edit prices inline and push updates to Amazon
- Calculate profit margins including all Amazon fees

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Price Comparison** | View your price vs Buy Box/lowest offer price |
| **Buy Box Tracking** | See which listings have the Buy Box and which lost it |
| **Inline Editing** | Edit prices directly in the table |
| **One-Click Push** | Push price updates to Amazon via SP-API |
| **Profit Calculator** | See profit breakdown including referral fees, DST, VAT, and shipping |
| **Cost Override** | Enter manual costs for profit calculation |
| **Data Caching** | 3-hour cache with manual sync option |

## User Journeys

1. [Viewing Repricing Data](./viewing-repricing.md) - Browse and filter your Amazon listings
2. [Editing Prices](./editing-prices.md) - Change prices and push to Amazon
3. [Profit Analysis](./profit-analysis.md) - Understand profit margins per listing

## Feature Components

### Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `RepricingView` | Main container with filters and pagination | [RepricingView.tsx](../../../apps/web/src/components/features/repricing/RepricingView.tsx) |
| `RepricingTable` | Data table with all listings | [RepricingTable.tsx](../../../apps/web/src/components/features/repricing/RepricingTable.tsx) |
| `RepricingRow` | Individual listing row with editing | [RepricingRow.tsx](../../../apps/web/src/components/features/repricing/RepricingRow.tsx) |
| `RepricingFilters` | Search and filter controls | [RepricingFilters.tsx](../../../apps/web/src/components/features/repricing/RepricingFilters.tsx) |
| `PushPriceButton` | Button with push status indicator | [PushPriceButton.tsx](../../../apps/web/src/components/features/repricing/PushPriceButton.tsx) |
| `ProfitCalculator` | Profit breakdown tooltip | [ProfitCalculator.tsx](../../../apps/web/src/components/features/repricing/ProfitCalculator.tsx) |

### Hooks

| Hook | Purpose | Location |
|------|---------|----------|
| `useRepricingData` | Fetch repricing data with caching | [use-repricing.ts](../../../apps/web/src/hooks/use-repricing.ts) |
| `useSyncPricing` | Manual sync trigger | [use-repricing.ts](../../../apps/web/src/hooks/use-repricing.ts) |
| `usePushPrice` | Push price update mutation | [use-repricing.ts](../../../apps/web/src/hooks/use-repricing.ts) |

## Data Model

### RepricingItem

```typescript
interface RepricingItem {
  asin: string;           // Amazon Standard Identification Number
  sku: string;            // Your seller SKU
  title: string;          // Product title
  quantity: number;       // Available quantity
  yourPrice: number;      // Your current listing price
  buyBoxPrice: number | null;     // Current Buy Box price
  lowestOfferPrice: number | null; // Lowest competing offer
  effectivePrice: number | null;   // Buy Box or lowest if no Buy Box
  priceSource: 'buybox' | 'lowest' | 'none';
  buyBoxIsYours: boolean; // Whether you have the Buy Box
  wasPrice: number | null; // 90-day historical price
  inventoryCost: number | null; // Cost from inventory system
}
```

## Technical Details

### Caching Strategy

- **Server-side cache**: 3 hours (pricing data from Amazon)
- **Client-side cache**: Matches server cache duration
- **Manual sync**: Clears cache and fetches fresh data
- **Cache indicator**: Shows data age and "cached" badge

### Amazon Fee Calculation

The profit calculator includes:
- **Referral Fee**: 15% of sale price
- **Digital Services Tax (DST)**: 2% of sale price
- **VAT on Fees**: 20% of (referral + DST)
- **Shipping Cost**: Estimated FBM shipping cost

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/repricing` | GET | Fetch repricing data |
| `/api/repricing` | POST | Trigger manual sync |
| `/api/repricing/[sku]` | PATCH | Push price update |

## Integration Points

- **Amazon SP-API**: Fetches pricing and Buy Box data
- **Amazon Listings API**: Pushes price updates
- **Inventory System**: Pulls cost data for profit calculation
- **Arbitrage Module**: Shares profit calculation logic

## Related Features

- [Amazon Integration](../amazon/overview.md) - Amazon API authentication
- [Arbitrage](../arbitrage/overview.md) - Profit calculation shared logic
- [Platform Stock](../platform-stock/overview.md) - Unified stock view
