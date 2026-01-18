# AI Listing Generator

## Overview

The Generator tab creates professional eBay listings using Claude AI. It combines item details, Brickset research, eBay sold price data, and your chosen template to generate optimized titles and HTML descriptions.

## Accessing the Generator

**Navigation**: Dashboard sidebar → Listing Assistant → Generator tab (default)

## Input Fields

### Item Name / Description

Enter the LEGO set number and/or name. Examples:
- "75192 Millennium Falcon"
- "LEGO Star Wars Millennium Falcon UCS"
- "75192"

The AI will look up additional details from Brickset.

### Product Images (Optional)

Upload one or more product photos:
- First image is sent to the AI for context
- Drag and drop or click to select
- Supports multiple images
- Preview thumbnails shown

### Template

Select an HTML template to use as the base for generation:
- **LEGO New** - Template for new, sealed sets
- **LEGO Used** - Template for used, complete sets
- **Custom** - Your own templates

Templates contain placeholders like `[Set Number]`, `[Set Name]`, `[Year]` that the AI fills in.

### Condition

Toggle between:
- **New** - Sealed, unopened sets
- **Used** - Pre-owned sets

This affects:
- Template auto-selection
- Generated content tone
- Price range estimates

### Writing Tone

| Tone | Style |
|------|-------|
| **Minimalist** | Clean, concise, facts-only |
| **Enthusiast** | Detailed, passionate, collector-focused |
| **Professional** | Business-like, formal |
| **Friendly** | Casual, approachable |

### Key Points (Optional)

Add specific details to include in the listing:
- Condition notes ("Minor box wear")
- Included extras ("Includes display stand")
- Selling points ("Retired set")

## Importing from Inventory

Instead of typing item details:

1. Click **Import from Inventory** button
2. Search your inventory items
3. Select an item
4. Fields auto-populate:
   - Item name from set number
   - Condition from inventory record
   - Notes to key points
   - Item ID linked for tracking

## Generating a Listing

1. Fill in required fields (Item Name, Template)
2. Click **Generate Listing**
3. Wait for AI processing (5-15 seconds)
4. Review the generated content

### What Happens During Generation

1. **Brickset Lookup**: Fetches set details, piece count, themes
2. **eBay Research**: Queries recently sold items for pricing
3. **AI Generation**: Claude creates title and description
4. **Response**: Title, description, price range, sold items

## Generated Output

### Title

- eBay optimized (80 character limit)
- Character count shown
- Editable in-place

### Price Range

Based on eBay sold item research:
- Shows range like "£89 - £120"
- Badge displayed prominently

### eBay Sold Items

Collapsible section showing:
- Recent sold items for the same set
- Sale prices and dates
- Condition matches
- Links to original listings

### Description

Rich text editor with two views:

| View | Usage |
|------|-------|
| **Preview** | WYSIWYG editing, see formatted output |
| **HTML** | Edit raw HTML source code |

Click the toggle button to switch between views.

## Editing the Generated Content

### Title Editing

- Click in the title field
- Edit directly
- Character count updates in real-time
- Keep under 80 characters for eBay

### Description Editing

**Preview Mode:**
- Click anywhere to position cursor
- Use toolbar for formatting
- Bold, italic, lists, links
- Undo/redo support

**HTML Mode:**
- Edit raw HTML directly
- Useful for advanced formatting
- Syntax highlighting
- Copy/paste from other sources

## Saving Your Work

### Copy HTML

1. Click **Copy HTML** button
2. HTML copied to clipboard
3. Button shows "Copied!" confirmation
4. Paste into eBay listing form

### Save to History

1. Click **Save to History** button
2. Listing saved to database
3. Access later from History tab
4. Linked to inventory item if imported

## History Tab

View all saved listings:
- Title and date created
- Item name and condition badges
- Price range if available
- Description preview

### History Actions

| Action | Description |
|--------|-------------|
| **Copy HTML** | Copy description to clipboard |
| **View Item** | Navigate to linked inventory item |
| **Delete** | Remove from history |

## Technical Details

### API Endpoint

`POST /api/listing-assistant/generate`

Request payload:
```typescript
{
  item: string;           // Item name/description
  condition: 'New' | 'Used';
  keyPoints?: string;
  templateId: string;
  tone: 'Minimalist' | 'Enthusiast' | 'Professional' | 'Friendly';
  imageBase64?: string;   // First image for context
  inventoryItemId?: string;
}
```

### Response

```typescript
{
  title: string;          // Generated title
  description: string;    // HTML description
  priceRange: string;     // e.g., "£89 - £120"
  ebaySoldItems: Array<{  // Research data
    title: string;
    price: number;
    soldDate: string;
    condition: string;
    url: string;
  }>;
}
```

### AI Model

- Uses Claude API (claude-sonnet)
- Temperature: 0.7 for creativity
- Max tokens: 2000

## Best Practices

1. **Use specific item names** - "75192 Millennium Falcon" beats "Star Wars ship"
2. **Add key points** - Unique details improve listings
3. **Upload photos** - AI uses them for context
4. **Review generated content** - Always verify accuracy
5. **Edit for your voice** - Customize to match your style

## Troubleshooting

### "Generation failed"
- Check internet connection
- Verify item name is valid
- Try a different template

### No price range shown
- Set may be too new for sold data
- Try a more common set number
- eBay API may be rate limited

### Title too long
- Edit to under 80 characters
- Remove less important words
- eBay truncates long titles

### Template not loading
- Refresh the page
- Check Templates tab for issues
- Create a new template

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/features/listing-assistant/tabs/GeneratorTab.tsx` | Main generator UI |
| `apps/web/src/hooks/listing-assistant/use-generator.ts` | Generation mutation hook |
| `apps/web/src/app/api/listing-assistant/generate/route.ts` | API endpoint |
| `apps/web/src/lib/listing-assistant/types.ts` | TypeScript types |
