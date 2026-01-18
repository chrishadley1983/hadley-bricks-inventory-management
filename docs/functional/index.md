# Hadley Bricks — Functional Documentation

> Auto-generated documentation of application features and capabilities.
> Run `/docs discover` to scan for features or `/docs status` to check coverage.

## Coverage

| Feature Area | Coverage | Last Updated | Status |
|--------------|----------|--------------|--------|
| [Inventory](./inventory/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Purchases](./purchases/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Orders](./orders/overview.md) | 100% | 2026-01-18 | 🟢 |
| [eBay Integration](./ebay/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Amazon Integration](./amazon/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Listing Assistant](./listing-assistant/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Listing Optimiser](./listing-optimiser/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Purchase Evaluator](./purchase-evaluator/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Reports](./reports/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Transactions](./transactions/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Arbitrage Tracker](./arbitrage/overview.md) | 100% | 2026-01-18 | 🟢 |
| [BrickLink](./bricklink/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Brick Owl](./brickowl/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Dashboard](./dashboard/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Data Sync](./sync/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Authentication](./authentication/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Repricing](./repricing/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Platform Stock](./platform-stock/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Set Lookup](./set-lookup/overview.md) | 100% | 2026-01-18 | 🟢 |
| [Settings](./settings/overview.md) | 100% | 2026-01-18 | 🟢 |

**Overall Progress:** ████████████████████ 100%

---

## Documented Features

### Inventory Management

Core feature for tracking all LEGO inventory items through their lifecycle.

**Overview:** [inventory/overview.md](./inventory/overview.md)

| Journey | Description |
|---------|-------------|
| [Viewing Inventory](./inventory/viewing-inventory.md) | Browse, search, and filter inventory items |
| [Adding Inventory](./inventory/adding-inventory.md) | Multiple methods: Single, Natural Language, Photo, CSV, Bulk |
| [Bulk Operations](./inventory/bulk-operations.md) | Edit or delete multiple items at once |
| [eBay Integration](./inventory/ebay-integration.md) | Create eBay listings from inventory items |

**Key Capabilities:**
- Item tracking with statuses: Not Yet Received → Backlog → Listed → Sold
- Multi-platform support: eBay, Amazon, BrickLink, Brick Owl
- AI-powered natural language input and photo parsing
- Advanced filtering with numeric ranges, dates, and empty/not-empty checks
- Automatic SKU generation
- Bulk edit and delete operations
- Direct eBay listing creation with AI-generated content

---

### Purchases

Track all buying activities for the LEGO resale business with expense tracking.

**Overview:** [purchases/overview.md](./purchases/overview.md)

| Journey | Description |
|---------|-------------|
| [Viewing Purchases](./purchases/viewing-purchases.md) | Browse, search, and filter purchase history |
| [Adding Purchases](./purchases/adding-purchases.md) | Multiple methods: Quick Add (AI), Full Form |
| [Mileage Tracking](./purchases/mileage-tracking.md) | Track travel costs with automatic distance calculation |

**Key Capabilities:**
- Purchase recording with cost, source, payment method
- AI-powered quick add with natural language parsing
- Mileage tracking with automatic distance calculation (45p/mile default)
- Expense tracking: parking, tolls, and other costs
- Inventory linking for profit calculation
- Image attachments for receipts and documentation
- Bulk operations for mass updates

---

### Orders

Centralised order management across all connected sales platforms.

**Overview:** [orders/overview.md](./orders/overview.md)

| Journey | Description |
|---------|-------------|
| [Viewing Orders](./orders/viewing-orders.md) | Browse orders from all platforms with filtering |
| [eBay Orders](./orders/ebay-orders.md) | Manage eBay orders with SKU matching |
| [Amazon Orders](./orders/amazon-orders.md) | Manage Amazon orders with ASIN matching |
| [Order Confirmation](./orders/order-confirmation.md) | Bulk confirm and link to inventory |

**Key Capabilities:**
- Multi-platform sync: eBay, Amazon, Bricqer, BrickLink, Brick Owl
- Status workflow: Pending → Paid → Packed → Shipped → Completed
- SKU/ASIN matching with FIFO inventory recommendations
- Picking list PDF generation
- Bulk order confirmation with inventory linking
- Platform-specific views with dedicated features

