# Looking Up a Set

> Search for LEGO sets by number and view detailed information.

## Overview

The Set Lookup page allows you to search for any LEGO set by its set number and view comprehensive information from Brickset.

## Search Process

### 1. Enter Set Number
- Type the set number in the search box
- Accepts formats: "75192" or "75192-1"
- Variant suffix (-1, -2) optional

### 2. Force Refresh Option
- **Unchecked (default)**: Uses cached data if available
- **Checked**: Fetches fresh data from Brickset API

### 3. Click Look Up
- Shows loading spinner during search
- Results display in card below

## Set Details Card

### Header Section
- Set image (72x72px)
- Set name and number
- Release status badge
- Availability badge

### Product Badges
- Set number
- EAN barcode (if available)
- UPC barcode (if available)
- UK RRP (recommended retail price)
- Theme and year

### Statistics Grid
| Stat | Description |
|------|-------------|
| **Pieces** | Total piece count |
| **Minifigs** | Number of minifigures |
| **Year** | Release year |
| **Rating** | Brickset community rating |

### Identifiers Section
- US Item Number
- EU Item Number
- EAN barcode
- UPC barcode

### Community Stats
- Rating (out of 5)
- Own count (users who own it)
- Want count (users who want it)

### Availability Dates
- Launch date
- Exit date (retirement)

### Cache Info
- Last updated timestamp
- Source indicator (API or cache)

## Recent Lookups

When no search is active, shows your last 5 looked-up sets:
- Thumbnail image
- Set number and name
- Theme
- Click to search again

## Error Handling

### Brickset Not Configured
- Shows alert banner
- Link to settings page
- Can still search cached sets

### Set Not Found
- Error message displayed
- Try different set number format

### API Error
- Error message with details
- Try force refresh option

## Source Files

- [page.tsx](../../../apps/web/src/app/(dashboard)/set-lookup/page.tsx:140-371) - Main page
- [SetLookupForm.tsx](../../../apps/web/src/components/features/brickset/SetLookupForm.tsx:15-80) - Search form
- [SetDetailsCard.tsx](../../../apps/web/src/components/features/brickset/SetDetailsCard.tsx:114-575) - Results display

## API Endpoint

```
GET /api/brickset/lookup?setNumber=75192&forceRefresh=false
```

### Response
```json
{
  "data": {
    "setNumber": "75192-1",
    "setName": "Millennium Falcon",
    "theme": "Star Wars",
    "pieces": 7541,
    "minifigs": 4,
    "yearFrom": 2017,
    "imageUrl": "https://...",
    "ean": "5702015869935",
    "upc": "673419267038",
    "ukRetailPrice": 649.99,
    ...
  },
  "source": "cache"
}
```
