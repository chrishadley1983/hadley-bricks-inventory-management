# eBay Fulfilment & Finances API Integration

*Feature Specification v1.0*

| Field | Value |
|-------|-------|
| Document Version | 1.0 |
| Date | 24 December 2024 |
| Author | Chris Hadley |
| Project | Hadley Bricks Inventory Management System |
| Status | Draft |

---

## 1. Executive Summary

This specification defines the integration of eBay's Fulfilment API and Finances API into the Hadley Bricks inventory management system. The integration will enable automated retrieval of order data for fulfilment workflows and financial transaction data for month-end reconciliation.

### 1.1 Target Use Cases

1. **Daily Picking List Generation** - Generate picking lists from open/unfulfilled eBay orders including item details, SKU, and buyer information

2. **Order History & Inventory Updates** - Mark inventory as sold based on completed orders, capture final selling price, sale date, and all order metadata for analytics

3. **Financial Reconciliation** - Monthly reconciliation of eBay payments, fees, refunds, and payouts against bank transactions

### 1.2 Data Storage Principle

All data retrieved from eBay APIs will be stored in Supabase with full fidelity. The schema is designed to capture complete API responses to maximise future analytical flexibility while preventing duplicate records through appropriate unique constraints.

---

## 2. eBay API Overview

### 2.1 Fulfilment API

The eBay Fulfilment API enables sellers to manage order completion including packaging, addressing, handling, and shipping. Key capabilities include:

- Retrieve orders by creation date, modification date, or fulfilment status
- Access order details including line items, buyer information, shipping addresses
- Track fulfilment status and shipping information
- Historical order retrieval up to 2 years

#### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /order` | Search and retrieve orders with filters (creation date, modification date, status) |
| `GET /order/{orderId}` | Retrieve specific order details including cancellation requests |
| `GET /order/{orderId}/shipping_fulfillment` | Retrieve all shipping fulfilments for an order |

### 2.2 Finances API

The eBay Finances API provides access to seller financial information including payouts, transactions, fees, and refunds. Key capabilities include:

- Retrieve monetary transactions (sales, refunds, credits, transfers)
- Access payout information and bank transfer details
- View fee breakdowns and transaction summaries
- Filter by date range, transaction type, and status

#### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /transaction` | Retrieve monetary transactions with filters |
| `GET /transaction_summary` | Aggregated transaction counts and values |
| `GET /payout` | Retrieve seller payout information |
| `GET /payout/{payoutId}` | Specific payout details |
| `GET /seller_funds_summary` | Funds available but not yet paid out |

---

## 3. Authentication

eBay APIs use OAuth 2.0 with the Authorization Code Grant flow for user-level access. This requires user consent and produces access tokens that must be refreshed periodically.

### 3.1 OAuth Flow

1. User initiates connection via Hadley Bricks UI
2. Application redirects to eBay's Grant Application Access page
3. User logs in and consents to requested scopes
4. eBay redirects back with authorization code
5. Application exchanges code for access token and refresh token
6. Tokens stored securely in Supabase (encrypted)

### 3.2 Required OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `https://api.ebay.com/oauth/api_scope/sell.fulfillment` | Full access to Fulfilment API |
| `https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly` | Read-only order access (alternative) |
| `https://api.ebay.com/oauth/api_scope/sell.finances` | Access to Finances API |

### 3.3 Token Management

- Access tokens expire after 2 hours
- Refresh tokens are long-lived (18 months)
- Implement automatic token refresh before expiry
- Store tokens encrypted in Supabase Vault or equivalent
- Handle token refresh failures gracefully with user notification

### 3.4 EU/UK Digital Signatures

> **Note:** EU and UK Payments regulatory requirements mandate additional security verification via Digital Signatures for Finances API calls made on behalf of EU/UK sellers. Implementation must include signature generation for HTTP payloads.

---

## 4. Database Schema

The following Supabase tables will store eBay data. All tables include appropriate indexes and unique constraints to prevent duplicates while enabling efficient queries.

### 4.1 Authentication Tables

#### ebay_credentials

Stores OAuth credentials and tokens for each user's eBay connection.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK to auth.users |
| ebay_user_id | TEXT | YES | eBay username |
| access_token | TEXT (encrypted) | NO | Current access token |
| refresh_token | TEXT (encrypted) | NO | Refresh token |
| access_token_expires_at | TIMESTAMPTZ | NO | Access token expiry |
| refresh_token_expires_at | TIMESTAMPTZ | NO | Refresh token expiry |
| scopes | TEXT[] | NO | Granted OAuth scopes |
| marketplace_id | TEXT | NO | e.g., EBAY_GB, EBAY_US |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last update time |

### 4.2 Order Tables

#### ebay_orders

