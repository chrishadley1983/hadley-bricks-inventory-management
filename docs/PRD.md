# Product Requirements Document

## Hadley Bricks Inventory & Business Management System
### Version 2.0 - Production Refactor

---

| Field | Value |
|-------|-------|
| **Document Version** | 1.0 |
| **Date** | December 2024 |
| **Author** | Chris (Hadley Bricks) |
| **Status** | Draft - Ready for Review |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [Target Architecture](#4-target-architecture)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Technical Specifications](#7-technical-specifications)
8. [Data Architecture](#8-data-architecture)
9. [Security Requirements](#9-security-requirements)
10. [Migration Strategy](#10-migration-strategy)
11. [Development Phases](#11-development-phases)
12. [Testing Strategy](#12-testing-strategy)
13. [Risk Assessment](#13-risk-assessment)
- [Appendix A: Current Feature Inventory](#appendix-a-current-feature-inventory)
- [Appendix B: Database Schema](#appendix-b-database-schema)
- [Appendix C: API Specifications](#appendix-c-api-specifications)

---

## 1. Executive Summary

### 1.1 Project Overview

Hadley Bricks Inventory System is a comprehensive business management application for Lego resale operations. The system currently manages inventory across multiple sales platforms (Amazon, eBay, BrickLink, Brick Owl), tracks purchases and expenses, handles order fulfillment workflows, and provides financial reporting.

This PRD defines the complete refactoring of the existing Google AI Studio prototype into a production-ready, scalable application built with modern architecture and best practices. The refactor will maintain full feature parity while introducing proper authentication, secure credential management, a proper database layer, and infrastructure for future commercial scaling.

### 1.2 Business Context

- **Current Users:** Personal use (Hadley Bricks)
- **Future Vision:** Commercial SaaS platform for Lego resellers
- **Codebase Size:** ~400KB source code, 20+ components, 6 service modules
- **Platform Integrations:** BrickLink, Brick Owl, eBay, Amazon, PayPal, Google Sheets

### 1.3 Key Drivers for Refactor

- **Reliability:** Current prototype lacks error handling, monitoring, and recovery mechanisms
- **Security:** Hardcoded credentials, no authentication, API keys in localStorage
- **Maintainability:** Monolithic components, prop drilling, no testing infrastructure
- **Scalability:** Frontend-only architecture limits future growth and multi-user support
- **Development Velocity:** Need clean architecture for Claude Code-assisted feature development

---

## 2. Current State Analysis

### 2.1 Technology Stack (Current)

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Heroicons, Recharts |
| Backend | None (direct API calls from frontend) |
| Database | Google Sheets (primary), IndexedDB (local cache) |
| AI | Google Gemini 2.5 Flash (purchase parsing, distance calculation) |
| Auth | None (credentials in localStorage) |
| PDF Generation | jsPDF with AutoTable |

### 2.2 Architecture Issues

#### Security Vulnerabilities
- Hardcoded API credentials (BrickLink, Brick Owl) in source code
- Google OAuth tokens stored in localStorage without encryption
- No user authentication - single-user assumption
- CORS proxy usage exposes API credentials to third parties

#### Scalability Limitations
- Google Sheets as database: 10 million cell limit, rate limiting, no indexing
- All API calls from frontend: no background processing capability
- No caching layer beyond browser IndexedDB
- Hardcoded column mappings in 1,400+ line sheetsService.ts

#### Code Quality Issues
- 26KB App.tsx with embedded business logic
- Extensive prop drilling through component tree
- No state management solution
- Zero test coverage
- Inconsistent error handling

### 2.3 Feature Inventory

The current system provides 16 major functional areas:

| Core Operations | Platform Integrations |
|-----------------|----------------------|
| Summary Dashboard | BrickLink Order Import |
| Purchase Entry & Tracking | BrickLink BSX Upload |
| Inventory Upload (New/Used) | Brick Owl Order Import |
| Inventory Aging Reports | eBay Order Import (CSV) |
| Cost Evaluation | eBay Payment Import |
| Order Pick Lists (Amazon/eBay) | Amazon Order Import |
| Transaction History | Amazon Transaction Import |
| Settings Management | PayPal Fee Import |

---

## 3. Goals & Success Metrics

### 3.1 Primary Goals

1. **Feature Parity:** Replicate 100% of existing functionality in the new architecture
2. **Production Ready:** Implement proper security, error handling, monitoring, and reliability
3. **Developer Experience:** Clean architecture optimized for Claude Code-assisted development
4. **Future Scalability:** Architecture that supports commercial multi-tenant SaaS
5. **Platform Flexibility:** Support for both web and mobile (React Native) clients

### 3.2 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Feature Parity | 100% | Feature checklist |
| Test Coverage | >80% | Jest/Vitest coverage |
| API Response Time | <500ms (p95) | Monitoring dashboard |
| Uptime | 99.5% | Uptime monitoring |
| Security Vulnerabilities | 0 Critical/High | Security audit |
| Feature Development Time | -50% vs current | Development logs |

---

## 4. Target Architecture

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│   ┌─────────────────┐     ┌─────────────────────────────────┐   │
│   │  React Web App  │     │  React Native Mobile (Future)   │   │
│   │  (Next.js 14)   │     │  (Expo)                         │   │
│   └────────┬────────┘     └────────────────┬────────────────┘   │
└────────────┼───────────────────────────────┼──────────────────┘
             │                               │
             ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER                                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Supabase Edge Functions                    │   │
│   │   ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │   │
│   │   │ Inventory  │ │   Orders   │ │  Platform Sync     │  │   │
│   │   │ Service    │ │  Service   │ │  (BL/BO/eBay/Amz)  │  │   │
│   │   └────────────┘ └────────────┘ └────────────────────┘  │   │
│   └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                               │
│  ┌──────────────────┐  ┌───────────────┐  ┌─────────────────┐   │
│  │ Supabase         │  │ Google Sheets │  │ Supabase        │   │
│  │ PostgreSQL       │  │ (Legacy Read) │  │ Storage (Files) │   │
│  └──────────────────┘  └───────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Technology Stack (Target)

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Next.js 14 (App Router) | SSR, API routes, excellent DX |
| Styling | Tailwind CSS + shadcn/ui | Consistent design system, accessible |
| State | Zustand + TanStack Query | Lightweight, excellent caching |
| Backend | Supabase Edge Functions | Serverless, TypeScript, integrated auth |
| Database | Supabase PostgreSQL | Relational, RLS, real-time subscriptions |
| Auth | Supabase Auth | Email/password, OAuth, MFA |
| AI Primary | Claude API (Anthropic) | Primary AI provider, superior reasoning |
| AI Secondary | Gemini (Google) | Image analysis (future Nana Banana Pro) |
| Hosting | Vercel | Optimized for Next.js, global CDN |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance monitoring |

---

## 5. Functional Requirements

### 5.1 Authentication & User Management

1. User registration with email verification
2. Secure login with email/password
3. Optional OAuth login (Google, Apple) for future
4. Password reset functionality
5. Session management with secure token handling
6. User profile management (business name, home postcode)

### 5.2 Inventory Management

1. Add inventory items (New and Used Lego sets)
2. Set catalog lookup integration (set number → name)
3. Bulk inventory upload from CSV
4. Inventory status tracking (NOT YET RECEIVED, IN STOCK, LISTED, SOLD)
5. Storage location management
6. Linked lot grouping for cost allocation
7. SKU auto-generation
8. Inventory aging reports with configurable thresholds

### 5.3 Purchase Tracking

1. Manual purchase entry with full details
2. AI-powered purchase parsing from natural language (Claude API)
3. Configurable source and payment method lists
4. Image attachment for receipts
5. Collection mileage calculation and petrol tracking
6. Purchase history with search and filtering

### 5.4 Platform Integrations

#### BrickLink
- OAuth 1.0a API authentication
- Fetch and sync sales orders (open and filed)
- BSX file upload for parts inventory
- Duplicate detection on sync

#### Brick Owl
- API key authentication
- Fetch and sync sales orders
- Order status synchronization

#### eBay
- CSV import for orders (configurable column mapping)
- Payment/fee import with fee breakdown
- Order pick list generation
- Inventory status auto-update on pick

#### Amazon
- CSV import for orders
- Transaction import with fee tracking
- ASIN-based inventory lookup
- Order pick list with storage locations
- PDF pick slip generation

#### PayPal
- CSV transaction import
- Fee extraction and tracking

### 5.5 Financial Reporting

1. Summary dashboard with key metrics
2. Rolling 12-month turnover calculation
3. Monthly turnover and profit tracking
4. Listing value performance vs targets
5. Platform-wise sales breakdown charts
6. Cost evaluation for inventory lots

### 5.6 Order Fulfillment

1. Amazon pending order pick list
2. eBay order pick list with custom label matching
3. Storage location display for efficient picking
4. Batch status update (mark as SOLD)
5. PDF pick slip export

---

## 6. Non-Functional Requirements

### 6.1 Performance

- Page load time: <2 seconds (First Contentful Paint)
- API response time: <500ms for 95th percentile
- Support for 10,000+ inventory items without degradation
- Optimistic UI updates for perceived performance

### 6.2 Reliability

- 99.5% uptime target
- Graceful degradation when external APIs unavailable
- Automatic retry with exponential backoff for failed requests
- Data consistency with transaction support

### 6.3 Usability

- Responsive design (mobile, tablet, desktop)
- Keyboard navigation support
- Clear error messages with recovery guidance
- Loading states for all async operations
- Toast notifications for user feedback

### 6.4 Maintainability

- Modular architecture with clear boundaries
- Comprehensive TypeScript typing (strict mode)
- Consistent code style (ESLint, Prettier)
- Inline documentation for complex logic
- Component library with Storybook (optional)

### 6.5 Scalability

- Horizontal scaling via serverless architecture
- Database indexing for common query patterns
- Caching layer for expensive operations
- Multi-tenant architecture preparation

---

## 7. Technical Specifications

### 7.1 Project Structure

```
hadley-bricks/
├── apps/
│   └── web/                    # Next.js 14 web application
│       ├── app/                # App router pages
│       ├── components/         # React components
│       ├── hooks/              # Custom React hooks
│       ├── stores/             # Zustand stores
│       └── lib/                # Utilities and helpers
├── packages/
│   ├── database/              # Supabase client and types
│   ├── ui/                    # Shared UI components
│   └── shared/                # Shared types and utilities
├── supabase/
│   ├── functions/             # Edge Functions
│   └── migrations/            # Database migrations
└── docs/                      # Documentation
```

### 7.2 Key Design Patterns

#### Repository Pattern for Data Access

All data access goes through repository classes that abstract the underlying storage. During MVP, repositories will read from Google Sheets and write to both Google Sheets and Supabase. Post-migration, repositories will only use Supabase.

#### Service Layer for Business Logic

Business logic is encapsulated in service classes that coordinate between repositories, external APIs, and AI providers. Services are stateless and dependency-injected.

#### Adapter Pattern for External Integrations

Each external platform (BrickLink, Brick Owl, eBay, Amazon) has an adapter class that normalizes API responses to internal types. This isolates platform-specific logic and enables easy addition of new platforms.

### 7.3 State Management Strategy

- **Server State:** TanStack Query for all API data fetching, caching, and synchronization
- **Client State:** Zustand for UI state (modals, sidebars, user preferences)
- **Form State:** React Hook Form with Zod validation
- **URL State:** Next.js searchParams for filterable/shareable views

---

## 8. Data Architecture

### 8.1 Database Schema Overview

The Supabase PostgreSQL database will mirror and eventually replace the Google Sheets structure.

#### Core Tables

- **users** - User accounts and profiles
- **inventory_items** - All inventory (new and used sets)
- **purchases** - Purchase transactions
- **platform_orders** - Orders from all platforms
- **platform_credentials** - Encrypted API credentials per user
- **financial_transactions** - Fees, payments, refunds

### 8.2 Data Migration Strategy

#### Phase 1: Dual-Write (MVP)

During MVP, the system reads from Google Sheets but writes to both Google Sheets and Supabase. This ensures data parity without disrupting existing workflows.

#### Phase 2: Historical Migration

A one-time migration script will import all historical Google Sheets data into Supabase with data validation and deduplication.

#### Phase 3: Supabase Primary

After migration verification, the system switches to Supabase as the primary data store. Google Sheets integration becomes optional/deprecated.

### 8.3 Row Level Security (RLS)

All tables enforce RLS policies to ensure users can only access their own data. This is critical for multi-tenant security.

```sql
CREATE POLICY "Users can only view own inventory"
  ON inventory_items FOR SELECT
  USING (auth.uid() = user_id);
```

---

## 9. Security Requirements

### 9.1 Authentication

- Supabase Auth with email/password
- JWT tokens with secure httpOnly cookies
- Session expiry and refresh token rotation
- Rate limiting on auth endpoints

### 9.2 Credential Management

- Platform API keys stored encrypted in Supabase Vault
- No credentials in source code or client-side storage
- Environment variables for system-level secrets
- Credential rotation support

### 9.3 Data Protection

- Row Level Security on all tables
- HTTPS only (enforced via Vercel)
- Input validation on all endpoints (Zod schemas)
- SQL injection prevention (parameterized queries)
- XSS prevention (React escaping + CSP headers)

### 9.4 API Security

- Edge Functions require valid auth tokens
- Rate limiting per user/endpoint
- Request size limits
- CORS restricted to allowed origins

---

## 10. Migration Strategy

### 10.1 Parallel Run Approach

The legacy Google AI Studio app will remain operational until MVP is complete and validated. This ensures zero downtime and allows rollback if issues are discovered.

### 10.2 Migration Phases

#### Phase 1: Infrastructure Setup
- Set up Supabase project (auth, database, storage)
- Set up Vercel project with environment configuration
- Configure Sentry for error tracking
- Establish CI/CD pipeline

#### Phase 2: Core Application
- Implement authentication flow
- Build dashboard and navigation
- Implement settings management
- Create dual-write data layer

#### Phase 3: Feature Migration
- Migrate features one module at a time
- Write tests for each migrated feature
- UAT for each module before proceeding

#### Phase 4: Data Migration
- Export all Google Sheets data
- Transform and validate data
- Import into Supabase with deduplication
- Verify data integrity

#### Phase 5: Cutover
- Switch to Supabase-only mode
- Monitor for issues
- Deprecate Google Sheets integration

---

## 11. Development Phases

### Phase 1: Foundation (Weeks 1-2)

- Project scaffolding (Next.js, Tailwind, TypeScript)
- Supabase project setup and configuration
- Authentication implementation
- Core layout and navigation
- Settings module with credential management
- Google Sheets integration (dual-write layer)

### Phase 2: Core Features (Weeks 3-5)

- Summary Dashboard
- Purchase Entry with AI parsing (Claude)
- Inventory Upload (New/Used)
- Inventory Aging Reports
- Cost Evaluation
- Transaction History

### Phase 3: Platform Integrations (Weeks 6-8)

- BrickLink API integration
- Brick Owl API integration
- eBay CSV import
- Amazon CSV import
- PayPal CSV import
- Order pick lists (Amazon/eBay)

### Phase 4: Polish & Testing (Weeks 9-10)

- Comprehensive test coverage
- Error handling improvements
- Performance optimization
- UI/UX refinements
- Documentation

### Phase 5: Data Migration & Cutover (Weeks 11-12)

- Historical data migration
- Data validation and reconciliation
- Switch to Supabase primary
- Legacy system deprecation

---

## 12. Testing Strategy

### 12.1 Unit Testing

- **Framework:** Vitest (Vite-native, fast)
- **Coverage Target:** >80% for services and utilities
- **Focus Areas:** Data transformations, validation logic, calculations

### 12.2 Integration Testing

- **Framework:** Vitest + MSW (Mock Service Worker)
- **Focus Areas:** API routes, database operations, external integrations
- Mock external APIs (BrickLink, Brick Owl, Google Sheets)

### 12.3 Component Testing

- **Framework:** React Testing Library
- **Focus Areas:** User interactions, form validation, accessibility

### 12.4 End-to-End Testing

- **Framework:** Playwright
- **Scope:** Critical user journeys
  - Authentication flow
  - Purchase entry and sync
  - Inventory upload workflow
  - Platform import workflows

### 12.5 User Acceptance Testing

Chris (product owner) will conduct UAT at each phase milestone using production-like data. Acceptance criteria for each feature must be verified before phase completion.

---

## 13. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | Critical | Dual-write during MVP; backup before migration; validation scripts |
| Platform API changes | Medium | Medium | Adapter pattern isolates changes; monitor API changelogs |
| Feature parity gaps | Medium | High | Feature checklist; UAT per module; parallel run |
| Google Sheets rate limits | Medium | Medium | Batch operations; caching; accelerate migration timeline |
| Scope creep | High | Medium | Strict MVP scope; new features in separate PRD |
| AI provider costs | Low | Low | Usage monitoring; Claude Haiku for simple tasks |

---

## Appendix A: Current Feature Inventory

### A.1 Components (20 total)

| Component | Size | Description |
|-----------|------|-------------|
| App.tsx | 26KB | Main app shell, routing, state management |
| InventoryUpload.tsx | 28KB | Inventory item creation, catalog lookup, batch upload |
| SettingsModal.tsx | 25KB | Connections, validation lists, API configs |
| AmazonTransactionImport.tsx | 21KB | Amazon transaction CSV import and mapping |
| EbayOrderImport.tsx | 19KB | eBay order CSV import and mapping |
| EbayPaymentImport.tsx | 19KB | eBay payment/fee import |
| EbayPick.tsx | 19KB | eBay order pick list with inventory lookup |
| PurchaseEntry.tsx | 18KB | Purchase entry form with AI parsing |
| AmazonOrderImport.tsx | 18KB | Amazon order CSV import |
| AmazonPick.tsx | 17KB | Amazon order pick list with PDF export |
| BrickLinkOrderImport.tsx | 15KB | BrickLink order sync |
| BrickOwlOrderImport.tsx | 14KB | Brick Owl order sync |
| CostEvaluation.tsx | 12KB | Lot cost distribution |
| InventoryAging.tsx | 12KB | Inventory age analysis |
| PayPalFeeImport.tsx | 12KB | PayPal transaction import |
| BrickLinkUpload.tsx | 8KB | BSX file upload |
| HistoryView.tsx | 8KB | Local purchase history |
| SummaryView.tsx | 7.5KB | Dashboard metrics |
| CompletionModal.tsx | 3KB | Post-purchase confirmation |
| Header.tsx | 2KB | App header with settings |
| PurchaseList.tsx | 2.5KB | Session purchase list |
| SpendingChart.tsx | 2.5KB | Pie chart visualization |

### A.2 Services (6 total)

| Service | Size | Description |
|---------|------|-------------|
| sheetsService.ts | 59KB | Google Sheets CRUD, 1,448 lines, 25+ exports |
| brickOwlService.ts | 7KB | Brick Owl API integration |
| bricklinkService.ts | 5KB | BrickLink API integration |
| storageService.ts | 4KB | IndexedDB for local caching |
| geminiService.ts | 3.5KB | Gemini AI for parsing and distance calc |
| oauthService.ts | 3KB | OAuth 1.0a signature generation |

### A.3 Type Definitions

| Type | Purpose |
|------|---------|
| Purchase | Purchase transaction |
| InventoryItem | Inventory record (new/used) |
| BrickLinkOrder | BrickLink order structure |
| BrickOwlOrder | Brick Owl order structure |
| EbayOrder | eBay order structure |
| EbayPayment | eBay payment/fee record |
| AmazonOrder | Amazon order structure |
| AmazonTransaction | Amazon transaction record |
| PayPalTransaction | PayPal transaction record |
| SheetConfig | Google Sheets connection |
| BrickLinkConfig | BrickLink API credentials |
| BrickOwlConfig | Brick Owl API credentials |
| PickOrder | Order fulfillment record |

---

## Appendix B: Database Schema

### B.1 Core Tables

```sql
-- Users table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  business_name TEXT,
  home_postcode TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory items
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  set_number TEXT NOT NULL,
  item_name TEXT,
  condition TEXT CHECK (condition IN ('New', 'Used')),
  status TEXT DEFAULT 'NOT YET RECEIVED',
  source TEXT,
  purchase_date DATE,
  cost DECIMAL(10,2),
  listing_date DATE,
  listing_value DECIMAL(10,2),
  storage_location TEXT,
  sku TEXT,
  linked_lot TEXT,
  amazon_asin TEXT,
  listing_platform TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchases
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  purchase_date DATE NOT NULL,
  short_description TEXT NOT NULL,
  cost DECIMAL(10,2) NOT NULL,
  source TEXT,
  payment_method TEXT,
  description TEXT,
  reference TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform orders (unified across all platforms)
CREATE TABLE platform_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  platform TEXT NOT NULL, -- 'bricklink', 'brickowl', 'ebay', 'amazon'
  platform_order_id TEXT NOT NULL,
  order_date TIMESTAMPTZ,
  buyer_name TEXT,
  status TEXT,
  subtotal DECIMAL(10,2),
  shipping DECIMAL(10,2),
  fees DECIMAL(10,2),
  total DECIMAL(10,2),
  currency TEXT DEFAULT 'GBP',
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, platform_order_id)
);

-- Platform credentials (encrypted)
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  platform TEXT NOT NULL,
  credentials_encrypted BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Financial transactions
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL, -- 'sale', 'fee', 'refund', 'payout'
  platform TEXT,
  order_id UUID REFERENCES platform_orders(id),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User settings
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  source_options TEXT[] DEFAULT ARRAY['eBay', 'FB Marketplace', 'BL', 'Amazon'],
  payment_methods TEXT[] DEFAULT ARRAY['HSBC - Cash', 'Monzo - Card', 'PayPal'],
  google_sheets_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### B.2 Indexes

```sql
CREATE INDEX idx_inventory_user ON inventory_items(user_id);
CREATE INDEX idx_inventory_status ON inventory_items(user_id, status);
CREATE INDEX idx_inventory_sku ON inventory_items(user_id, sku);
CREATE INDEX idx_inventory_asin ON inventory_items(user_id, amazon_asin);
CREATE INDEX idx_purchases_user_date ON purchases(user_id, purchase_date DESC);
CREATE INDEX idx_orders_user_platform ON platform_orders(user_id, platform);
CREATE INDEX idx_orders_date ON platform_orders(user_id, order_date DESC);
CREATE INDEX idx_transactions_user_date ON financial_transactions(user_id, transaction_date DESC);
```

### B.3 Row Level Security Policies

```sql
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Inventory policies
CREATE POLICY "Users can view own inventory"
  ON inventory_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own inventory"
  ON inventory_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own inventory"
  ON inventory_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own inventory"
  ON inventory_items FOR DELETE USING (auth.uid() = user_id);

-- Similar policies for all other tables...
```

---

## Appendix C: API Specifications

### C.1 Internal API Routes (Next.js)

All internal APIs will be implemented as Next.js App Router API routes with TypeScript and Zod validation.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/inventory | List inventory items (with filtering) |
| POST | /api/inventory | Create inventory item(s) |
| PATCH | /api/inventory/[id] | Update inventory item |
| DELETE | /api/inventory/[id] | Delete inventory item |
| GET | /api/purchases | List purchases |
| POST | /api/purchases | Create purchase |
| POST | /api/ai/parse-purchase | AI purchase parsing (Claude) |
| POST | /api/ai/calculate-distance | Distance calculation |
| GET | /api/platforms/bricklink/orders | Fetch BrickLink orders |
| POST | /api/platforms/bricklink/sync | Sync BrickLink orders to DB |
| GET | /api/platforms/brickowl/orders | Fetch Brick Owl orders |
| POST | /api/platforms/brickowl/sync | Sync Brick Owl orders to DB |
| POST | /api/import/ebay-orders | Import eBay orders CSV |
| POST | /api/import/ebay-payments | Import eBay payments CSV |
| POST | /api/import/amazon-orders | Import Amazon orders CSV |
| POST | /api/import/amazon-transactions | Import Amazon transactions CSV |
| POST | /api/import/paypal | Import PayPal transactions CSV |
| GET | /api/reports/summary | Dashboard metrics |
| GET | /api/reports/aging | Inventory aging report |
| GET | /api/pick/amazon | Amazon pick list |
| GET | /api/pick/ebay | eBay pick list |
| POST | /api/pick/complete | Mark items as picked/sold |
| GET | /api/settings | Get user settings |
| PATCH | /api/settings | Update user settings |
| GET | /api/credentials/[platform] | Get platform credentials (masked) |
| POST | /api/credentials/[platform] | Save platform credentials |

### C.2 Request/Response Examples

#### Create Inventory Item

```typescript
// POST /api/inventory
// Request
{
  "setNumber": "75192",
  "itemName": "Millennium Falcon",
  "condition": "New",
  "status": "IN STOCK",
  "source": "Amazon",
  "purchaseDate": "2024-12-01",
  "cost": 649.99,
  "storageLocation": "A1-01",
  "linkedLot": "LOT-2024-001"
}

// Response
{
  "id": "uuid",
  "setNumber": "75192",
  "itemName": "Millennium Falcon",
  "sku": "HB-NEW-75192-001",
  // ... all fields
  "createdAt": "2024-12-09T10:00:00Z"
}
```

#### AI Parse Purchase

```typescript
// POST /api/ai/parse-purchase
// Request
{
  "text": "Bought Star Wars set from FB marketplace for £45, paid via Monzo card"
}

// Response
{
  "shortDescription": "Star Wars set",
  "cost": 45.00,
  "source": "FB Marketplace",
  "paymentMethod": "Monzo - Card",
  "description": "Star Wars set purchased from Facebook Marketplace"
}
```

### C.3 External APIs Consumed

| API | Authentication | Endpoints Used |
|-----|---------------|----------------|
| BrickLink API v1 | OAuth 1.0a | GET /orders (direction=in) |
| Brick Owl API | API Key | GET /orders |
| Google Sheets API v4 | OAuth 2.0 | values.get, values.append, values.update |
| Claude API | API Key | POST /v1/messages |
| Gemini API | API Key | POST /v1/models/gemini-2.5-flash:generateContent |

### C.4 Error Response Format

```typescript
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      { "field": "cost", "message": "Cost must be a positive number" }
    ]
  }
}
```

### C.5 Rate Limiting

| Endpoint Category | Limit |
|-------------------|-------|
| Auth endpoints | 10 req/min |
| AI endpoints | 20 req/min |
| Data read | 100 req/min |
| Data write | 50 req/min |
| Platform sync | 10 req/min |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | December 2024 | Chris | Initial PRD |

---

*— End of Document —*
