# Creating an Evaluation

## Overview

There are two ways to create a purchase evaluation:

1. **Text Input** - Manually enter set numbers and quantities
2. **Photo Analysis** - Upload photos and let AI identify the sets

Both methods lead to the same workflow: price lookup, review, and optional conversion.

## Choosing Your Input Method

### Text Input (Traditional)

Best for:
- Set numbers are clearly known
- Evaluating single high-value items
- Quick evaluations from an eBay listing with set numbers mentioned

### Photo Analysis

Best for:
- Auction lots with multiple items
- When set numbers aren't visible/known
- Evaluating items from screenshots

## Text Input Workflow

### Step 1: Enter Items

**Navigation**: Purchase Evaluator → New Evaluation → Text tab

1. Enter items in the text area, one per line
2. Format: `set_number [quantity] [condition]`

**Examples:**
```
75192              # Millennium Falcon, qty 1, New (default)
75192 2            # Millennium Falcon, qty 2, New
75192 1 Used       # Millennium Falcon, qty 1, Used
10276 3 New        # Colosseum, qty 3, New
```

3. Click **Parse Items** to extract the list
4. Review the parsed items in the table
5. Make corrections if needed
6. Click **Continue** to proceed to price lookup

### Step 2: Configure Settings

Before lookup, configure:

| Setting | Description |
|---------|-------------|
| **Evaluation Mode** | Cost Known (profitability) or Max Bid (calculate max price) |
| **Default Platform** | Amazon or eBay for price lookups |
| **Target Margin** | 20-50% profit margin target (for Max Bid mode) |

### Step 3: Price Lookup

The system fetches pricing data:

| Data | Source |
|------|--------|
| Amazon Buy Box price | Amazon SP-API |
| Amazon Was Price | Amazon SP-API |
| Amazon Sales Rank | Amazon SP-API |
| eBay Average Sold Price | eBay Browse API (completed listings) |

Progress is shown as each item is looked up.

### Step 4: Review Results

After lookup completes, review the results table:

| Column | Description |
|--------|-------------|
| Set # | LEGO set number |
| Name | Set name from lookup |
| Cond | Condition (New/Used) |
| Qty | Quantity |
| Platform | Target selling platform |
| ASIN | Amazon ASIN (with alternatives dropdown) |
| Cost/Price | Editable cost and sell price |
| Buy Box | Amazon current Buy Box price |
| Was Price | Amazon list/was price |
| eBay Sold | Average eBay sold price |
| COG% | Cost of goods percentage |
| Margin | Profit margin percentage |

**Actions available:**
- Change target platform per item
- Override sell price manually
- Select alternative ASINs
- Recalculate costs

### Step 5: Save or Convert

Once reviewed:

- **Save** - Store evaluation for later reference
- **Convert to Purchase** - Create a purchase record and inventory items

## Photo Analysis Workflow

See [Photo Analysis](./photo-analysis.md) for detailed documentation.

### Quick Overview

1. Upload up to 10 photos of the LEGO lot
2. Optionally paste the seller's listing description
3. Configure AI analysis settings
4. Click **Analyze Photos**
5. AI identifies sets, minifigures, and parts
6. Review and correct identifications
7. Continue to price lookup (same as text workflow)

## Configuration Options

### Evaluation Mode

**Cost Known** (default):
- You enter the total purchase cost
- System calculates profitability
- Shows: Total Cost, Revenue, Profit, Margin %

**Max Bid**:
- You set target profit margin
- System calculates maximum purchase price
- Shows: Max Price, Revenue, Expected Profit

### Auction Mode (Max Bid only)

Enable when evaluating auction lots:

| Setting | Default | Description |
|---------|---------|-------------|
| Commission % | 32.94% | Buyer's premium including VAT |
| Shipping | £0.00 | Shipping from auction house to you |

**How it works:**
1. System calculates total revenue from expected sell prices
2. Subtracts platform fees (eBay/Amazon)
3. Subtracts target profit
4. Reverse-calculates maximum bid that results in target profit after commission

### Target Margin

Slider from 20% to 50%:

| Level | Margin | Description |
|-------|--------|-------------|
| Aggressive | 20% | Lower profit, more competitive bids |
| Balanced | 35% | Standard profit target |
| Conservative | 50% | Higher profit, more selective |

## Handling Multiple ASIN Matches

When Amazon lookup finds multiple potential ASINs:

1. A dropdown arrow appears next to the ASIN
2. Click to see alternative ASINs with titles
3. Select the correct match
4. Click **Apply Changes** to update pricing
5. Click **Recalculate** to refresh profitability

Items needing review are highlighted in yellow.

## Items Without Pricing Data

Items with no pricing data are highlighted in red.

**Options:**
1. Switch to eBay (may have sold data)
2. Enter a manual sell price override
3. Remove the item from evaluation

## Saving an Evaluation

After review:

1. Click **Save Evaluation**
2. Enter a name (optional, defaults to date)
3. Evaluation is saved to database
4. Access later from the evaluations list

**Evaluation statuses:**
- `draft` - In progress
- `completed` - Lookup finished
- `saved` - Manually saved
- `converted` - Converted to purchase

## Tips for Accurate Evaluations

1. **Use correct condition** - New vs Used significantly affects prices
2. **Check Amazon Sales Rank** - Low rank = faster sales
3. **Consider platform choice** - Some items sell better on eBay vs Amazon
4. **Account for shipping** - Platform fees include estimated shipping costs
5. **Be conservative** - Market conditions change; leave margin for error

## Related Documentation

- [Photo Analysis](./photo-analysis.md) - AI-powered item identification
- [Converting to Purchase](./conversion.md) - After evaluation is complete