---

### eBay Integration

Comprehensive eBay marketplace connectivity with OAuth 2.0 authentication, stock management, AI-powered listing creation, listing optimisation, and financial transaction synchronisation.

**Overview:** [ebay/overview.md](./ebay/overview.md)

| Journey | Description |
|---------|-------------|
| [eBay Authentication](./ebay/ebay-authentication.md) | Connect/disconnect eBay account via OAuth 2.0 |
| [eBay Stock Management](./ebay/ebay-stock-management.md) | View listings, sync stock, update prices |
| [Listing Creation](./ebay/listing-creation.md) | AI-powered 9-step listing creation |
| [Listing Optimiser](./ebay/listing-optimiser.md) | Analyse and improve listings with Gemini AI |
| [eBay Transaction Sync](./ebay/ebay-transaction-sync.md) | Sync financial transactions and payouts |

**Key Capabilities:**
- OAuth 2.0 authentication with automatic token refresh
- Stock management with inline price editing and Best Offer thresholds
- AI-powered listing creation using Claude Opus 4.5 with Brickset research
- Gemini 3 Pro listing analysis with one-click improvement application
- Transaction and payout sync from eBay Finances API
- SKU-to-inventory matching and quality scoring

---

### Amazon Integration

Full Amazon SP-API integration for syncing prices, quantities, orders, and financial transactions.

**Overview:** [amazon/overview.md](./amazon/overview.md)

| Journey | Description |
|---------|-------------|
| [Sync Queue Management](./amazon/sync-queue.md) | Queue items, validate, submit feeds to Amazon |
| [Order Sync](./amazon/order-sync.md) | Import and sync orders from Amazon |
| [Transaction Sync](./amazon/transaction-sync.md) | Import financial transactions for reconciliation |

**Key Capabilities:**
- Sync queue with live price conflict detection
- JSON Listings Feed submission with validation
- Two-phase sync: price first, verify, then quantity
- Order sync with incremental updates
- Transaction sync with fee breakdown extraction
- Support for EU marketplaces (UK, DE, FR, IT, ES)

---

### Listing Assistant

AI-powered tool for creating professional eBay listings with templates, image optimization, and bulk listing refresh.

**Overview:** [listing-assistant/overview.md](./listing-assistant/overview.md)

| Journey | Description |
|---------|-------------|
| [AI Generator](./listing-assistant/generator.md) | Create listings using Claude AI with price research |
| [Templates](./listing-assistant/templates.md) | Manage reusable HTML templates |
| [Image Studio](./listing-assistant/image-studio.md) | Optimize photos with one-click eBay preset |
| [Listing Refresh](./listing-assistant/listing-refresh.md) | Refresh old listings to boost visibility |

**Key Capabilities:**
- Claude AI listing generation with Brickset research
- eBay sold item price research
- Customizable HTML templates with placeholders
- Image processing with brightness, contrast, sharpness controls
- One-click eBay photo optimization
- AI image analysis for alt text and defect detection
- Bulk listing refresh for 90+ day old listings
- Review or immediate processing modes

---

### Listing Optimiser

AI-powered listing analysis and buyer negotiation tools for improving eBay sales performance.

**Overview:** [listing-optimiser/overview.md](./listing-optimiser/overview.md)

| Journey | Description |
|---------|-------------|
| [AI Analysis](./ebay/listing-optimiser.md) | Analyse listings with Gemini Pro, get improvement suggestions |
| [Buyer Negotiation](./listing-optimiser/buyer-negotiation.md) | Send targeted discount offers to interested buyers |

**Key Capabilities:**
- Gemini 3 Pro listing analysis with quality grading (A+ to F)
- Scoring across 5 categories: Title, Item Specifics, Description, Condition, SEO
- One-click suggestion application to eBay
- Buyer negotiation with discount rules
- Automated offer sending at optimal times (8am, 12pm, 4pm, 8pm)
- Performance metrics dashboard

---

### Purchase Evaluator

Decision-support tool for evaluating potential LEGO purchases before buying, with AI-powered photo analysis.

**Overview:** [purchase-evaluator/overview.md](./purchase-evaluator/overview.md)

