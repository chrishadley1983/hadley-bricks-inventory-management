# eBay Integration Feature Overview

> **Feature Area:** eBay Integration
> **Status:** Core Feature
> **Complexity:** High

## Purpose

The eBay Integration provides comprehensive connectivity with the eBay marketplace, enabling stock management, listing creation, listing optimisation, transaction synchronisation, and order management. The integration uses OAuth 2.0 for authentication and supports both the Trading API and modern REST APIs.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **OAuth 2.0 Authentication** | Secure connection via Authorization Code Grant flow with automatic token refresh |
| **Stock Management** | View and manage eBay listings, sync stock levels, and track inventory |
| **Listing Creation** | AI-powered 9-step listing creation with Brickset research integration |
| **Listing Optimiser** | Gemini-powered analysis and optimisation of existing listings |
| **Transaction Sync** | Financial transaction and payout synchronisation from eBay Finances API |
| **Price Updates** | Inline price editing with Best Offer threshold adjustments |
| **SKU Matching** | Link eBay items to inventory via SKU mapping |
| **Order Sync** | Import and track eBay orders with fulfilment status |

## Data Model

### eBay Credentials

```typescript
interface EbayCredentials {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  scopes: string[];
  marketplace_id: EbayMarketplaceId;  // e.g., 'EBAY_GB'
  ebay_user_id: string | null;
  created_at: string;
  updated_at: string;
}
```

### Platform Listing (eBay)

```typescript
interface PlatformListing {
  id: string;
  user_id: string;
  platform: 'ebay';
  platform_item_id: string;      // eBay Item ID
  platform_sku: string | null;   // Custom Label / SKU
  title: string | null;
  price: number | null;
  currency: string;
  quantity: number;
  listing_status: ListingStatus;
  last_reviewed_at: string | null;
  quality_score: number | null;
  quality_grade: string | null;
  ebay_data: EbayListingData;    // Raw eBay data
  created_at: string;
  updated_at: string;
}

type ListingStatus = 'Active' | 'Inactive' | 'Incomplete' | 'Out of Stock';
```

### eBay Transaction

```typescript
interface EbayTransaction {
  id: string;
  user_id: string;
  ebay_transaction_id: string;
  ebay_order_id: string | null;
  transaction_type: string;
  transaction_status: string;
  transaction_date: string;
  amount: number;
  currency: string;
  booking_entry: 'CREDIT' | 'DEBIT';
  payout_id: string | null;
  buyer_username: string | null;
  total_fee_amount: number | null;
  final_value_fee_fixed: number | null;
  final_value_fee_variable: number | null;
  regulatory_operating_fee: number | null;
  international_fee: number | null;
  ad_fee: number | null;
  gross_transaction_amount: number | null;
}
```

### Listing Quality Review

```typescript
interface ListingQualityReview {
  id: string;
  user_id: string;
  ebay_listing_id: string;
  quality_score: number;          // 0-100
  quality_grade: QualityGrade;    // A+, A, B, C, D, F
  breakdown: CategoryBreakdown;   // Scores per category
  suggestions: ListingSuggestion[];
  pricing_analysis: PricingAnalysis;
  reviewed_at: string;
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│   API Routes    │────▶│  eBay Services  │
│   (TanStack Q)  │     │   /api/ebay-*   │     └─────────────────┘
└─────────────────┘     └─────────────────┘              │
                                                         ▼
                               ┌────────────────┬────────┴────────┬─────────────────┐
                               ▼                ▼                 ▼                 ▼
                        ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
                        │  Auth     │    │ Trading   │    │ Finances  │    │ Inventory │
                        │  Service  │    │   API     │    │   API     │    │   API     │
                        └───────────┘    └───────────┘    └───────────┘    └───────────┘
```

### Service Layer

**EbayAuthService** - OAuth 2.0 authentication management:
```typescript
class EbayAuthService {
  getAuthorizationUrl(userId, returnUrl?, marketplaceId?): string;
  handleCallback(code, state): Promise<{ success, error?, returnUrl? }>;
  getAccessToken(userId): Promise<string | null>;
  refreshAccessToken(userId, refreshToken): Promise<EbayCredentials | null>;
  getConnectionStatus(userId): Promise<EbayConnectionStatus>;
  hasListingManagementScopes(userId): Promise<{ hasScopes, missingScopes }>;
  disconnect(userId): Promise<void>;
}
```

**ListingCreationService** - 9-step listing creation orchestration:
```typescript
class ListingCreationService {
  createListing(request, onProgress): Promise<ListingCreationResult | ListingCreationError>;
  // Steps: validate → research → policies → generate → images → create → update → audit → review
}
```

**ListingOptimiserService** - AI-powered listing analysis:
```typescript
class ListingOptimiserService {
  getListings(userId, filters?): Promise<{ listings, summary }>;
  analyseListing(userId, itemId, onProgress?): Promise<FullAnalysisResult>;
  applyChange(userId, itemId, suggestion): Promise<ReviseItemResult>;
}
```

