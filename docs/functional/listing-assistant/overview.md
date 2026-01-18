# Listing Assistant

## Overview

The Listing Assistant is an AI-powered tool for creating professional eBay listings. It combines Claude AI for content generation, Brickset research for pricing data, and image processing for photo optimization. The tool also includes a bulk listing refresh feature to boost visibility of older listings.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **AI Listing Generation** | Create titles and HTML descriptions using Claude AI |
| **Price Research** | Automatic eBay sold item research for competitive pricing |
| **Template System** | Reusable HTML templates with placeholder substitution |
| **Image Studio** | Photo optimization with one-click eBay presets |
| **Listing Refresh** | End and recreate older listings to boost visibility |
| **History Tracking** | Save and manage generated listings |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Listing Assistant Page                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ Generator  │  │ Templates  │  │  History   │  │   Image Studio     │ │
│  │    Tab     │  │    Tab     │  │    Tab     │  │       Tab          │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────────┬──────────┘ │
│        │               │               │                   │             │
│  ┌─────▼──────────────▼───────────────▼──────────────────▼───────────┐ │
│  │                         React Hooks                                 │ │
│  │  use-generator  use-templates  use-listings  use-image-processor   │ │
│  └─────────────────────────────────────────────────────────┬──────────┘ │
└────────────────────────────────────────────────────────────┼────────────┘
                                                             │
┌────────────────────────────────────────────────────────────▼────────────┐
│                              API Routes                                  │
│  /api/listing-assistant/generate                                         │
│  /api/listing-assistant/templates                                        │
│  /api/listing-assistant/listings                                         │
│  /api/listing-assistant/analyze-image                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                                             │
┌────────────────────────────────────────────────────────────▼────────────┐
│                              AI Services                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
│  │   Claude API     │  │   eBay Browse    │  │   Brickset API      │    │
│  │  (Generation)    │  │   (Sold Items)   │  │   (Set Details)     │    │
│  └──────────────────┘  └──────────────────┘  └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tabs

| Tab | Purpose | Documentation |
|-----|---------|---------------|
| **Generator** | Create new listings with AI | [generator.md](./generator.md) |
| **Templates** | Manage HTML templates | [templates.md](./templates.md) |
| **History** | View and manage saved listings | Part of generator workflow |
| **Image Studio** | Process and optimize photos | [image-studio.md](./image-studio.md) |
| **Refresh** | Bulk refresh older listings | [listing-refresh.md](./listing-refresh.md) |

## User Journeys

| Journey | Description | Documentation |
|---------|-------------|---------------|
| [Generate a Listing](./generator.md) | Create AI-powered listing from item details | Detailed |
| [Manage Templates](./templates.md) | Create and edit HTML templates | Detailed |
| [Image Processing](./image-studio.md) | Optimize photos for eBay | Detailed |
| [Refresh Old Listings](./listing-refresh.md) | Boost visibility of stale listings | Detailed |

## Key Files

### Pages
| File | Purpose |
|------|---------|
| `apps/web/src/app/(dashboard)/listing-assistant/page.tsx` | Main page with tab navigation |

### Tab Components
| File | Purpose |
|------|---------|
| `tabs/GeneratorTab.tsx` | AI listing generation UI |
| `tabs/TemplatesTab.tsx` | Template management UI |
| `tabs/HistoryTab.tsx` | Saved listings history |
| `tabs/ImageStudioTab.tsx` | Photo editing studio |
| `tabs/RefreshTab.tsx` | Listing refresh workflow |

### Generator Components
| File | Purpose |
|------|---------|
| `generator/ImageUpload.tsx` | Multi-image upload with preview |
| `generator/InventoryImportModal.tsx` | Import item from inventory |
| `generator/EbaySoldItemsDisplay.tsx` | Show comparable sold items |

### Shared Components
| File | Purpose |
|------|---------|
| `shared/RichTextEditor.tsx` | WYSIWYG HTML editor |

### Refresh Components
| File | Purpose |
|------|---------|
| `refresh/EligibleListingsTable.tsx` | Table of listings eligible for refresh |
| `refresh/RefreshJobProgress.tsx` | Progress indicator for refresh jobs |
| `refresh/RefreshItemEditModal.tsx` | Edit listing before refresh |

### Hooks
| File | Purpose |
|------|---------|
| `hooks/listing-assistant/use-generator.ts` | AI generation mutation |
| `hooks/listing-assistant/use-templates.ts` | Template CRUD operations |
| `hooks/listing-assistant/use-listings.ts` | Saved listings queries |
| `hooks/listing-assistant/use-settings.ts` | User preferences |
| `hooks/listing-assistant/use-image-processor.ts` | Image processing state |
| `hooks/listing-refresh/use-eligible-listings.ts` | Fetch eligible listings |
| `hooks/listing-refresh/use-execute-refresh.ts` | Execute refresh job |

## Database Tables

| Table | Purpose |
|-------|---------|
| `listing_templates` | User-created HTML templates |
| `generated_listings` | Saved AI-generated listings |
| `listing_assistant_settings` | User preferences (tone, condition) |
| `listing_refresh_jobs` | Refresh job records |
| `listing_refresh_items` | Individual items in refresh jobs |

## Configuration

### Writing Tones

| Tone | Description |
|------|-------------|
| Minimalist | Clean, concise descriptions |
| Enthusiast | Detailed, passionate descriptions |
| Professional | Business-like, formal tone |
| Friendly | Casual, approachable style |

### Condition Options

| Condition | Use For |
|-----------|---------|
| New | Sealed, unopened sets |
| Used | Complete used sets |

### Template Types

| Type | Description |
|------|-------------|
| `lego_new` | Template for new LEGO sets |
| `lego_used` | Template for used LEGO sets |
| `custom` | User-defined templates |

## AI Generation Flow

```
1. User enters item details
       │
       ▼
2. System looks up Brickset data
   - Set details, themes, piece count
   - Release year, retail price
       │
       ▼
3. System queries eBay sold items
   - Recent sales for same set
   - Average and median prices
       │
       ▼
4. Claude AI generates listing
   - Uses template as base
   - Fills placeholders
   - Applies writing tone
   - Considers key points
       │
       ▼
5. User reviews and edits
   - Rich text editor
   - HTML source view
       │
       ▼
6. User saves or copies
   - Save to history
   - Copy HTML to clipboard
```

## Image Processing Features

| Feature | Description |
|---------|-------------|
| Brightness | Adjust light levels |
| Contrast | Increase/decrease contrast |
| Sharpness | Enhance edge definition |
| Padding | Add white border (zoom out effect) |
| Temperature | Warm or cool color cast |
| eBay Optimize | One-click professional preset |
| AI Analysis | Get alt text, defect detection, filename suggestions |

## Listing Refresh Feature

The refresh feature ends and recreates eBay listings older than 90 days to:
- Reset the "Listed" date for better search ranking
- Apply updated photos or descriptions
- Maintain the same SKU for inventory tracking

### Refresh Modes

| Mode | Description |
|------|-------------|
| **Review Mode** | Review each listing before processing |
| **Immediate Mode** | Process all selected listings without review |

### Eligibility Criteria

- Listing must be active
- Listing must be older than 90 days
- Listing must have a SKU
- User must have required eBay OAuth scopes

## Related Documentation

- [eBay Integration](../ebay/overview.md) - eBay API connectivity
- [Inventory](../inventory/overview.md) - Source items for listings
- [Listing Optimiser](../ebay/listing-optimiser.md) - Gemini-based listing analysis