| Journey | Description |
|---------|-------------|
| [Creating an Evaluation](./purchase-evaluator/creating-evaluation.md) | Start evaluation with text or photos |
| [Photo Analysis](./purchase-evaluator/photo-analysis.md) | AI-powered item identification |
| [Converting to Purchase](./purchase-evaluator/conversion.md) | Convert evaluation to purchase + inventory |

**Key Capabilities:**
- Two modes: Cost Known (profitability) and Max Bid (calculate max price)
- AI photo analysis with Gemini Pro and Claude Opus
- Smart image chunking for group shots
- Auction mode with commission/shipping calculations
- Amazon and eBay price lookups
- ASIN matching with alternatives
- Direct conversion to purchase and inventory records

---

### Reports

Comprehensive financial and operational analytics with six specialized reports.

**Overview:** [reports/overview.md](./reports/overview.md)

| Journey | Description |
|---------|-------------|
| [Profit & Loss](./reports/profit-loss.md) | Monthly income, expenses, and profitability |
| [Inventory Valuation](./reports/inventory-valuation.md) | Current stock value at cost and sale price |
| [Inventory Aging](./reports/inventory-aging.md) | Stock age distribution and slow-moving items |
| [Platform Performance](./reports/platform-performance.md) | Sales comparison across platforms |
| [Purchase Analysis](./reports/purchase-analysis.md) | ROI tracking per purchase with mileage |
| [Daily Activity](./reports/daily-activity.md) | Daily listing and sales tracking |

**Key Capabilities:**
- Date range presets with custom date selection
- Export to CSV and JSON formats
- Interactive charts (Bar, Pie, Combo)
- Store status tracking (Open/Closed/Holiday)
- Category-level expense breakdowns
- Age bracket analysis with drill-down
- Platform fee comparison
- Mileage cost calculation at HMRC rates

---

### Transactions

Centralised view of financial transactions across all platforms and payment processors.

**Overview:** [transactions/overview.md](./transactions/overview.md)

| Journey | Description |
|---------|-------------|
| [Monzo](./transactions/monzo.md) | Bank transactions with categorisation |
| [eBay](./transactions/ebay.md) | Sales, fees, refunds, and payouts |
| [PayPal](./transactions/paypal.md) | Payment processor transactions |
| [BrickLink](./transactions/bricklink.md) | Marketplace order transactions |
| [BrickOwl](./transactions/brickowl.md) | Marketplace order transactions |
| [Amazon](./transactions/amazon.md) | Sales, fees, and refunds |

**Key Capabilities:**
- Six platform tabs: Monzo, eBay, PayPal, BrickLink, BrickOwl, Amazon
- Date range filtering with presets
- Search and sort across all fields
- Sync functionality per platform
- Summary metrics: sales, fees, refunds, net revenue
- Transaction detail views with fee breakdowns
- Monzo local categorisation for bookkeeping

---

### Arbitrage Tracker

Sophisticated price comparison system for identifying profitable buying opportunities across Amazon, BrickLink, and eBay.

**Overview:** [arbitrage/overview.md](./arbitrage/overview.md)

| Journey | Description |
|---------|-------------|
| [Amazon Arbitrage](./arbitrage/amazon-arbitrage.md) | Compare Amazon selling vs BrickLink sourcing prices |
| [eBay Arbitrage](./arbitrage/ebay-arbitrage.md) | Compare Amazon selling vs eBay sourcing prices |
| [Seeded ASINs](./arbitrage/seeded-asins.md) | Discover ASINs from Brickset database for tracking |

**Key Capabilities:**
- Multi-source ASIN tracking: inventory, seeded, manual
- Intelligent ASIN-to-BrickLink mapping via EAN/UPC/title matching
- Match confidence scoring: 100% (EAN) to 60% (fuzzy title)
- Amazon FBM profit calculation with 18.36% effective fee rate
- Seeded ASIN discovery from 18,000+ Brickset sets
- eBay listing management with individual listing exclusions
- Configurable margin threshold (default 30%)
- Rate-limited API calls with progress tracking

---

### BrickLink Integration

Connect your BrickLink store to sync orders, track uploads, and access price guide data.

**Overview:** [bricklink/overview.md](./bricklink/overview.md)

