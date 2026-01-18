# Listing Optimiser

## Overview

The Listing Optimiser page provides two powerful tools for improving eBay sales:

1. **Optimiser Tab**: AI-powered listing analysis using Gemini Pro to score and improve listing quality
2. **Offers Tab**: Buyer negotiation system for sending targeted discount offers to interested buyers

## Accessing the Listing Optimiser

**Navigation**: Dashboard sidebar → Listing Optimiser

## Tabs

| Tab | Purpose | Documentation |
|-----|---------|---------------|
| **Optimiser** | Analyse and improve listing quality | [Detailed docs](../ebay/listing-optimiser.md) |
| **Offers** | Send discount offers to interested buyers | [Buyer Negotiation](./buyer-negotiation.md) |

## Optimiser Tab

The Optimiser uses Gemini 3 Pro to analyse your eBay listings across multiple quality categories:

### Quality Scoring

| Grade | Score | Description |
|-------|-------|-------------|
| A+ | 95-100 | Excellent |
| A | 85-94 | Very Good |
| B | 75-84 | Good |
| C | 60-74 | Needs Work |
| D | 40-59 | Poor |
| F | 0-39 | Critical |

### Scoring Categories

| Category | Weight | What's Assessed |
|----------|--------|-----------------|
| Title | 25% | Keywords, length, readability |
| Item Specifics | 25% | Completeness, accuracy |
| Description | 20% | Content quality, formatting |
| Condition | 15% | Matches actual condition |
| SEO | 15% | Search visibility factors |

### Key Features

- **AI Analysis**: Gemini Pro scores listings and generates improvement suggestions
- **One-Click Apply**: Apply suggestions directly to eBay via API
- **Score Tracking**: Compare before/after scores
- **Bulk Analysis**: Analyse multiple listings at once
- **Filtering**: Filter by grade, review status, age, views

**[Full Optimiser Documentation →](../ebay/listing-optimiser.md)**

## Offers Tab

The Offers tab enables sending targeted discount offers to buyers who have shown interest in your listings (watchers, cart additions, etc.).

### Key Features

- **Metrics Dashboard**: Track offer performance over 30 days
- **Eligible Items**: View listings that qualify for offers
- **Discount Rules**: Configure automatic discount percentages by score
- **Automation**: Schedule automatic offer sending at optimal times
- **Recent Offers**: Track sent offers and their outcomes

**[Full Buyer Negotiation Documentation →](./buyer-negotiation.md)**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Listing Optimiser Page                              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │      Optimiser Tab          │  │        Offers Tab               │  │
│  │                             │  │                                 │  │
│  │  - Filters & Summary        │  │  - Metrics Dashboard            │  │
│  │  - Listings Table           │  │  - Planned Offers Table         │  │
│  │  - Analysis Panel           │  │  - Recent Offers Table          │  │
│  │                             │  │  - Config Modal                 │  │
│  └─────────────┬───────────────┘  └───────────────┬─────────────────┘  │
└────────────────┼──────────────────────────────────┼─────────────────────┘
                 │                                  │
┌────────────────▼──────────────────────────────────▼─────────────────────┐
│                              Services                                    │
│  ┌──────────────────────────┐  ┌────────────────────────────────────┐  │
│  │ listing-optimiser.service│  │    negotiation.service             │  │
│  │                          │  │    negotiation-scoring.service     │  │
│  └────────────┬─────────────┘  └───────────────┬────────────────────┘  │
└───────────────┼────────────────────────────────┼────────────────────────┘
                │                                │
┌───────────────▼────────────────────────────────▼────────────────────────┐
│                           External APIs                                  │
│  ┌──────────────────────────┐  ┌────────────────────────────────────┐  │
│  │      Gemini AI           │  │       eBay Negotiation API         │  │
│  │   (Analysis & Scoring)   │  │     (Send Offers to Buyers)        │  │
│  └──────────────────────────┘  └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Page
| File | Purpose |
|------|---------|
| `apps/web/src/app/(dashboard)/listing-optimiser/page.tsx` | Main page with tabs |

### Optimiser Components
| File | Purpose |
|------|---------|
| `components/features/listing-optimiser/OptimiserFilters.tsx` | Filter controls |
| `components/features/listing-optimiser/OptimiserTable.tsx` | Listings table |
| `components/features/listing-optimiser/AnalysisPanel.tsx` | Results panel |

### Negotiation Components
| File | Purpose |
|------|---------|
| `components/features/negotiation/OffersTab.tsx` | Main offers tab |
| `components/features/negotiation/MetricsDashboard.tsx` | Performance metrics |
| `components/features/negotiation/PlannedOffersTable.tsx` | Eligible items |
| `components/features/negotiation/RecentOffersTable.tsx` | Sent offers |
| `components/features/negotiation/ConfigModal.tsx` | Settings dialog |

### Services
| File | Purpose |
|------|---------|
| `lib/ebay/listing-optimiser.service.ts` | Analysis logic |
| `lib/ebay/negotiation.service.ts` | Offer sending |
| `lib/ebay/negotiation-scoring.service.ts` | Discount calculation |

### Hooks
| File | Purpose |
|------|---------|
| `hooks/useListingOptimiser.ts` | Optimiser queries/mutations |
| `hooks/useNegotiation.ts` | Negotiation queries/mutations |

## Prerequisites

Both features require:
- Connected eBay account
- Active eBay listings
- Required OAuth scopes

## Related Documentation

- [eBay Integration](../ebay/overview.md) - eBay connectivity
- [eBay Stock Management](../ebay/ebay-stock-management.md) - Manage listings
- [Listing Assistant](../listing-assistant/overview.md) - Create new listings