Master order table storing core order information.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK to auth.users |
| ebay_order_id | TEXT | NO | eBay order ID (UNIQUE per user) |
| legacy_order_id | TEXT | YES | Legacy format order ID |
| creation_date | TIMESTAMPTZ | NO | Order creation timestamp |
| last_modified_date | TIMESTAMPTZ | NO | Last modification timestamp |
| order_fulfilment_status | TEXT | NO | FULFILLED, IN_PROGRESS, NOT_STARTED |
| order_payment_status | TEXT | NO | PAID, PENDING, FAILED, etc. |
| cancel_status | JSONB | YES | Cancellation state and requests |
| buyer_username | TEXT | NO | Buyer eBay username |
| buyer_checkout_notes | TEXT | YES | Notes from buyer at checkout |
| sales_record_reference | TEXT | YES | Selling Manager reference |
| total_fee_basis_amount | DECIMAL(12,2) | YES | Basis for fee calculation |
| total_fee_basis_currency | TEXT | YES | Currency code (GBP, USD, etc.) |
| pricing_summary | JSONB | YES | Full pricing breakdown |
| payment_summary | JSONB | YES | Payment details including refunds |
| fulfilment_instructions | JSONB | YES | Shipping/fulfilment instructions |
| raw_response | JSONB | NO | Complete API response for audit |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last sync time |

#### ebay_order_line_items

Individual line items within orders - critical for picking lists and inventory matching.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| order_id | UUID | NO | FK to ebay_orders |
| ebay_line_item_id | TEXT | NO | eBay line item ID (UNIQUE) |
| legacy_item_id | TEXT | YES | Legacy format item ID |
| sku | TEXT | YES | Seller's SKU |
| title | TEXT | NO | Item listing title |
| quantity | INTEGER | NO | Quantity ordered |
| line_item_cost_amount | DECIMAL(12,2) | NO | Line item price |
| line_item_cost_currency | TEXT | NO | Currency code |
| total_amount | DECIMAL(12,2) | NO | Total including adjustments |
| total_currency | TEXT | NO | Currency code |
| fulfilment_status | TEXT | NO | FULFILLED, IN_PROGRESS, NOT_STARTED |
| listing_marketplace_id | TEXT | YES | Where item was listed |
| purchase_marketplace_id | TEXT | YES | Where item was purchased |
| item_location | TEXT | YES | Physical item location |
| taxes | JSONB | YES | Tax breakdown |
| properties | JSONB | YES | Item variations/properties |
| raw_response | JSONB | NO | Complete line item data |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last sync time |

#### ebay_shipping_fulfilments

Tracks shipping fulfilments created for orders.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| order_id | UUID | NO | FK to ebay_orders |
| ebay_fulfilment_id | TEXT | NO | eBay fulfilment ID (UNIQUE) |
| shipped_date | TIMESTAMPTZ | YES | When shipped |
| shipping_carrier_code | TEXT | YES | Carrier identifier |
| tracking_number | TEXT | YES | Package tracking number |
| line_items | JSONB | NO | Line items in this fulfilment |
| raw_response | JSONB | NO | Complete API response |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last sync time |

### 4.3 Financial Tables

#### ebay_transactions

Monetary transactions from the Finances API.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK to auth.users |
| ebay_transaction_id | TEXT | NO | eBay transaction ID (UNIQUE) |
| ebay_order_id | TEXT | YES | Associated order ID |
| transaction_type | TEXT | NO | SALE, REFUND, CREDIT, DISPUTE, etc. |
| transaction_status | TEXT | NO | PAYOUT, FUNDS_ON_HOLD, etc. |
| transaction_date | TIMESTAMPTZ | NO | When transaction occurred |
| amount | DECIMAL(12,2) | NO | Transaction amount |
| currency | TEXT | NO | Currency code |
| booking_entry | TEXT | NO | CREDIT or DEBIT |
| payout_id | TEXT | YES | Associated payout ID |
| buyer_username | TEXT | YES | Buyer for this transaction |
| transaction_memo | TEXT | YES | Additional notes/reasons |
| order_line_items | JSONB | YES | Line items and fees breakdown |
| total_fee_amount | DECIMAL(12,2) | YES | Total fees for transaction |
| total_fee_currency | TEXT | YES | Fee currency |
| raw_response | JSONB | NO | Complete API response |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last sync time |

#### ebay_payouts

Bank payout records.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK to auth.users |
| ebay_payout_id | TEXT | NO | eBay payout ID (UNIQUE) |
| payout_status | TEXT | NO | INITIATED, SUCCEEDED, FAILED, etc. |
| payout_date | TIMESTAMPTZ | NO | When payout initiated |
| amount | DECIMAL(12,2) | NO | Payout amount |
| currency | TEXT | NO | Currency code |
| payout_instrument | JSONB | YES | Bank account details (masked) |
| transaction_count | INTEGER | YES | Number of transactions in payout |
| raw_response | JSONB | NO | Complete API response |
| created_at | TIMESTAMPTZ | NO | Record creation time |
| updated_at | TIMESTAMPTZ | NO | Last sync time |

### 4.4 Sync Tracking Table

#### ebay_sync_log

