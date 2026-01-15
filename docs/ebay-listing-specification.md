# eBay Listing Specification

## Technical Criteria for the Perfect eBay Listing

**Version:** 1.0  
**Purpose:** Hadley Bricks Inventory Software - Inventory Item to eBay Listing Conversion  
**Last Updated:** January 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Title Requirements](#2-title-requirements)
3. [Item Specifics](#3-item-specifics)
4. [Product Identifiers](#4-product-identifiers)
5. [Item Condition](#5-item-condition)
6. [Description](#6-description)
7. [Images](#7-images)
8. [Pricing](#8-pricing)
9. [Shipping Configuration](#9-shipping-configuration)
10. [Return Policy](#10-return-policy)
11. [Category Selection](#11-category-selection)
12. [Listing Format](#12-listing-format)
13. [Business Policies](#13-business-policies)
14. [Validation Rules](#14-validation-rules)
15. [API Reference](#15-api-reference)

---

## 1. Overview

### 1.1 Purpose

This specification defines the technical criteria required to generate optimised eBay listings from Hadley Bricks inventory data. Listings created following this specification will be optimised for eBay's Cassini search algorithm and Best Match ranking system.

### 1.2 Key Optimisation Factors

eBay's Cassini algorithm evaluates listings based on:

- **Relevance:** How well the listing matches buyer search terms (title, item specifics, description)
- **Listing Quality:** Complete listings with detailed descriptions, multiple photos, and proper categorisation
- **Seller Performance:** Feedback score, shipping times, customer service quality
- **Buyer Behaviour Signals:** Click-through rate, time on page, conversion rate

### 1.3 Core Principles

1. Maximise use of available character limits
2. Complete all required and recommended item specifics
3. Provide high-quality images from multiple angles
4. Use accurate product identifiers where available
5. Offer competitive shipping and returns policies

---

## 2. Title Requirements

### 2.1 Technical Constraints

| Attribute | Requirement |
|-----------|-------------|
| Maximum Length | 80 characters |
| Minimum Recommended | 65 characters (1.5x more likely to sell) |
| Character Set | Alphanumeric, spaces, hyphens, commas |
| Case Style | Title Case (capitalise first letter of each word) |

### 2.2 Title Structure

**Recommended Format:**
```
[Condition] [Brand] [Product Name] [Model/Set Number] [Variant] [Key Features]
```

**Example for LEGO:**
```
NEW LEGO Star Wars Millennium Falcon 75192 Ultimate Collector Series UCS Sealed
```

### 2.3 Title Rules

**DO:**
- Use all 80 characters with relevant keywords
- Place the most important keywords at the start (Cassini reads left-to-right)
- Include brand, product name, model number, and key attributes
- Use natural, readable language
- Include item specifics that buyers commonly search for

**DO NOT:**
- Use ALL CAPS for entire words (except brand names where appropriate)
- Include special characters (*, !, +) for decoration
- Use keyword stuffing or repetition
- Include promotional text ("Best Price!", "Look!")
- Use acronyms unless widely recognised (NWT, NIB, OEM reduce sales)
- Include the word "New" if condition is set to New (redundant)

### 2.4 LEGO-Specific Title Template

```
[Condition] LEGO [Theme] [Set Name] [Set Number] [Piece Count] [Minifigures] [Status]
```

**Example:**
```
NEW LEGO Harry Potter Hogwarts Castle 71043 6020 Pieces 27 Minifigures Sealed
```

### 2.5 Subtitle (Optional)

| Attribute | Requirement |
|-----------|-------------|
| Maximum Length | 55 characters |
| Cost | Paid feature (~$1 per listing) |
| Benefit | 700% better conversion rate (per eBay data) |

Use subtitles for additional keywords or key selling points that don't fit in the title.

---

## 3. Item Specifics

### 3.1 Overview

Item specifics are name-value pairs that describe the item. They are critical for:
- Search visibility (buyers filter by item specifics)
- Matching to eBay's catalog
- External search engine indexing (Google, Bing)

### 3.2 Types of Item Specifics

| Type | Description | Action |
|------|-------------|--------|
| **Required** | Must be completed for listing to publish | Always populate |
| **Required Soon** | Will become required at a future date | Populate proactively |
| **Recommended** | Based on buyer demand and search trends | Populate when applicable |
| **Optional** | Additional descriptive fields | Populate when data available |

### 3.3 LEGO Category Item Specifics

For category **Building Toys > Building Toy Pieces & Accessories**:

| Item Specific | Required | Example Values |
|---------------|----------|----------------|
| Brand | Yes | LEGO |
| LEGO Theme | Yes | Star Wars, Harry Potter, City, Technic |
| LEGO Set Number | Yes | 75192, 71043, 10294 |
| Piece Count | Recommended | 7541, 6020, 2354 |
| Age Level | Recommended | 16+ Years, 8-11 Years, 12-15 Years |
| Features | Recommended | Includes Minifigure(s), Limited Edition |
| Character Family | Recommended | Star Wars, Marvel, DC Comics |
| Minifigure Count | Recommended | 4, 8, 27 |
| Item Type | Recommended | Set, Parts, Instructions |
| Packaging | Recommended | Original (Unopened), Original (Opened), None |
| MPN | Yes | Same as Set Number |
| UPC | Conditional | 12-digit barcode |
| EAN | Conditional | 13-digit barcode |

### 3.4 Retrieving Required Item Specifics

Use the eBay Taxonomy API's `getItemAspectsForCategory` method to retrieve current required item specifics for any category:

```
GET /commerce/taxonomy/v1/category_tree/{category_tree_id}/get_item_aspects_for_category?category_id={category_id}
```

### 3.5 Item Specifics Best Practices

1. **Never use "N/A" or "Does not apply"** for required fields when the actual value is known
2. **Use eBay's predefined values** when available (improves search matching)
3. **Be consistent** across listings for the same product type
4. **Update periodically** as eBay adds new required item specifics

---

## 4. Product Identifiers

### 4.1 Types of Product Identifiers

| Identifier | Format | Usage |
|------------|--------|-------|
| **UPC** | 12 digits | Universal Product Code (North America) |
| **EAN** | 13 digits | European Article Number |
| **ISBN** | 10 or 13 digits | Books only |
| **MPN** | Alphanumeric | Manufacturer Part Number |
| **Brand** | Text | Manufacturer/Brand name |
| **ePID** | Numeric | eBay Product ID (catalog reference) |

### 4.2 Requirements by Condition

| Condition | Brand | MPN | GTIN (UPC/EAN) |
|-----------|-------|-----|----------------|
| New | Required | Required | Required (if exists) |
| New Other | Required | Required | Required (if exists) |
| Manufacturer Refurbished | Required | Required | Required (if exists) |
| Seller Refurbished | Recommended | Recommended | Optional |
| Used | Recommended | Recommended | Optional |
| For Parts | Optional | Optional | Optional |

### 4.3 LEGO Product Identifier Mapping

| Inventory Field | eBay Field | Notes |
|-----------------|------------|-------|
| Set Number | MPN | e.g., "75192" |
| Barcode | UPC/EAN | From packaging |
| "LEGO" | Brand | Always "LEGO" |

### 4.4 When Product Identifiers Don't Apply

If the product genuinely has no identifier:
- Set the field to `"Does not apply"` (exact text)
- Only use this for truly unbranded, custom, or one-of-a-kind items
- **Never fabricate identifiers**

---

## 5. Item Condition

### 5.1 Condition Values

| Condition ID | Condition Enum | Display Name | Description |
|--------------|----------------|--------------|-------------|
| 1000 | NEW | New | Brand-new, unused, unopened, undamaged in original packaging |
| 1500 | NEW_OTHER | New other | New/unused with no signs of wear; may be missing original packaging |
| 1750 | NEW_WITH_DEFECTS | New with defects | New/unused with defects |
| 2000 | CERTIFIED_REFURBISHED | Certified - Refurbished | Pristine, like-new; refurbished by manufacturer |
| 2010 | EXCELLENT_REFURBISHED | Excellent - Refurbished | Like-new, backed by 1-year warranty |
| 2020 | VERY_GOOD_REFURBISHED | Very Good - Refurbished | Minimal wear, backed by 1-year warranty |
| 2030 | GOOD_REFURBISHED | Good - Refurbished | Shows wear, fully functional, backed by 1-year warranty |
| 2500 | SELLER_REFURBISHED | Seller refurbished | Restored to working order by seller |
| 3000 | USED_EXCELLENT | Used | Previously used, fully operational |
| 4000 | USED_VERY_GOOD | Used | Used with some cosmetic wear, fully operational |
| 5000 | USED_GOOD | Used | Used, functions as intended |
| 6000 | USED_ACCEPTABLE | Used | Used, may have significant wear |
| 7000 | FOR_PARTS_OR_NOT_WORKING | For parts or not working | Does not function as intended |

### 5.2 LEGO Condition Mapping

| Inventory Status | eBay Condition | Condition ID |
|------------------|----------------|--------------|
| Sealed/Factory Sealed | New | 1000 |
| Open Box Complete | New other | 1500 |
| Used Complete | Used | 3000 |
| Used Incomplete | Used | 4000-5000 |
| Parts Only | For parts or not working | 7000 |

### 5.3 Condition Description

For used items, always include a condition description explaining:
- Any signs of wear or damage
- Completeness (missing pieces, minifigures, instructions, box)
- Functionality status
- Storage history if relevant

---

## 6. Description

### 6.1 Technical Constraints

| Attribute | Requirement |
|-----------|-------------|
| Maximum Length | 500,000 characters (including HTML) |
| Mobile Display Limit | 800 characters (truncated) |
| Recommended Length | 200-500 words |
| Format | Plain text or limited HTML |

### 6.2 HTML Guidelines

**Allowed HTML:**
- Basic formatting: `<b>`, `<i>`, `<u>`, `<br>`, `<p>`
- Lists: `<ul>`, `<ol>`, `<li>`
- Line breaks: `<br/>` (counts as 50 characters for mobile)

**Prohibited:**
- JavaScript
- External CSS
- Forms
- iframes
- Active content

**Image Width Limit:** 700 pixels maximum for embedded images.

### 6.3 Mobile-Optimised Description

Use eBay's mobile-friendly tags:

```html
<div vocab="https://schema.org/" typeof="Product">
  <span property="description">
    Your mobile-friendly description (max 800 characters)
  </span>
</div>
Full desktop description here...
```

### 6.4 Description Structure

**Recommended Sections:**
1. **Product Overview** - What the item is
2. **What's Included** - Contents/components
3. **Condition Details** - Accurate condition description
4. **Specifications** - Technical details
5. **Shipping Information** - Handling time, packaging

### 6.5 LEGO Description Template

```markdown
## [Set Name] - [Set Number]

**Theme:** [Theme]
**Piece Count:** [Count]
**Minifigures:** [List]
**Recommended Age:** [Age]

### What's Included
- [Complete set / Partial set]
- [Instructions: Yes/No]
- [Original box: Yes/No]
- [All minifigures: Yes/No]

### Condition
[Detailed condition description]

### Specifications
- Dimensions: [Built dimensions]
- Release Year: [Year]
- Retired: [Yes/No]

### Shipping
Ships within [X] business days. Carefully packaged for safe delivery.
```

### 6.6 Description Best Practices

**DO:**
- Be accurate and honest about condition
- Use keywords naturally (improves search visibility)
- Include measurements and specifications
- Describe what's included and what's not
- Use clear, scannable formatting

**DO NOT:**
- Copy manufacturer descriptions without permission
- Include contact information or external links
- Use excessive formatting or special characters
- Make claims you can't verify
- Include shipping/payment/return info (use dedicated fields)

---

## 7. Images

### 7.1 Technical Requirements

| Attribute | Minimum | Recommended | Maximum |
|-----------|---------|-------------|---------|
| Dimensions | 500 × 500 px | 1600 × 1600 px | 9000 × 9000 px |
| File Size | - | 1-5 MB | 12 MB |
| Count | 1 | 8-12 | 24 |
| Format | JPEG, PNG, GIF, TIFF, BMP | JPEG | - |
| Aspect Ratio | Any | 1:1 (square) | - |

### 7.2 Primary Image Requirements

The first/primary image must:
- Show the main product clearly
- Have a clean background (white to light grey)
- Fill 80-90% of the image frame
- Represent the actual item being sold

### 7.3 Image Guidelines

**DO:**
- Use high-resolution images (1600px+ for zoom functionality)
- Show product from multiple angles (front, back, sides, top)
- Include close-up shots of important details
- Show any defects, wear, or damage clearly
- Use consistent lighting across all images
- Include scale reference where helpful

**DO NOT:**
- Use watermarks or text overlays
- Include borders or frames
- Use stock photos for used items
- Show items not included in the sale
- Use busy or distracting backgrounds
- Over-edit or misrepresent the item

### 7.4 LEGO Image Requirements

| Image | Content |
|-------|---------|
| 1 (Primary) | Box front OR built set (main angle) |
| 2 | Box back OR alternate angle |
| 3 | Contents/pieces overview |
| 4 | Minifigures close-up |
| 5 | Instructions (if included) |
| 6 | Box condition (if applicable) |
| 7-12 | Detail shots, any defects/wear |

### 7.5 Image Background

- Acceptable: White (#FFFFFF) to light grey (#DDDDDD)
- Light shadows: Allowed
- Mirror reflections: Not allowed
- Busy backgrounds: Not allowed

---

## 8. Pricing

### 8.1 Pricing Strategies

| Strategy | Use Case | Implementation |
|----------|----------|----------------|
| Fixed Price | Standard sales | Set single price |
| Auction | Rare/collectible items | Set starting price + optional reserve |
| Best Offer | Price negotiation | Enable with auto-accept/decline thresholds |

### 8.2 Best Offer Configuration

| Setting | Recommendation |
|---------|----------------|
| Enable Best Offer | Yes (for fixed price listings) |
| Auto-Accept | Set at minimum acceptable price |
| Auto-Decline | Set below cost threshold |

### 8.3 Pricing Best Practices

1. **Research competitor pricing** before setting prices
2. **Factor in all costs:** item cost, eBay fees, shipping, packaging
3. **Consider using psychological pricing** (£19.99 vs £20.00)
4. **Monitor and adjust** based on views and sales

### 8.4 eBay Fee Consideration

Build fees into pricing:
- **Final Value Fee:** 12.9% - 15% (varies by category)
- **Per Order Fee:** £0.30 (orders ≤£10) or £0.40 (orders >£10)
- **Insertion Fee:** Free for first allocation, then varies

---

## 9. Shipping Configuration

### 9.1 Shipping Options

| Type | Description | Recommendation |
|------|-------------|----------------|
| Free Shipping | Seller covers cost | Preferred (80%+ buyers prefer) |
| Flat Rate | Same cost regardless of location | Good for consistent items |
| Calculated | Based on package dimensions/weight | Best for heavy/variable items |

### 9.2 Handling Time

| Handling Time | Description | Recommendation |
|---------------|-------------|----------------|
| Same Day | Ship day of purchase (before cut-off) | Best for Top Rated status |
| 1 Business Day | Ship by end of next business day | Recommended minimum |
| 2 Business Days | Ship within 2 business days | Acceptable |
| 3+ Business Days | Ship within 3+ business days | May reduce visibility |

**Note:** Handling time is measured in business days (excludes weekends and holidays unless configured).

### 9.3 Package Specifications

| Field | Required | Notes |
|-------|----------|-------|
| Package Weight | Yes (for calculated) | Include packaging weight |
| Package Dimensions | Yes (for calculated) | Length × Width × Height |
| Package Type | Recommended | Box, Envelope, Tube, etc. |
| Irregular Package | If applicable | Non-rectangular packages |

### 9.4 Shipping Services (UK)

| Service | Speed | Use Case |
|---------|-------|----------|
| Royal Mail 2nd Class | 2-3 days | Economy |
| Royal Mail 1st Class | 1-2 days | Standard |
| Royal Mail Tracked 24 | Next day | Express |
| Hermes/Evri | 2-5 days | Economy large |
| DPD/DHL | 1-2 days | Express large |

### 9.5 International Shipping

Options:
- **eBay International Shipping:** eBay handles customs/shipping to international buyers
- **Global Shipping Program:** Similar to above
- **Direct International:** Seller manages international shipping

### 9.6 Shipping Best Practices

1. **Always use tracked shipping** (required for seller protection)
2. **Upload tracking within handling time** (automatic 5-star rating)
3. **Offer multiple shipping options** (economy and express)
4. **Build free shipping cost into item price** (increases visibility)

---

## 10. Return Policy

### 10.1 Return Policy Options

| Option | Description | Buyer Impact |
|--------|-------------|--------------|
| No Returns | Returns not accepted (except INAD) | Lowest buyer confidence |
| 14-day Buyer Paid | Buyer pays return shipping | Limited categories only |
| 30-day Buyer Paid | Buyer pays return shipping | Standard option |
| 30-day Free Returns | Seller pays return shipping | Increased buyer confidence |
| 60-day Buyer Paid | Extended return window | Good for gifts |
| 60-day Free Returns | Extended + seller-paid returns | Maximum buyer confidence |

### 10.2 Top Rated Plus Requirements

To qualify for Top Rated Plus status and final value fee discounts:
- **30-day (or longer) free returns** required
- **1-day (or shorter) handling time** required
- Money back option must be enabled

### 10.3 Return Policy Recommendations

| Seller Goal | Recommended Policy |
|-------------|-------------------|
| Maximise sales | 30-day free returns |
| Top Rated Plus status | 30-day free returns |
| Protect against abuse | 30-day buyer-paid |
| Gift season | 60-day free returns |

### 10.4 Partial Refund Options

With **free returns**, sellers can deduct up to 50% from refunds if:
- Item returned used/worn
- Item returned damaged
- Missing parts or accessories
- Tags removed

### 10.5 eBay Money Back Guarantee

**Always applies regardless of seller return policy:**
- Items not as described
- Items not received
- Buyers have 30 days from delivery to report issues

---

## 11. Category Selection

### 11.1 Category Importance

- Correct category ensures item appears in browsing and filtered searches
- Wrong category violates eBay policy and reduces visibility
- Each category has specific required item specifics

### 11.2 LEGO Categories

**Primary Categories:**

| Category ID | Path | Use For |
|-------------|------|---------|
| 183448 | Toys & Hobbies > Building Toys > LEGO Building Toys > LEGO Complete Sets & Packs | Complete sets |
| 183447 | Toys & Hobbies > Building Toys > LEGO Building Toys > LEGO Minifigures | Individual minifigures |
| 183449 | Toys & Hobbies > Building Toys > LEGO Building Toys > LEGO Pieces & Parts | Individual pieces/lots |
| 183450 | Toys & Hobbies > Building Toys > LEGO Building Toys > LEGO Instruction Manuals | Instructions only |

### 11.3 Category Selection Logic

```
IF item is complete set:
    category = "LEGO Complete Sets & Packs"
ELSE IF item is minifigure(s) only:
    category = "LEGO Minifigures"
ELSE IF item is loose pieces/parts:
    category = "LEGO Pieces & Parts"
ELSE IF item is instructions only:
    category = "LEGO Instruction Manuals"
```

### 11.4 Retrieving Categories

Use the eBay Taxonomy API:

```
GET /commerce/taxonomy/v1/category_tree/{category_tree_id}/get_category_suggestions?q={keywords}
```

---

## 12. Listing Format

### 12.1 Format Options

| Format | Duration | Best For |
|--------|----------|----------|
| Fixed Price | 30 days / Good 'Til Cancelled | Standard inventory |
| Auction | 1, 3, 5, 7, 10 days | Rare/unique items |
| Auction + Buy It Now | 1, 3, 5, 7, 10 days | Flexibility |

### 12.2 Good 'Til Cancelled (GTC)

- Auto-renews every 30 days until sold or cancelled
- Recommended for standard inventory
- Builds listing history and search ranking over time
- Insertion fees apply at each renewal

### 12.3 Auction Best Practices

- **Duration:** 7 or 10 days for maximum exposure
- **Start Price:** Low to attract bidders
- **Reserve Price:** Optional, protects minimum value
- **Buy It Now:** At least 30% above starting price

---

## 13. Business Policies

### 13.1 Policy Types

| Policy Type | Purpose |
|-------------|---------|
| Payment | Payment methods and terms |
| Shipping | Shipping services, costs, handling time |
| Return | Return acceptance, duration, cost responsibility |

### 13.2 Using Business Policies

Benefits:
- Apply consistent settings across multiple listings
- Bulk update listings by changing policy
- Required for certain listing tools and integrations

### 13.3 API Implementation

When creating listings via API, reference policy IDs:

```json
{
  "listingPolicies": {
    "fulfillmentPolicyId": "6196944000",
    "paymentPolicyId": "6196947000",
    "returnPolicyId": "6196949000"
  }
}
```

---

## 14. Validation Rules

### 14.1 Pre-Submission Validation

Before submitting a listing, validate:

| Check | Rule | Action if Failed |
|-------|------|------------------|
| Title Length | ≤ 80 characters | Truncate or error |
| Title Characters | No prohibited characters | Remove/replace |
| Required Item Specifics | All populated | Error - must complete |
| Product Identifiers | Valid format (UPC: 12 digits, EAN: 13 digits) | Error - correct format |
| Condition ID | Valid for category | Error - select valid |
| Description Length | ≤ 500,000 characters | Truncate |
| Image Count | ≥ 1 | Error - must have image |
| Image Dimensions | ≥ 500px on longest side | Resize or error |
| Price | > 0 | Error - must have price |
| Category | Valid leaf category | Error - select valid |
| Shipping | At least one service | Error - must configure |

### 14.2 Product Identifier Validation

**UPC Validation:**
- Must be exactly 12 digits
- Must pass check digit validation
- Format: `XXXXXXXXXXX C` (11 digits + check digit)

**EAN Validation:**
- Must be exactly 13 digits
- Must pass check digit validation
- Format: `XXXXXXXXXXXX C` (12 digits + check digit)

### 14.3 Title Validation

```python
def validate_title(title):
    errors = []
    
    # Length check
    if len(title) > 80:
        errors.append("Title exceeds 80 characters")
    
    # Prohibited patterns
    prohibited = ['!!!', '***', 'LOOK', 'WOW', 'L@@K', 'FREE']
    for pattern in prohibited:
        if pattern in title.upper():
            errors.append(f"Title contains prohibited pattern: {pattern}")
    
    # All caps check (more than 3 consecutive caps that aren't brand/model)
    # Implement as needed
    
    return errors
```

---

## 15. API Reference

### 15.1 Recommended APIs

| API | Purpose |
|-----|---------|
| **Inventory API** | Create and manage inventory items |
| **Taxonomy API** | Get categories and item aspects |
| **Metadata API** | Get policies, conditions, features |
| **Fulfillment API** | Manage orders and shipping |

### 15.2 Creating a Listing (Inventory API)

**Step 1: Create Inventory Item**
```
PUT /sell/inventory/v1/inventory_item/{sku}
```

**Step 2: Create Offer**
```
POST /sell/inventory/v1/offer
```

**Step 3: Publish Offer**
```
POST /sell/inventory/v1/offer/{offerId}/publish
```

### 15.3 Sample Inventory Item Payload

```json
{
  "availability": {
    "shipToLocationAvailability": {
      "quantity": 1
    }
  },
  "condition": "NEW",
  "conditionDescription": "Factory sealed, never opened.",
  "product": {
    "title": "NEW LEGO Star Wars Millennium Falcon 75192 Ultimate Collector Series UCS",
    "description": "<p>Complete LEGO Star Wars Millennium Falcon...</p>",
    "aspects": {
      "Brand": ["LEGO"],
      "LEGO Theme": ["Star Wars"],
      "LEGO Set Number": ["75192"],
      "Piece Count": ["7541"],
      "Age Level": ["16+ Years"],
      "MPN": ["75192"]
    },
    "imageUrls": [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    "upc": ["673419282970"]
  }
}
```

### 15.4 Sample Offer Payload

```json
{
  "sku": "LEGO-75192-001",
  "marketplaceId": "EBAY_GB",
  "format": "FIXED_PRICE",
  "availableQuantity": 1,
  "categoryId": "183448",
  "listingDescription": "...",
  "listingPolicies": {
    "fulfillmentPolicyId": "6196944000",
    "paymentPolicyId": "6196947000",
    "returnPolicyId": "6196949000"
  },
  "pricingSummary": {
    "price": {
      "currency": "GBP",
      "value": "649.99"
    }
  },
  "quantityLimitPerBuyer": 1
}
```

---

## Appendix A: Field Mapping Reference

### Inventory to eBay Field Mapping

| Inventory Field | eBay Field | Notes |
|-----------------|------------|-------|
| SKU | sku | Unique identifier |
| Name | product.title | Apply title formatting rules |
| Description | product.description / listingDescription | Apply HTML formatting |
| Set Number | product.aspects.MPN, product.aspects["LEGO Set Number"] | Duplicate to both fields |
| Theme | product.aspects["LEGO Theme"] | Use eBay's accepted values |
| Piece Count | product.aspects["Piece Count"] | Numeric string |
| Barcode | product.upc or product.ean | Validate format |
| Condition | condition | Map to eBay condition enum |
| Price | pricingSummary.price | Include currency |
| Quantity | availability.shipToLocationAvailability.quantity | Integer |
| Images | product.imageUrls | Array of URLs |
| Weight | packageWeightAndSize.weight | Include unit |
| Dimensions | packageWeightAndSize.dimensions | L×W×H with units |

---

## Appendix B: Condition Mapping Table

| Inventory Condition | eBay Condition ID | eBay Condition Enum |
|--------------------|-------------------|---------------------|
| Factory Sealed | 1000 | NEW |
| Sealed | 1000 | NEW |
| Open Box - Complete | 1500 | NEW_OTHER |
| Open Box - Like New | 1500 | NEW_OTHER |
| Used - Excellent | 3000 | USED_EXCELLENT |
| Used - Very Good | 4000 | USED_VERY_GOOD |
| Used - Good | 5000 | USED_GOOD |
| Used - Acceptable | 6000 | USED_ACCEPTABLE |
| Parts Only | 7000 | FOR_PARTS_OR_NOT_WORKING |
| Incomplete | 7000 | FOR_PARTS_OR_NOT_WORKING |

---

## Appendix C: Checklist

### Pre-Listing Checklist

- [ ] Title is 65-80 characters with key product details
- [ ] All required item specifics completed
- [ ] Product identifiers (UPC/EAN/MPN) added where applicable
- [ ] Correct condition selected with accurate description
- [ ] Description is accurate, complete, and mobile-friendly
- [ ] Minimum 8 high-quality images uploaded
- [ ] Images show actual item (not stock photos for used items)
- [ ] Price is competitive and accounts for fees
- [ ] Shipping configured with tracked service
- [ ] Handling time set to 1 day or same day
- [ ] Return policy configured (30-day free returns recommended)
- [ ] Correct category selected

---

## Document Information

**Sources:**
- eBay Seller Center (official documentation)
- eBay Developer Program API documentation
- eBay Help pages
- eBay Community forums (for practical insights)

**Compliance:**
This specification is based on eBay's current policies and guidelines as of January 2026. eBay may update requirements; refer to official documentation for the latest information.
