# Transactions

## Overview

The Transactions page provides a centralised view of all financial transactions across multiple platforms and payment processors. Track income, expenses, fees, and orders from six different sources in one place.

**Navigation**: Dashboard sidebar → Transactions

## Supported Platforms

| Tab | Source | Transaction Type |
|-----|--------|------------------|
| [Monzo](./monzo.md) | Monzo Bank | Banking transactions (income/expenses) |
| [eBay](./ebay.md) | eBay Finances API | Sales, refunds, fees, payouts |
| [PayPal](./paypal.md) | PayPal API | Payment transactions |
| [BrickLink](./bricklink.md) | BrickLink API | Marketplace orders |
| [BrickOwl](./brickowl.md) | Brick Owl API | Marketplace orders |
| [Amazon](./amazon.md) | Amazon SP-API | Sales, fees, refunds |

## Common Features

### Date Range Filtering

All tabs support date range filtering:

| Preset | Description |
|--------|-------------|
| **All Time** | No date filter (default) |
| **This Month** | Current calendar month |
| **Last Month** | Previous calendar month |
| **Last Quarter** | Previous quarter |
| **Last Year** | Previous full year |

### Search

Text search across transaction fields:
- Descriptions
- Buyer names
- Order IDs
- Item titles

Search is debounced (300ms) to avoid excessive API calls.

### Sorting

Click column headers to sort:
- First click: Sort descending
- Second click: Toggle to ascending
- Third click: Toggle back to descending

Sort indicator shows current direction (↑/↓).

### Pagination

- Default page size: 50 transactions
- Navigate with Previous/Next buttons
- Shows current page and total pages

### Sync Functionality

Each platform has a **Sync** button to pull latest transactions:
- Shows sync status (running/complete)
- Displays last sync time
- Shows count of transactions processed

## Tab-Specific Summaries

Each tab shows relevant summary metrics:

### Monzo
- Total Income
- Total Expenses

### eBay
- Total Sales
- Total Fees
- Total Refunds
- Net Revenue

### PayPal
- Total Fees
- Transaction Count

### BrickLink / BrickOwl
- Total Sales
- Total Shipping
- Total Tax
- Grand Total
- Transaction Count

### Amazon
- Total Sales
- Total Fees
- Total Refunds
- Net Revenue

## Connection Requirements

Each tab requires an active platform connection:
- If not connected, shows connection prompt
- Connection managed via Settings → Integrations
- Some platforms require OAuth authentication

## Use Cases

### Monthly Reconciliation

1. Select "Last Month" date range
2. Check each platform tab
3. Compare summaries with bank statements
4. Export data for accounting

### Fee Analysis

1. Open eBay or Amazon tab
2. Review fee breakdowns
3. Compare fee percentages across platforms
4. Identify fee optimization opportunities

### Income Tracking

1. Open Monzo tab
2. Filter by local category (business income)
3. Review total income for period
4. Cross-reference with platform sales

### Order History

1. Open BrickLink or BrickOwl tab
2. Search for specific buyer or order
3. View order details
4. Check payment and shipping status

## Transaction Details

Click on any transaction to view details:
- Full transaction data
- Fee breakdowns (where applicable)
- Order items (for marketplace orders)
- Edit notes (Monzo only)

## Technical Architecture

### Data Flow

```
Platform API → Sync Service → Database → API Route → UI
```

### Sync Services

| Platform | Service |
|----------|---------|
| Monzo | Monzo Integration API |
| eBay | eBay Finances API |
| PayPal | PayPal Transactions API |
| BrickLink | BrickLink API (OAuth 1.0a) |
| BrickOwl | Brick Owl API |
| Amazon | Amazon SP-API Finances |

### Database Tables

| Table | Content |
|-------|---------|
| `monzo_transactions` | Monzo banking data |
| `ebay_transactions` | eBay financial transactions |
| `paypal_transactions` | PayPal payment data |
| `bricklink_transactions` | BrickLink order data |
| `brickowl_transactions` | Brick Owl order data |
| `amazon_transactions` | Amazon financial data |

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/transactions` | Monzo transactions |
| `GET /api/ebay/transactions` | eBay transactions |
| `GET /api/paypal/transactions` | PayPal transactions |
| `GET /api/bricklink/transactions` | BrickLink transactions |
| `GET /api/brickowl/transactions` | Brick Owl transactions |
| `GET /api/amazon/transactions` | Amazon transactions |

## Related Documentation

- [Reports](../reports/overview.md) - Financial reporting and analytics
- [Orders](../orders/overview.md) - Order management
- [eBay Integration](../ebay/overview.md) - eBay connection setup
- [Amazon Integration](../amazon/overview.md) - Amazon connection setup