| Journey | Description |
|---------|-------------|
| [BrickLink Authentication](./bricklink/bricklink-authentication.md) | Connect BrickLink via OAuth 1.0a |
| [BrickLink Uploads](./bricklink/bricklink-uploads.md) | Track inventory batches uploaded to stores |
| [Order Sync](./bricklink/order-sync.md) | Synchronize sales orders from BrickLink |

**Key Capabilities:**
- OAuth 1.0a authentication with four credentials
- Intelligent incremental order sync (only changed orders)
- Upload batch tracking with margin calculation
- Bricqer inventory integration
- Transaction synchronization
- Price guide access for arbitrage

---

### Brick Owl Integration

Connect your Brick Owl store to sync orders and track transactions with simple API key authentication.

**Overview:** [brickowl/overview.md](./brickowl/overview.md)

| Journey | Description |
|---------|-------------|
| [Brick Owl Authentication](./brickowl/brickowl-authentication.md) | Connect Brick Owl via API key |
| [Order Sync](./brickowl/order-sync.md) | Synchronize orders and transactions |

**Key Capabilities:**
- Simple API key authentication (no OAuth)
- Generous rate limits (10,000 requests/day)
- Incremental, full, and historical sync modes
- Transaction tracking with full financial breakdown
- Auto-sync with configurable intervals
- Batch processing for efficient database operations

---

### Dashboard

The home page providing an at-a-glance view of business health with financial metrics, inventory status, and listing performance targets.

**Overview:** [dashboard/overview.md](./dashboard/overview.md)

**Key Capabilities:**
- Rolling 12-month revenue and monthly profit tracking
- Daily/weekly listing value targets vs actuals
- Inventory breakdown by status with cost and value
- Bricqer parts inventory integration
- Actionable alerts for pending items
- Recent inventory activity feed
- Platform and sold/unsold filtering

---

### Data Sync

System for synchronizing data between external sources (Google Sheets, Monzo, PayPal) and the Supabase database with visual status indicators.

**Overview:** [sync/overview.md](./sync/overview.md)

**Key Capabilities:**
- Visual sync status indicators (synced, syncing, stale, error)
- Legacy Google Sheets sync (preserved for one-time imports)
- Monzo auto-sync on 1-hour interval
- PayPal sync with incremental, full, and historical modes
- Centralized Zustand state management
- Staleness detection with 5-minute TTL

---

## User Journeys

### Inventory
- [Viewing Inventory](./inventory/viewing-inventory.md) — Browse, search, and filter items
- [Adding Inventory](./inventory/adding-inventory.md) — Multiple input methods
- [Bulk Operations](./inventory/bulk-operations.md) — Mass edit/delete
- [eBay Integration](./inventory/ebay-integration.md) — Create listings

### Purchases
- [Viewing Purchases](./purchases/viewing-purchases.md) — Browse, search, and filter purchases
- [Adding Purchases](./purchases/adding-purchases.md) — Quick add and full form
- [Mileage Tracking](./purchases/mileage-tracking.md) — Travel cost tracking

### Orders
- [Viewing Orders](./orders/viewing-orders.md) — Browse orders from all platforms
- [eBay Orders](./orders/ebay-orders.md) — Manage eBay orders with SKU matching
- [Amazon Orders](./orders/amazon-orders.md) — Manage Amazon orders with ASIN matching
- [Order Confirmation](./orders/order-confirmation.md) — Confirm orders and link inventory

### eBay Integration
- [eBay Authentication](./ebay/ebay-authentication.md) — Connect/disconnect eBay account
- [eBay Stock Management](./ebay/ebay-stock-management.md) — View and manage listings
- [Listing Creation](./ebay/listing-creation.md) — AI-powered listing creation
- [Listing Optimiser](./ebay/listing-optimiser.md) — Analyse and improve listings
- [eBay Transaction Sync](./ebay/ebay-transaction-sync.md) — Sync financial data

### Amazon Integration
- [Sync Queue Management](./amazon/sync-queue.md) — Queue and submit price/quantity updates
- [Order Sync](./amazon/order-sync.md) — Import orders from Amazon
- [Transaction Sync](./amazon/transaction-sync.md) — Import financial transactions

