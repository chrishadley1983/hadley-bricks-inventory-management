# Photo Analysis

## Overview

Photo Analysis uses AI to automatically identify LEGO sets, minifigures, and parts from uploaded images. This is particularly useful for evaluating auction lots where you only have photos and a description.

## Accessing Photo Analysis

**Navigation**: Purchase Evaluator → New Evaluation → Photo tab

## Uploading Photos

### Upload Methods

| Method | Description |
|--------|-------------|
| **Drag & Drop** | Drag images onto the drop zone |
| **Browse Files** | Click to open file picker |
| **Clipboard Paste** | Ctrl+V to paste from clipboard |
| **Paste Button** | Click to read from clipboard |

### Supported Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif)

**Limits:**
- Maximum 10 images per evaluation
- Images are automatically converted to base64 for processing

### Image Best Practices

For best AI identification accuracy:

1. **Clear set numbers** - Include box photos showing set numbers when possible
2. **Good lighting** - Avoid shadows and glare
3. **Multiple angles** - Show different sides of boxes/items
4. **Group shots** - One photo showing all items helps AI understand the lot
5. **Detail shots** - Close-ups of specific items for condition assessment

## Listing Description

Optionally paste the seller's listing description:

1. Copy the description from eBay/auction house
2. Paste into the "Listing Description" text area
3. AI uses this to:
   - Identify mentioned set numbers
   - Understand lot composition
   - Cross-reference with visible items

**Tip:** This significantly improves accuracy when set numbers are mentioned but not visible in photos.

## Configuration Options

### Target Profit Margin

Set your desired profit margin:
- Slider: 20% (Aggressive) to 50% (Conservative)
- Default: 35% (Balanced)

Used to calculate maximum purchase price.

### Default Platform

Choose the platform for price lookups:
- **Amazon** - Uses Buy Box and Was Price
- **eBay** - Uses average sold price

### Auction Mode

Enable when evaluating auction lots:

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | Off | Toggle auction calculations |
| **Commission %** | 32.94% | Buyer's premium (inc. VAT) |
| **Shipping** | £0.00 | Shipping from auction house |

When enabled, AI calculates maximum bid accounting for commission and shipping.

### Advanced Options

Click "Advanced Options" to access:

#### Primary AI Model

| Model | Description |
|-------|-------------|
| **Gemini Pro** (Recommended) | Excels at reading set numbers from boxes |
| **Claude Opus** | Better at detailed condition analysis |

#### Cross-Verification

Enable secondary AI model to verify identifications:
- If Gemini is primary → Claude verifies
- If Claude is primary → Gemini verifies

Improves accuracy but increases processing time.

#### Brickognize Integration

Uses Brickognize AI service for:
- Minifigure identification
- Part identification
- Specialized LEGO recognition

#### Smart Image Chunking

Pre-processes images to isolate individual items:

1. AI detects item regions in each photo
2. Crops each region into separate images
3. Analyzes each cropped image independently
4. Combines results

**Benefits:**
- More accurate identification of items in group shots
- Better condition assessment per item
- Handles cluttered auction photos

## Analysis Process

### Step 1: Region Detection (if chunking enabled)

```
Image → Claude AI → Detect item regions → Crop regions
```

The AI identifies bounding boxes around:
- Individual LEGO boxes
- Groups of parts
- Minifigures
- Distinct items

### Step 2: Primary Analysis

Each image (or chunk) is analyzed:

```
Image → Primary Model → Extract:
  • Set numbers
  • Item types (set, minifig, parts)
  • Condition assessment
  • Confidence score
```

### Step 3: Verification (if enabled)

Secondary model reviews identifications:
- Confirms or corrects set numbers
- Validates condition assessments
- Provides confidence adjustment

### Step 4: Brickognize (if enabled)

Specialized LEGO recognition for:
- Parts without packaging
- Loose minifigures
- Bulk lots

### Step 5: Results Compilation

All identifications are merged:
- Duplicates consolidated
- Confidence scores averaged
- Items flagged for review

## Understanding Results

### Analysis Result Fields

| Field | Description |
|-------|-------------|
| **Set Number** | Identified LEGO set number |
| **Item Type** | Set, Minifigure, Part, or Unknown |
| **Condition** | New (sealed) or Used |
| **Quantity** | Number of items identified |
| **Confidence** | AI confidence score (0-100%) |
| **Notes** | AI observations about the item |

### Confidence Levels

| Score | Meaning | Action |
|-------|---------|--------|
| 90%+ | High confidence | Likely accurate |
| 70-89% | Medium confidence | Verify if possible |
| 50-69% | Low confidence | Manual review recommended |
| <50% | Very low | May need correction |

### Flagged Items

Items are flagged for review when:
- Multiple potential matches found
- Low confidence score
- Conflicting primary/secondary analysis
- Set number not found in database

## Editing Results

### Correcting Identifications

1. Click on an item in the results table
2. Edit the set number manually
3. Update condition if needed
4. Changes are applied immediately

### Removing Items

1. Click the remove (X) button on an item
2. Item is removed from evaluation
3. Cannot be undone - re-run analysis if needed

### Adding Items Manually

If AI missed an item:

1. Click **Add Item** button
2. Enter set number, condition, quantity
3. Item is added to the list
4. Will be included in price lookup

## Processing Progress

During analysis, progress messages show:

```
Detecting item regions...
Analyzing image 1 of 5...
Cropping region 1 of 3 from image 1...
Analyzing with Gemini Pro...
Verifying with Claude...
```

Analysis time depends on:
- Number of images
- Image chunking enabled
- Verification enabled
- Brickognize enabled

Typical: 30 seconds to 2 minutes per lot.

## After Analysis

Once photos are analyzed:

1. Review the identified items
2. Make corrections as needed
3. Click **Continue** to proceed to price lookup
4. Follow standard evaluation workflow

## Troubleshooting

### "No items identified"

- Ensure photos contain visible LEGO items
- Try including listing description
- Enable image chunking for group shots
- Use photos with visible set numbers/packaging

### Low confidence scores

- Add photos showing set numbers on boxes
- Include listing description
- Enable cross-verification
- Try different primary AI model

### Wrong set identified

- Manually correct the set number
- AI may confuse similar sets
- Check if set number is partially visible

### Processing failed

- Check image format is supported
- Ensure images are under size limits
- Try with fewer images
- Check network connection

## Technical Details

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/purchase-evaluator/analyze-photos` | Main analysis endpoint |
| `POST /api/purchase-evaluator/detect-regions` | Region detection for chunking |

### Image Processing

Images are processed client-side:
1. Converted to base64
2. Media type normalized
3. Chunked if enabled (Canvas API)
4. Sent to server for AI analysis

### AI Models Used

| Model | Provider | Use |
|-------|----------|-----|
| Gemini 2.0 Flash | Google | Primary analysis, region detection |
| Claude Opus | Anthropic | Verification, detailed analysis |
| Brickognize | Brickognize.com | Part/minifig identification |

## Related Documentation

- [Creating an Evaluation](./creating-evaluation.md) - Full evaluation workflow
- [Converting to Purchase](./conversion.md) - After evaluation is complete
