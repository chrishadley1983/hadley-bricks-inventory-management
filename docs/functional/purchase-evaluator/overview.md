# Purchase Evaluator

## Overview

The Purchase Evaluator is a powerful decision-support tool that helps you assess the profitability of potential LEGO purchases before committing to buy. It answers two critical questions:

1. **"Is this purchase worth it?"** - Given a known cost, calculate expected profit and ROI
2. **"How much should I pay?"** - Given a target profit margin, calculate the maximum purchase price or auction bid

## Accessing the Purchase Evaluator

**Navigation**: Dashboard sidebar → Purchase Evaluator

## Key Capabilities

### Evaluation Modes

| Mode | Purpose | Use Case |
|------|---------|----------|
| **Cost Known** | Calculate profitability for a known purchase price | Fixed-price sales (FB Marketplace, car boot) |
| **Max Bid** | Calculate maximum price/bid for target margin | Auctions, negotiable purchases |

### Input Methods

| Method | Description |
|--------|-------------|
| **Text Input** | Manually enter set numbers and quantities |
| **Photo Analysis** | Upload photos, AI identifies sets automatically |

### Pricing Sources

| Platform | Data Retrieved |
|----------|----------------|
| **Amazon UK** | Buy Box price, Was Price, Sales Rank, Offer count |
| **eBay UK** | Average sold price (completed listings) |

### Fee Calculations

Automatic platform fee calculations for accurate profit estimates:

| Platform | Fees Included |
|----------|---------------|
| **eBay** | 12.8% FVF + 0.36% regulatory + 2.5% payment + £0.30 fixed + ~£4 shipping |
| **Amazon FBM** | ~15% referral fee + £3-4 shipping estimate |

## User Interface

### Wizard Steps

The evaluator uses a step-by-step wizard:

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Input         2. Lookup         3. Review         4. Save       │
│  ═══════════      ───────────       ───────────       ──────────    │
│                                                                      │
│  Enter items      Fetch pricing     Review results    Save or       │
│  (text/photo)     from platforms    Adjust if needed  convert       │
└─────────────────────────────────────────────────────────────────────┘
```

### Summary Dashboard

The Review step shows key metrics:

**Cost Known Mode:**
- Total Cost
- Expected Revenue
- Est. Profit (after fees)
- Overall Margin %

**Max Bid Mode:**
- Maximum Purchase Price (or Max Bid for auctions)
- Expected Revenue
- Expected Profit
- Items Identified

### Auction Mode

When enabled, accounts for auction-specific costs:

| Setting | Default | Description |
|---------|---------|-------------|
| Commission % | 32.94% | Buyer's premium including VAT |
| Shipping | £0.00 | Shipping from auction house |

The system calculates a **Maximum Bid** that, after adding commission and shipping, achieves your target profit margin.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Purchase Evaluator Wizard                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ InputStep/  │  │ LookupStep  │  │ ReviewStep  │  │ SavedStep/Convert   │ │
│  │ PhotoInput  │──│             │──│             │──│                     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
                              │                                  │
┌─────────────────────────────▼──────────────────────────────────▼─────────────┐
│                              Services                                         │
│  ┌────────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │ Photo Analysis             │  │ Evaluation Conversion                   │ │
│  │ • Claude/Gemini AI         │  │ • PurchaseService.create()             │ │
│  │ • Brickognize API          │  │ • InventoryService.createMany()        │ │
│  │ • Image Chunking           │  │                                         │ │
│  └────────────────────────────┘  └────────────────────────────────────────┘ │
│                                                                               │
│  ┌────────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │ Price Lookup               │  │ Reverse Calculations                    │ │
│  │ • Amazon SP-API            │  │ • calculateMaxPurchasePriceEbay()       │ │
│  │ • eBay Browse API          │  │ • calculateMaxPurchasePriceAmazon()     │ │
│  └────────────────────────────┘  │ • calculateAuctionMaxBidFromRevenue()  │ │
│                                   └────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Pages

| File | Purpose |
|------|---------|
| `apps/web/src/app/(dashboard)/purchase-evaluator/page.tsx` | Main evaluator page |
| `apps/web/src/app/(dashboard)/purchase-evaluator/[id]/page.tsx` | View saved evaluation |
| `apps/web/src/app/(dashboard)/purchase-evaluator/[id]/edit/page.tsx` | Edit evaluation |
| `apps/web/src/app/(dashboard)/purchase-evaluator/new/page.tsx` | New evaluation |

### Components

| File | Purpose |
|------|---------|
| `components/features/purchase-evaluator/PurchaseEvaluatorWizard.tsx` | Main wizard component |
| `components/features/purchase-evaluator/steps/InputStep.tsx` | Text input step |
| `components/features/purchase-evaluator/steps/PhotoInputStep.tsx` | Photo upload step |
| `components/features/purchase-evaluator/steps/LookupStep.tsx` | Price lookup step |
| `components/features/purchase-evaluator/steps/ReviewStep.tsx` | Review and adjust step |
| `components/features/purchase-evaluator/steps/SavedStep.tsx` | Save confirmation step |
| `components/features/purchase-evaluator/ConvertToPurchaseDialog.tsx` | Conversion dialog |
| `components/features/purchase-evaluator/InventoryItemsEditor.tsx` | Edit items before conversion |

### Hooks

| File | Purpose |
|------|---------|
| `hooks/use-purchase-evaluator.ts` | Evaluation CRUD operations |
| `hooks/use-photo-analysis.ts` | Photo analysis state management |

### Services

| File | Purpose |
|------|---------|
| `lib/services/evaluation-conversion.service.ts` | Convert evaluation to purchase |
| `lib/purchase-evaluator/reverse-calculations.ts` | Max price calculations |
| `lib/purchase-evaluator/photo-types.ts` | Photo analysis types |

## User Journeys

| Journey | Description | Documentation |
|---------|-------------|---------------|
| Creating Evaluation | Start a new evaluation with text or photos | [Creating an Evaluation](./creating-evaluation.md) |
| Photo Analysis | AI-powered item identification | [Photo Analysis](./photo-analysis.md) |
| Converting to Purchase | Convert completed evaluation to purchase + inventory | [Converting to Purchase](./conversion.md) |

## Related Documentation

- [Purchases](../purchases/overview.md) - Where converted evaluations end up
- [Inventory Management](../inventory/overview.md) - Inventory items created from conversion
- [Amazon Integration](../amazon/overview.md) - Amazon pricing data source
- [eBay Integration](../ebay/overview.md) - eBay pricing data source