### Listing Assistant
- [AI Generator](./listing-assistant/generator.md) — Create listings with Claude AI
- [Templates](./listing-assistant/templates.md) — Manage HTML templates
- [Image Studio](./listing-assistant/image-studio.md) — Optimize product photos
- [Listing Refresh](./listing-assistant/listing-refresh.md) — Boost old listing visibility

### Listing Optimiser
- [AI Analysis](./ebay/listing-optimiser.md) — Gemini-powered listing scoring
- [Buyer Negotiation](./listing-optimiser/buyer-negotiation.md) — Send discount offers

### Purchase Evaluator
- [Creating an Evaluation](./purchase-evaluator/creating-evaluation.md) — Text or photo input
- [Photo Analysis](./purchase-evaluator/photo-analysis.md) — AI item identification
- [Converting to Purchase](./purchase-evaluator/conversion.md) — Create purchase and inventory

### Reports
- [Profit & Loss](./reports/profit-loss.md) — Monthly P&L with categories
- [Inventory Valuation](./reports/inventory-valuation.md) — Stock value assessment
- [Inventory Aging](./reports/inventory-aging.md) — Age distribution analysis
- [Platform Performance](./reports/platform-performance.md) — Multi-platform comparison
- [Purchase Analysis](./reports/purchase-analysis.md) — ROI tracking with mileage
- [Daily Activity](./reports/daily-activity.md) — Daily operations tracking

### Transactions
- [Monzo](./transactions/monzo.md) — Bank transactions and categorisation
- [eBay](./transactions/ebay.md) — Sales, fees, refunds, payouts
- [PayPal](./transactions/paypal.md) — Payment transactions
- [BrickLink](./transactions/bricklink.md) — Marketplace orders
- [BrickOwl](./transactions/brickowl.md) — Marketplace orders
- [Amazon](./transactions/amazon.md) — Sales, fees, refunds

### Arbitrage Tracker
- [Amazon Arbitrage](./arbitrage/amazon-arbitrage.md) — Compare Amazon vs BrickLink prices
- [eBay Arbitrage](./arbitrage/ebay-arbitrage.md) — Compare Amazon vs eBay prices
- [Seeded ASINs](./arbitrage/seeded-asins.md) — Discover ASINs from Brickset database

### BrickLink Integration
- [BrickLink Authentication](./bricklink/bricklink-authentication.md) — Connect BrickLink account
- [BrickLink Uploads](./bricklink/bricklink-uploads.md) — Track inventory batches
- [Order Sync](./bricklink/order-sync.md) — Sync sales orders

### Brick Owl Integration
- [Brick Owl Authentication](./brickowl/brickowl-authentication.md) — Connect Brick Owl account
- [Order Sync](./brickowl/order-sync.md) — Sync orders and transactions

### Repricing
- [Viewing Repricing Data](./repricing/viewing-repricing.md) — Browse Amazon listings with Buy Box comparison
- [Editing Prices](./repricing/editing-prices.md) — Change prices and push to Amazon
- [Profit Analysis](./repricing/profit-analysis.md) — Understand profit margins per listing

### Platform Stock
- [Viewing Listings](./platform-stock/viewing-listings.md) — Browse Amazon listings
- [Comparing Stock](./platform-stock/comparing-stock.md) — Find inventory discrepancies
- [Importing Listings](./platform-stock/importing-listings.md) — Refresh data from Amazon

### Set Lookup
- [Looking Up a Set](./set-lookup/looking-up-set.md) — Search for LEGO sets by number
- [Viewing Pricing](./set-lookup/viewing-pricing.md) — Compare prices across platforms

### Settings
- [Managing Integrations](./settings/managing-integrations.md) — Connect platforms
- [Resolving Inventory](./settings/resolving-inventory.md) — Link orders to inventory

### Authentication
- [Sign In](./authentication/sign-in.md) — Log in to an existing account
- [Registration](./authentication/registration.md) — Create a new account

---

### Repricing

Manage Amazon listing prices with real-time Buy Box comparison and one-click price updates.

**Overview:** [repricing/overview.md](./repricing/overview.md)