Tracks synchronisation runs for incremental sync and debugging.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK to auth.users |
| sync_type | TEXT | NO | ORDERS, TRANSACTIONS, PAYOUTS |
| status | TEXT | NO | RUNNING, COMPLETED, FAILED |
| started_at | TIMESTAMPTZ | NO | Sync start time |
| completed_at | TIMESTAMPTZ | YES | Sync completion time |
| records_processed | INTEGER | YES | Number of records processed |
| records_created | INTEGER | YES | New records created |
| records_updated | INTEGER | YES | Existing records updated |
| last_sync_cursor | TEXT | YES | Pagination cursor for resume |
| error_message | TEXT | YES | Error details if failed |
| created_at | TIMESTAMPTZ | NO | Record creation time |

---

## 5. Service Layer Architecture

### 5.1 Service Structure

Following the existing Hadley Bricks architecture patterns (Repository, Service, Adapter), the eBay integration will consist of:

#### EbayAuthService

- OAuth flow initiation and callback handling
- Token storage and retrieval
- Automatic token refresh
- Connection status management

#### EbayFulfilmentService

- Order retrieval and sync
- Line item extraction
- Shipping fulfilment tracking
- Picking list generation

#### EbayFinancesService

- Transaction retrieval and sync
- Payout information retrieval
- Fee breakdown analysis
- Reconciliation data preparation

#### EbayApiAdapter

- HTTP client wrapper for eBay REST APIs
- Rate limit handling
- Error transformation
- Request/response logging

### 5.2 Deduplication Strategy

To prevent duplicate records:

1. UNIQUE constraints on eBay IDs (ebay_order_id, ebay_transaction_id, etc.) scoped to user_id
2. UPSERT operations using ON CONFLICT clauses
3. Last modification timestamp comparison before updating
4. Sync log tracking to enable incremental syncs based on modification date

---

## 6. Sync Strategies

### 6.1 Order Sync

- **Initial sync:** Retrieve all orders from last 90 days (API default)
- **Historical sync:** Option to retrieve up to 2 years of history
- **Incremental sync:** Use lastModifiedDate filter for recent changes
- **Frequency:** Manual trigger or scheduled (e.g., every 15 minutes)

### 6.2 Transaction Sync

- **Initial sync:** Retrieve all transactions from last 90 days
- **Incremental sync:** Use transactionDate filter
- **Frequency:** Daily recommended for reconciliation purposes

### 6.3 Payout Sync

- Sync all payouts monthly for reconciliation
- Link transactions to payouts via payout_id

---

## 7. API Rate Limits

eBay enforces daily call limits based on application compatibility level. Implementation must include:

- Rate limit tracking per API
- Exponential backoff on 429 responses
- Batch requests where possible
- Pagination handling with appropriate delays

---

## 8. Error Handling

### 8.1 Expected Errors

| HTTP Code | Scenario | Handling |
|-----------|----------|----------|
| 401 | Token expired | Trigger automatic token refresh |
| 403 | Insufficient scopes | Prompt user to re-authorise with required scopes |
| 429 | Rate limited | Exponential backoff, retry after delay |
| 500+ | eBay server error | Log error, retry with backoff, notify user after 3 failures |

---

## 9. Implementation Phases

### Phase 1: Foundation

1. Create Supabase database schema (all tables)
2. Implement EbayAuthService with OAuth flow
3. Build EbayApiAdapter with rate limiting
4. Create connection UI in Hadley Bricks settings

### Phase 2: Fulfilment API Integration

1. Implement EbayFulfilmentService
2. Build order sync functionality
3. Create ebay_orders and ebay_order_line_items repositories
4. Build basic order listing UI

### Phase 3: Finances API Integration

1. Implement EbayFinancesService
2. Build transaction and payout sync functionality
3. Create financial repositories
4. Build financial data display UI

---

## 10. Testing Requirements

### 10.1 Unit Tests

- Token refresh logic
- Data transformation functions
- Deduplication logic
- Error handling

### 10.2 Integration Tests

- OAuth flow (using eBay Sandbox)
- API calls with mock responses
- Database operations (upsert, unique constraints)

### 10.3 eBay Sandbox

eBay provides a Sandbox environment for testing. All development should be tested against Sandbox before Production deployment.

---

## 11. Future Considerations (Out of Scope)

The following are explicitly out of scope for this phase but the data model supports future implementation:

- Automated picking list PDF generation
- Inventory quantity adjustment based on sales
- Profit/loss calculation per item
- eBay listing management (Inventory API integration)
- Automated repricing
- Multi-user/multi-marketplace support

---

## Appendix A: eBay Developer Registration

To use eBay APIs, register at the eBay Developer Program:

- **URL:** https://developer.ebay.com/
- Create an application keyset
- Configure RuName (Redirect URL) for OAuth callback
- Request Production access after Sandbox testing

---

## Appendix B: Key API Documentation Links

- **Fulfilment API:** https://developer.ebay.com/api-docs/sell/fulfillment/overview.html
- **Finances API:** https://developer.ebay.com/api-docs/sell/finances/overview.html
- **OAuth Guide:** https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
- **Digital Signatures (EU/UK):** https://developer.ebay.com/api-docs/static/oauth-digital-signatures.html
