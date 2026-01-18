# Set Lookup

> Look up LEGO set information with cross-platform pricing comparison.

## Purpose

The Set Lookup feature provides comprehensive information about any LEGO set by querying the Brickset database and aggregating pricing data from multiple selling platforms. This helps you:

- Research sets before purchasing for resale
- Compare current market prices across platforms
- Check your inventory stock for a specific set
- View eBay and Amazon listings for a set

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Set Information** | Pieces, minifigs, year, theme, ratings |
| **Product Identifiers** | Set number, EAN, UPC, item numbers |
| **Amazon Pricing** | Buy Box, lowest price, was price, offers |
| **eBay Pricing** | Min/avg/max for new and used |
| **BrickLink Pricing** | Min/avg/max for new and used |
| **Inventory Stock** | Your current stock of this set |
| **Recent Lookups** | Quick access to recently searched sets |

## User Journeys

1. [Looking Up a Set](./looking-up-set.md) - Search and view set details
2. [Viewing Pricing](./viewing-pricing.md) - Compare prices across platforms
3. [Checking Inventory](./checking-inventory.md) - See your stock of this set

## Page Layout

### Configuration Alert
If Brickset API is not configured, shows warning with link to settings.

### Search Form
- Set number input (e.g., "75192" or "75192-1")
- Force refresh checkbox to bypass cache
- Look Up button

### Results Card
- Set image and basic info
- Product identifiers (EAN, UPC)
- Platform pricing comparison
- Community stats

### Inventory Stock Card
- Current stock count
- Sold stock count
- Click to view details

### Recent Lookups
- Last 5 searched sets
- Click to re-search

## Feature Components

### Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `SetLookupForm` | Search input form | [SetLookupForm.tsx](../../../apps/web/src/components/features/brickset/SetLookupForm.tsx) |
| `SetDetailsCard` | Set info and pricing | [SetDetailsCard.tsx](../../../apps/web/src/components/features/brickset/SetDetailsCard.tsx) |
| `SetStockCard` | Inventory stock summary | [SetStockCard.tsx](../../../apps/web/src/components/features/brickset/SetStockCard.tsx) |
| `SetStockModal` | Detailed stock view | [SetStockModal.tsx](../../../apps/web/src/components/features/brickset/SetStockModal.tsx) |
| `SetLookupEbayModal` | eBay listings viewer | [SetLookupEbayModal.tsx](../../../apps/web/src/components/features/brickset/SetLookupEbayModal.tsx) |
| `AmazonOffersModal` | Amazon offers viewer | [AmazonOffersModal.tsx](../../../apps/web/src/components/features/brickset/AmazonOffersModal.tsx) |

## Data Model

### BricksetSet

```typescript
interface BricksetSet {
  id: string;
  setNumber: string;
  setName: string;
  theme: string | null;
  subtheme: string | null;
  yearFrom: number | null;
  pieces: number | null;
  minifigs: number | null;
  imageUrl: string | null;
  ean: string | null;
  upc: string | null;
  ukRetailPrice: number | null;
  launchDate: string | null;
  exitDate: string | null;
  rating: number | null;
  ownCount: number | null;
  wantCount: number | null;
  availability: string | null;
  released: boolean;
  lastFetchedAt: string | null;
}
```

### SetPricingData

```typescript
interface SetPricingData {
  amazon: {
    buyBoxPrice: number | null;
    lowestPrice: number | null;
    wasPrice: number | null;
    offerCount: number;
    asin: string | null;
    offers: AmazonOfferData[];
  } | null;
  ebay: PricingStats | null;
  ebayUsed: PricingStats | null;
  bricklink: BrickLinkPricingStats | null;
  bricklinkUsed: BrickLinkPricingStats | null;
}
```

## Technical Details

### Data Sources

| Platform | API | Data Retrieved |
|----------|-----|----------------|
| Brickset | Brickset API | Set details, identifiers |
| Amazon | SP-API | Buy Box, offers, was price |
| eBay | Finding API | Active listings, prices |
| BrickLink | BrickLink API | Price guide data |

### Caching Strategy

- **Brickset Data**: Cached in database, refreshable
- **Pricing Data**: 5-minute client cache
- **Stock Data**: 1-minute client cache

### Force Refresh
- Checkbox to bypass cache
- Fetches fresh data from Brickset API
- Requires configured API key

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/brickset/lookup` | GET | Look up set by number |
| `/api/brickset/search` | GET | Search cached sets |
| `/api/brickset/pricing` | GET | Fetch multi-platform pricing |
| `/api/brickset/inventory-stock` | GET | Check inventory stock |
| `/api/integrations/brickset/credentials` | GET | Check API configuration |

## Integration Points

- **Brickset API**: Set database queries
- **Amazon SP-API**: Pricing and offers
- **eBay Finding API**: Active listings search
- **BrickLink API**: Price guide data
- **Inventory System**: Stock lookup by set number

## Related Features

- [Inventory](../inventory/overview.md) - Your stock management
- [Arbitrage](../arbitrage/overview.md) - Profit opportunity discovery
- [Purchase Evaluator](../purchase-evaluator/overview.md) - Evaluate potential purchases