| Journey | Description |
|---------|-------------|
| [Viewing Repricing Data](./repricing/viewing-repricing.md) | Browse Amazon listings with Buy Box comparison |
| [Editing Prices](./repricing/editing-prices.md) | Change prices and push to Amazon |
| [Profit Analysis](./repricing/profit-analysis.md) | Understand profit margins per listing |

**Key Capabilities:**
- Price comparison with Buy Box and lowest offer
- Buy Box ownership tracking
- Inline price editing with one-click push
- Profit calculation with full Amazon fee breakdown
- Manual cost override for profit testing
- 3-hour caching with manual sync option

---

### Platform Stock

Unified view of Amazon stock with inventory comparison and repricing tools.

**Overview:** [platform-stock/overview.md](./platform-stock/overview.md)

| Journey | Description |
|---------|-------------|
| [Viewing Listings](./platform-stock/viewing-listings.md) | Browse all Amazon listings with filters |
| [Comparing Stock](./platform-stock/comparing-stock.md) | Compare Amazon vs local inventory |
| [Importing Listings](./platform-stock/importing-listings.md) | Refresh data from Amazon |

**Key Capabilities:**
- Three tabs: Listings, Comparison, Repricing
- Discrepancy detection (overselling, missing)
- Import status tracking with progress
- Filter by status, fulfillment channel, quantity

---

### Set Lookup

Look up LEGO set information with cross-platform pricing comparison.

**Overview:** [set-lookup/overview.md](./set-lookup/overview.md)

| Journey | Description |
|---------|-------------|
| [Looking Up a Set](./set-lookup/looking-up-set.md) | Search for sets by number |
| [Viewing Pricing](./set-lookup/viewing-pricing.md) | Compare Amazon, eBay, BrickLink prices |

**Key Capabilities:**
- Brickset database integration
- Amazon Buy Box and offers
- eBay new/used pricing
- BrickLink price guide data
- Inventory stock check
- Recent lookup history

---

### Settings

Configure platform integrations and manage inventory resolution.

**Overview:** [settings/overview.md](./settings/overview.md)

| Journey | Description |
|---------|-------------|
| [Managing Integrations](./settings/managing-integrations.md) | Connect eBay, Amazon, BrickLink, Brickset |
| [Resolving Inventory](./settings/resolving-inventory.md) | Link orders to inventory items |

**Key Capabilities:**
- OAuth connections for eBay and Monzo
- API key management for BrickLink, Brick Owl, Brickset
- Amazon SP-API credential storage
- Inventory resolution queue for failed auto-links
- Historical order reprocessing

---

### Authentication

Secure user access to the Hadley Bricks inventory management system with email/password authentication via Supabase Auth.

**Overview:** [authentication/overview.md](./authentication/overview.md)

| Journey | Description |
|---------|-------------|
| [Sign In](./authentication/sign-in.md) | Log in to an existing account |
| [Registration](./authentication/registration.md) | Create a new account with email verification |

**Key Capabilities:**
- Email/password authentication via Supabase Auth
- User registration with business name metadata
- Email verification flow for new accounts
- Automatic session refresh via middleware
- Protected route enforcement
- Redirect to intended page after login

---

## Quick Reference

- [All Business Logic](./reference/business-logic.md) *(pending)*
- [Data Models](./reference/data-models.md) *(pending)*
- [API Endpoints](./reference/api-endpoints.md) *(pending)*

---

## Getting Started

1. **Discover features:** `/docs discover` — Scans codebase, shows priority list
2. **Document a feature:** `/docs document <feature>` — Generates full documentation
3. **Update stale docs:** `/docs update` — Refreshes changed documentation
4. **Check coverage:** `/docs status` — Shows current progress

---

## About This Documentation

This documentation is generated and maintained by the **Functional Documentation Agent**. It describes:

- **What the application does** — Features, capabilities, user journeys
- **How it works** — Business logic, data flows, integrations
- **What the user sees** — UI interactions, states, error handling

For developer-focused documentation (coding patterns, architecture, setup), see [CLAUDE.md](../../CLAUDE.md).

---

*Generated: 2026-01-18*
*Agent: Functional Documentation Agent v1.0*
*Specification: [docs/agents/functional-docs/spec.md](../agents/functional-docs/spec.md)*