**EbayTransactionSyncService** - Financial data synchronisation:
```typescript
class EbayTransactionSyncService {
  syncTransactions(userId, options?): Promise<EbaySyncResult>;
  syncPayouts(userId, options?): Promise<EbaySyncResult>;
  performHistoricalImport(userId, fromDate): Promise<{ transactions, payouts }>;
  getSyncStatus(userId): Promise<SyncStatus>;
}
```

## User Journeys

| Journey | Description |
|---------|-------------|
| [eBay Authentication](./ebay-authentication.md) | Connect/disconnect eBay account via OAuth |
| [eBay Stock Management](./ebay-stock-management.md) | View listings, sync stock, update prices |
| [Listing Creation](./listing-creation.md) | AI-powered listing creation from inventory |
| [Listing Optimiser](./listing-optimiser.md) | Analyse and improve existing listings |
| [eBay Transaction Sync](./ebay-transaction-sync.md) | Sync financial transactions and payouts |

## Business Rules

### OAuth Scopes

Required scopes for full functionality:

| Scope | Purpose |
|-------|---------|
| `sell.fulfillment.readonly` | Read order data |
| `sell.finances` | Access financial transactions |
| `sell.inventory` | Create and manage listings |
| `sell.account` | Access business policies |
| `sell.analytics.readonly` | Access traffic/views data |

### Token Management

- Access tokens expire after ~2 hours
- Automatic refresh 10 minutes before expiry
- Refresh tokens last ~18 months
- Invalid refresh token triggers disconnect

### Listing Creation Steps

1. **Validate** - Check inventory item exists and is eligible
2. **Research** - Query Brickset API for product details (AI fallback)
3. **Policies** - Get eBay business policies (payment, shipping, return)
4. **Generate** - AI content generation (Claude Opus 4.5)
5. **Images** - Upload images to storage
6. **Create** - eBay Inventory API calls (create item, offer, publish)
7. **Update** - Mark inventory as Listed
8. **Audit** - Record audit trail
9. **Review** - Quality review (Gemini 3 Pro, async)

### Listing Quality Grades

| Grade | Score Range | Description |
|-------|-------------|-------------|
| A+ | 95-100 | Excellent, no issues |
| A | 85-94 | Very good, minor improvements |
| B | 75-84 | Good, some opportunities |
| C | 60-74 | Needs improvement |
| D | 40-59 | Poor, significant issues |
| F | 0-39 | Critical issues |

### Transaction Sync Modes

| Mode | Description |
|------|-------------|
| INCREMENTAL | Sync from last cursor position |
| FULL | Sync all transactions (no date filter) |
| HISTORICAL | Import specific date range |

## Integration Points

### eBay APIs Used

| API | Purpose |
|-----|---------|
| Auth API | OAuth 2.0 token exchange |
| Trading API | GetItem, ReviseFixedPriceItem |
| Inventory API | Create/update inventory items and offers |
| Finances API | Transactions and payouts |
| Finding API | Competitor pricing analysis |
| Analytics API | Traffic/views data |

### AI Integration

| AI Service | Model | Purpose |
|------------|-------|---------|
| Claude | claude-opus-4-5-20251101 | Listing content generation |
| Claude | claude-sonnet-4-20250514 | Research data fallback |
| Gemini | gemini-3-pro-preview | Listing quality analysis |

### Internal Integration

- **Inventory** - Link listings to inventory items via SKU
- **Orders** - eBay orders sync to `ebay_orders` table
- **Transactions** - Financial data for reporting
- **Reports** - Transaction data feeds profit calculations

## Source Files

| File | Purpose |
|------|---------|
| [ebay-auth.service.ts](apps/web/src/lib/ebay/ebay-auth.service.ts) | OAuth 2.0 authentication |
| [ebay-api.adapter.ts](apps/web/src/lib/ebay/ebay-api.adapter.ts) | API request adapter |
| [listing-creation.service.ts](apps/web/src/lib/ebay/listing-creation.service.ts) | Listing creation orchestration |
| [listing-optimiser.service.ts](apps/web/src/lib/ebay/listing-optimiser.service.ts) | Listing analysis |
| [ebay-transaction-sync.service.ts](apps/web/src/lib/ebay/ebay-transaction-sync.service.ts) | Transaction synchronisation |
| [ebay-trading.client.ts](apps/web/src/lib/platform-stock/ebay/ebay-trading.client.ts) | Trading API client |
| [ebay-stock/page.tsx](apps/web/src/app/(dashboard)/ebay-stock/page.tsx) | eBay stock page |
| [listing-optimiser/page.tsx](apps/web/src/app/(dashboard)/listing-optimiser/page.tsx) | Optimiser page |
| [EbayListingsView.tsx](apps/web/src/components/features/ebay-stock/EbayListingsView.tsx) | Listings view component |

## Related Features

- **Inventory** - Listings link to inventory items for cost tracking
- **Orders** - eBay orders integrate with unified order management
- **Reports** - Transaction data feeds into financial reports
- **Transactions** - eBay payouts appear in transaction ledger
