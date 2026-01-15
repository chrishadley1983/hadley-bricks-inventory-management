# eBay Listing Creation Feature Specification

## Hadley Bricks Inventory Application

**Document Version:** 1.0  
**Feature Name:** Create eBay Listing from Inventory  
**Author:** Business Analysis  
**Date:** January 2026  
**Status:** Draft for Development

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [User Stories](#2-user-stories)
3. [Functional Requirements](#3-functional-requirements)
4. [User Interface Specification](#4-user-interface-specification)
5. [Process Flow](#5-process-flow)
6. [AI Integration](#6-ai-integration)
7. [Data Models](#7-data-models)
8. [API Integration](#8-api-integration)
9. [Business Rules](#9-business-rules)
10. [Audit Logging](#10-audit-logging)
11. [Error Handling](#11-error-handling)
12. [Listing Quality Review](#12-listing-quality-review)
13. [Verification Steps](#13-verification-steps)
14. [Dependencies](#14-dependencies)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the requirements for a new feature enabling users to create eBay listings directly from inventory items within the Hadley Bricks Inventory Application. The feature leverages AI (Claude Opus 4.5) to generate optimised listing content following the eBay Listing Specification, with an independent AI reviewer (Gemini 3 Pro) providing quality scoring and improvement recommendations.

### 1.2 Scope

**In Scope:**
- Create eBay Listing modal triggered from inventory screen
- AI-powered listing content generation
- Photo upload and enhancement
- Listing template support
- Draft and live listing options
- Listing scheduling
- Progress tracking with success/failure feedback
- Inventory item status updates
- Comprehensive audit logging
- Independent AI quality review and scoring

**Out of Scope:**
- Bulk listing creation (future enhancement)
- Multi-marketplace support (UK eBay only)
- Existing Listing Assistant feature (remains separate)

### 1.3 Key Features

| Feature | Description |
|---------|-------------|
| One-Click Listing | Create eBay listing from inventory with minimal input |
| AI Content Generation | Intelligent title, description, and item specifics generation |
| Photo Enhancement | Automatic optimisation for eBay requirements |
| Template Support | Use saved templates or AI-generated descriptions |
| Flexible Publishing | Draft, immediate, or scheduled listing |
| Quality Assurance | Independent AI review with scoring and improvement tips |
| Full Auditability | Complete audit trail of all listing operations |

---

## 2. User Stories

### 2.1 Primary User Stories

#### US-001: Create Listing from Inventory
**As a** seller  
**I want to** create an eBay listing directly from an inventory item  
**So that** I can quickly list items for sale without re-entering data

**Acceptance Criteria:**
- [ ] "Create eBay Listing" button visible on inventory item screen
- [ ] Modal opens with inventory data pre-populated
- [ ] User can set listing price
- [ ] User can upload/select photos
- [ ] Listing is created on eBay successfully
- [ ] Inventory item status updated to "Listed"

#### US-002: AI-Generated Content
**As a** seller  
**I want** AI to generate optimised listing content  
**So that** my listings rank well in eBay search results

**Acceptance Criteria:**
- [ ] Title generated following 80-character best practices
- [ ] Description matches selected style (Minimalist/Standard/Professional/Friendly/Enthusiastic)
- [ ] Item specifics populated accurately from inventory and external sources
- [ ] Content adheres to eBay Listing Specification

#### US-003: Photo Enhancement
**As a** seller  
**I want** my photos automatically optimised for eBay  
**So that** they meet eBay's requirements and look professional

**Acceptance Criteria:**
- [ ] Photos adjusted for brightness, contrast, sharpness, and temperature
- [ ] Enhancement is optional (checkbox to enable/disable)
- [ ] Original photos preserved, enhanced versions used for listing

#### US-004: Template Support
**As a** seller  
**I want to** use my saved listing templates  
**So that** my listings have consistent branding and formatting

**Acceptance Criteria:**
- [ ] Dropdown to select from saved templates
- [ ] Option to generate description instead of using template
- [ ] Template placeholders replaced with actual inventory data

#### US-005: Listing Scheduling
**As a** seller  
**I want to** schedule when my listing goes live  
**So that** I can optimise for peak buying times

**Acceptance Criteria:**
- [ ] Date picker for selecting listing date
- [ ] Time picker for selecting listing time
- [ ] Scheduled listings created as drafts until scheduled time
- [ ] Background job publishes at scheduled time

#### US-006: Progress Feedback
**As a** seller  
**I want to** see progress as my listing is created  
**So that** I know what's happening and can identify any issues

**Acceptance Criteria:**
- [ ] Progress bar with step descriptions
- [ ] Success confirmation with link to new listing
- [ ] Clear error messages if something fails
- [ ] Options to retry or save as draft on failure

#### US-007: Quality Review
**As a** seller  
**I want** an independent review of my listing quality  
**So that** I can improve my listings over time

**Acceptance Criteria:**
- [ ] Quality score displayed (0-100)
- [ ] Specific improvement recommendations provided
- [ ] Review data stored for model training purposes

---

## 3. Functional Requirements

### 3.1 Feature Entry Point

| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| FR-001 | "Create eBay Listing" button displayed on inventory item detail screen | Must |
| FR-002 | Button only enabled for items not currently listed (status ≠ "Listed") | Must |
| FR-003 | Button click opens Create Listing Modal | Must |

### 3.2 Modal Functionality

| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| FR-010 | Modal pre-populates with inventory item data | Must |
| FR-011 | Listing Price field - required, numeric, GBP currency | Must |
| FR-012 | Photo upload area - supports drag & drop and file selection | Must |
| FR-013 | Photo upload accepts JPEG, PNG formats | Must |
| FR-014 | Maximum 12 photos can be uploaded | Must |
| FR-015 | Description Style dropdown with 5 options | Must |
| FR-016 | Listing Template dropdown (saved templates + "Generate" option) | Must |
| FR-017 | "Optimise photos for eBay" checkbox | Must |
| FR-018 | Listing Type radio: "Draft" or "Live Listing" | Must |
| FR-019 | Schedule Listing toggle with date/time picker | Should |
| FR-020 | Best Offer configuration section | Must |
| FR-021 | Submit button initiates listing creation | Must |
| FR-022 | Cancel button closes modal without action | Must |

### 3.3 Best Offer Configuration

| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| FR-030 | Best Offer always enabled by default | Must |
| FR-031 | Auto-Accept threshold field (% of listing price) | Must |
| FR-032 | Auto-Decline threshold field (% of listing price) | Must |
| FR-033 | Default Auto-Accept: 95% | Should |
| FR-034 | Default Auto-Decline: 75% | Should |
| FR-035 | Thresholds configurable in application settings | Should |

### 3.4 Listing Creation Process

| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| FR-040 | Validate all required fields before submission | Must |
| FR-041 | Display progress bar during processing | Must |
| FR-042 | AI generates listing content using Opus 4.5 | Must |
| FR-043 | AI performs grounded search to external sources (Bricklink, Brickset) | Must |
| FR-044 | Retrieve eBay business policies via API | Must |
| FR-045 | Apply small parcel shipping as default | Must |
| FR-046 | Upload photos to eBay (enhanced if option selected) | Must |
| FR-047 | Create listing via eBay Inventory API | Must |
| FR-048 | Display success message with eBay listing link | Must |
| FR-049 | Update inventory item with listing details | Must |
| FR-050 | Record all actions in audit tables | Must |
| FR-051 | Trigger independent quality review | Must |

### 3.5 Inventory Updates

| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| FR-060 | Update inventory item status to "Listed" | Must |
| FR-061 | Store eBay listing ID on inventory item | Must |
| FR-062 | Store listing date on inventory item | Must |
| FR-063 | Store listing price on inventory item | Must |
| FR-064 | Store eBay listing URL on inventory item | Should |

---

## 4. User Interface Specification

### 4.1 Inventory Screen Button

**Location:** Inventory item detail screen, action bar  
**Label:** "Create eBay Listing"  
**Icon:** eBay logo or shopping cart icon  
**State:**
- Enabled: Item status is not "Listed"
- Disabled: Item status is "Listed" (with tooltip: "Item already listed on eBay")

### 4.2 Create eBay Listing Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Create eBay Listing                                                    [X] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Item: [Set Name] - [Set Number]                          [View Inventory]  │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  PRICING                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Listing Price (£) *          │ [____________]                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ☑ Enable Best Offer                                                 │   │
│  │   Auto-Accept at [95]% (£XX.XX)    Auto-Decline below [75]% (£XX.XX)│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  PHOTOS                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────────────────────┐   │   │
│  │  │ IMG │ │ IMG │ │ IMG │ │ IMG │ │  +  │ │   Drag & drop or    │   │   │
│  │  │  1  │ │  2  │ │  3  │ │  4  │ │ Add │ │   click to upload   │   │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────────────────────┘   │   │
│  │                                                                     │   │
│  │  ☑ Optimise photos for eBay (brightness, contrast, sharpness)      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  LISTING CONTENT                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Description Style    │ [Minimalist                          ▼]     │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Listing Template     │ [Generate with AI                    ▼]     │   │
│  │                      │  ○ Generate with AI                          │   │
│  │                      │  ─────────────────                          │   │
│  │                      │  ○ New LEGO                                  │   │
│  │                      │  ○ Used LEGO                                 │   │
│  │                      │  ○ Minifigures                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  PUBLISHING OPTIONS                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ (•) Create as Draft     ( ) Publish Live                            │   │
│  │                                                                     │   │
│  │ ☐ Schedule Listing                                                  │   │
│  │   Date: [DD/MM/YYYY]  Time: [HH:MM]                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│                                          [Cancel]    [Create Listing]       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Description Style Options

| Option | Description | Tone |
|--------|-------------|------|
| Minimalist | Clean, concise, just the facts | Factual, brief |
| Standard | Balanced, informative, professional | Neutral, complete |
| Professional | Formal, detailed, business-like | Formal, thorough |
| Friendly | Warm, approachable, conversational | Casual, welcoming |
| Enthusiastic | Energetic, exciting, persuasive | Excited, sales-focused |

### 4.4 Progress Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Creating eBay Listing                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░  45%                             │
│                                                                             │
│  ✓ Validating inventory data                                                │
│  ✓ Researching product information                                          │
│  ● Generating listing content...                                            │
│  ○ Uploading images                                                         │
│  ○ Creating eBay listing                                                    │
│  ○ Updating inventory record                                                │
│  ○ Recording audit trail                                                    │
│  ○ Quality review                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Success Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ✓ Listing Created Successfully                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Your eBay listing has been created!                                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LEGO Star Wars Millennium Falcon 75192 Ultimate Collector UCS New   │   │
│  │ Price: £649.99                                                      │   │
│  │ Status: Draft / Live / Scheduled for 20/01/2026 19:00               │   │
│  │                                                                     │   │
│  │ [View on eBay ↗]                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  QUALITY REVIEW                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  Listing Score: 87/100  ████████████████████░░░                    │   │
│  │                                                                     │   │
│  │  Recommendations:                                                   │   │
│  │  • Consider adding 2 more photos showing box condition              │   │
│  │  • Title could include "Sealed" for better search visibility        │   │
│  │  • Add piece count to item specifics                                │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                                                              [Close]        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Error Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ✗ Listing Creation Failed                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  There was a problem creating your eBay listing.                            │
│                                                                             │
│  Error: [Specific error message from process]                               │
│                                                                             │
│  Step Failed: Uploading images                                              │
│                                                                             │
│  What would you like to do?                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [Retry]           Attempt the process again                         │   │
│  │ [Edit & Retry]    Return to form to make changes                    │   │
│  │ [Save as Draft]   Save listing data locally for later               │   │
│  │ [Cancel]          Discard and close                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Process Flow

### 5.1 High-Level Process Flow

```
┌──────────────────┐
│ User clicks      │
│ "Create eBay     │
│ Listing" button  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Display Create   │
│ Listing Modal    │
│ (pre-populated)  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ User enters:     │
│ • Price          │
│ • Photos         │
│ • Options        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ User clicks      │────▶│ Validate inputs  │
│ "Create Listing" │     │                  │
└──────────────────┘     └────────┬─────────┘
                                  │
                         ┌────────┴────────┐
                         │ Valid?          │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │ No                        │ Yes
                    ▼                           ▼
         ┌──────────────────┐        ┌──────────────────┐
         │ Display          │        │ Show Progress    │
         │ Validation       │        │ Modal            │
         │ Errors           │        └────────┬─────────┘
         └──────────────────┘                 │
                                              ▼
                                   ┌──────────────────┐
                                   │ STEP 1:          │
                                   │ Validate         │
                                   │ Inventory Data   │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 2:          │
                                   │ Research Product │
                                   │ (Bricklink etc)  │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 3:          │
                                   │ Retrieve eBay    │
                                   │ Business Policies│
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 4:          │
                                   │ AI Generate      │
                                   │ Listing Content  │
                                   │ (Opus 4.5)       │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 5:          │
                                   │ Enhance & Upload │
                                   │ Images           │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 6:          │
                                   │ Create eBay      │
                                   │ Listing via API  │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 7:          │
                                   │ Update Inventory │
                                   │ Item             │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 8:          │
                                   │ Record Audit     │
                                   │ Trail            │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ STEP 9:          │
                                   │ Quality Review   │
                                   │ (Gemini 3 Pro)   │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ Display Success  │
                                   │ Modal with       │
                                   │ Quality Score    │
                                   └──────────────────┘
```

### 5.2 Detailed Step Descriptions

#### Step 1: Validate Inventory Data
- Verify inventory item exists and has required fields
- Check item is not already listed (status ≠ "Listed")
- Validate set number format
- Ensure condition is set

#### Step 2: Research Product Information
- Query Bricklink API for set details (piece count, minifigures, year, retired status)
- Query Brickset API for additional details if needed
- Retrieve eBay sold listings data for pricing context (optional)
- Cache results to avoid repeated lookups

#### Step 3: Retrieve eBay Business Policies
- Call eBay Account API to get seller's fulfillment policies
- Call eBay Account API to get seller's payment policies
- Call eBay Account API to get seller's return policies
- Identify "small parcel" shipping policy as default
- Store policies locally for session use

#### Step 4: AI Generate Listing Content
- Construct prompt with:
  - Inventory item data
  - Research results
  - Selected description style
  - Template (if selected)
  - eBay Listing Specification
  - Uploaded photos for analysis
- Call Claude Opus 4.5 API
- Parse response for:
  - Title (max 80 characters)
  - Description (HTML formatted)
  - Item specifics
  - Category suggestion
- Validate generated content against specification

#### Step 5: Enhance & Upload Images
- If "Optimise for eBay" selected:
  - Apply brightness adjustment
  - Apply contrast enhancement
  - Apply sharpness filter
  - Apply temperature correction
  - Ensure minimum 500px dimension
  - Convert to JPEG if needed
- Upload each image to eBay via API
- Store returned image URLs

#### Step 6: Create eBay Listing via API
- Construct inventory item payload
- Create inventory item (PUT /inventory_item/{sku})
- Construct offer payload with:
  - Price
  - Best Offer settings
  - Business policy IDs
  - Category
  - Item specifics
  - Images
- Create offer (POST /offer)
- If "Publish Live" selected:
  - Publish offer (POST /offer/{offerId}/publish)
- If "Schedule" selected:
  - Create scheduled job for publish at specified time

#### Step 7: Update Inventory Item
- Update inventory record:
  - `status` = "Listed"
  - `ebay_listing_id` = [eBay listing ID]
  - `ebay_listing_url` = [eBay item URL]
  - `listing_date` = [current timestamp]
  - `listing_price` = [user entered price]

#### Step 8: Record Audit Trail
- Create audit record for listing creation
- Include all relevant metadata
- Link to inventory item and eBay listing

#### Step 9: Quality Review
- Construct review prompt with:
  - Generated listing (title, description, item specifics, images)
  - eBay Listing Specification
  - Inventory item data
- Call Gemini 2.5 Pro API
- Parse response for:
  - Quality score (0-100)
  - Improvement recommendations
- Store review results for training purposes

---

## 6. AI Integration

### 6.1 Listing Generation AI (Claude Opus 4.5)

#### 6.1.1 Purpose
Generate optimised eBay listing content from inventory data, following the eBay Listing Specification.

#### 6.1.2 Input Context

The AI must be provided with:

1. **eBay Listing Specification** (full markdown document)
2. **Inventory Item Data:**
   - Set Number
   - Set Name
   - Theme
   - Year
   - Condition
   - Box Condition
   - Notes/Key Points
   - Piece Count (if known)
   - Minifigure List (if known)
3. **User Selections:**
   - Description Style
   - Listing Template (if selected)
   - Listing Price
4. **Research Data:**
   - Bricklink product data
   - Brickset product data
   - eBay category data
5. **Photos:**
   - Uploaded images for visual analysis

#### 6.1.3 Prompt Structure

```markdown
You are an eBay listing specialist for Hadley Bricks, a LEGO resale business. 
Generate an optimised eBay listing following the provided specification.

## Reference Document
[Insert eBay Listing Specification markdown]

## Inventory Item
- Set Number: {set_number}
- Set Name: {set_name}
- Theme: {theme}
- Year: {year}
- Condition: {condition}
- Box Condition: {box_condition}
- Notes: {notes}

## Research Data
### Bricklink Data
- Piece Count: {piece_count}
- Minifigures: {minifigures}
- Retired: {retired}
- RRP: {rrp}

### Brickset Data
- Additional details...

## User Requirements
- Description Style: {style} ({style_description})
- Listing Price: £{price}
- Template: {template_content OR "Generate description"}

## Attached Photos
[{photo_count} photos attached for analysis - assess condition from photos]

## Instructions
1. Generate a listing title (max 80 characters) following specification rules
2. Generate item specifics using eBay's required fields for LEGO category
3. Generate description in the requested style
4. If template provided, use it as base and fill placeholders
5. Suggest the most appropriate eBay category ID
6. Identify any missing information that should be added

## Output Format
Respond in JSON format:
{
  "title": "...",
  "category_id": "...",
  "item_specifics": {
    "Brand": "LEGO",
    "LEGO Theme": "...",
    "LEGO Set Number": "...",
    ...
  },
  "description_html": "...",
  "condition_id": ...,
  "condition_description": "...",
  "recommendations": ["...", "..."],
  "confidence_score": 0-100
}
```

#### 6.1.4 Expected Output

```json
{
  "title": "NEW LEGO Star Wars Millennium Falcon 75192 Ultimate Collector Series UCS",
  "category_id": "183448",
  "item_specifics": {
    "Brand": "LEGO",
    "LEGO Theme": "Star Wars",
    "LEGO Set Number": "75192",
    "Piece Count": "7541",
    "Age Level": "16+ Years",
    "Features": "Includes Minifigure(s)",
    "Character Family": "Star Wars",
    "MPN": "75192",
    "Year": "2017",
    "Packaging": "Original (Unopened)"
  },
  "description_html": "<p><strong>Set Number:</strong> 75192</p>...",
  "condition_id": 1000,
  "condition_description": "Brand new, factory sealed in original packaging.",
  "recommendations": [
    "Consider adding minifigure names to description",
    "Could mention retirement status for collector appeal"
  ],
  "confidence_score": 95
}
```

### 6.2 Quality Review AI (Gemini 3 Pro)

#### 6.2.1 Purpose
Provide independent quality assessment of generated listings, producing a score and improvement recommendations for training purposes.

#### 6.2.2 Input Context

1. **eBay Listing Specification** (full markdown document)
2. **Generated Listing:**
   - Title
   - Description
   - Item Specifics
   - Images (URLs)
   - Category
   - Price
3. **Original Inventory Data** (for accuracy verification)

#### 6.2.3 Prompt Structure

```markdown
You are an independent eBay listing quality reviewer. Evaluate the provided 
listing against the eBay Listing Specification and provide a quality score 
with improvement recommendations.

## eBay Listing Specification
[Insert eBay Listing Specification markdown]

## Listing to Review

### Title
{title}

### Category
{category_id} - {category_name}

### Item Specifics
{item_specifics_json}

### Description
{description_html}

### Condition
{condition_id} - {condition_description}

### Price
£{price} (Best Offer enabled: Accept at {accept}%, Decline below {decline}%)

### Images
{image_count} images provided
{image_urls}

## Original Inventory Data
{inventory_data}

## Evaluation Criteria
Score each area 0-100 and provide specific feedback:

1. **Title Quality (20%)** - Length, keywords, structure, readability
2. **Item Specifics (20%)** - Completeness, accuracy, required fields
3. **Description Quality (20%)** - Style adherence, completeness, formatting
4. **Image Assessment (20%)** - Quantity, quality indicators, coverage
5. **Pricing & Policies (10%)** - Best Offer configuration appropriateness
6. **Specification Compliance (10%)** - Overall adherence to specification

## Output Format
{
  "overall_score": 0-100,
  "category_scores": {
    "title": {"score": 0-100, "feedback": "..."},
    "item_specifics": {"score": 0-100, "feedback": "..."},
    "description": {"score": 0-100, "feedback": "..."},
    "images": {"score": 0-100, "feedback": "..."},
    "pricing": {"score": 0-100, "feedback": "..."},
    "compliance": {"score": 0-100, "feedback": "..."}
  },
  "top_recommendations": ["...", "...", "..."],
  "critical_issues": ["..."] // Empty if none
}
```

#### 6.2.4 Expected Output

```json
{
  "overall_score": 87,
  "category_scores": {
    "title": {
      "score": 92,
      "feedback": "Good use of keywords and structure. 76 characters used effectively. Could include 'Sealed' for additional search visibility."
    },
    "item_specifics": {
      "score": 85,
      "feedback": "All required fields populated. Missing minifigure count which is a recommended field for this category."
    },
    "description": {
      "score": 88,
      "feedback": "Clean minimalist style as requested. Good structure. Consider adding dimensions for collector interest."
    },
    "images": {
      "score": 80,
      "feedback": "4 images uploaded, recommend 8-12 for optimal engagement. Should include close-up of seal/box condition."
    },
    "pricing": {
      "score": 95,
      "feedback": "Best Offer thresholds well configured. Price competitive based on condition."
    },
    "compliance": {
      "score": 85,
      "feedback": "Strong adherence to specification. Minor opportunities for optimisation noted."
    }
  },
  "top_recommendations": [
    "Add 'Sealed' to title for better search visibility",
    "Include 2-4 more photos showing box condition and seals",
    "Add minifigure count (7) to item specifics"
  ],
  "critical_issues": []
}
```

### 6.3 Photo Enhancement

#### 6.3.1 Enhancement Operations

Replicate existing "Optimise for eBay" functionality from Image Studio:

| Operation | Description | Parameters |
|-----------|-------------|------------|
| Brightness | Adjust overall brightness | Auto-level or +10-15% |
| Contrast | Enhance contrast for clarity | Auto-level or +10% |
| Sharpness | Apply sharpening filter | Unsharp mask, amount: 50-100 |
| Temperature | Correct colour temperature | Auto white balance |

#### 6.3.2 Implementation Reference

The enhancement logic should be copied from the existing `ImageStudio` component's "Optimise for eBay" functionality. Refer to the existing implementation for exact parameter values and processing order.

---

## 7. Data Models

### 7.1 Database Schema Updates

#### 7.1.1 Inventory Item Table Updates

```sql
-- Add new columns to inventory_items table
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ebay_listing_id VARCHAR(50);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ebay_listing_url VARCHAR(500);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS listing_date TIMESTAMP;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS listing_price DECIMAL(10,2);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS listing_status VARCHAR(20);

-- Index for listing queries
CREATE INDEX IF NOT EXISTS idx_inventory_ebay_listing ON inventory_items(ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_inventory_listing_status ON inventory_items(listing_status);
```

#### 7.1.2 eBay Business Policies Cache Table

```sql
CREATE TABLE IF NOT EXISTS ebay_business_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type VARCHAR(20) NOT NULL, -- 'fulfillment', 'payment', 'return'
  policy_id VARCHAR(50) NOT NULL,
  policy_name VARCHAR(200) NOT NULL,
  policy_data JSONB NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(policy_type, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_ebay_policies_type ON ebay_business_policies(policy_type);
CREATE INDEX IF NOT EXISTS idx_ebay_policies_default ON ebay_business_policies(is_default);
```

#### 7.1.3 Listing Templates Table (if not exists)

```sql
CREATE TABLE IF NOT EXISTS listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'New LEGO', 'Used LEGO', etc.
  content_html TEXT NOT NULL,
  placeholders JSONB, -- List of placeholders used
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 7.1.4 Listing Creation Audit Table

```sql
CREATE TABLE IF NOT EXISTS listing_creation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  ebay_listing_id VARCHAR(50),
  action VARCHAR(50) NOT NULL, -- 'CREATED', 'DRAFT_CREATED', 'SCHEDULED', 'FAILED'
  status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILURE', 'PENDING'
  listing_price DECIMAL(10,2),
  
  -- User selections
  description_style VARCHAR(50),
  template_id UUID REFERENCES listing_templates(id),
  photos_enhanced BOOLEAN,
  listing_type VARCHAR(20), -- 'DRAFT', 'LIVE', 'SCHEDULED'
  scheduled_date TIMESTAMP,
  
  -- Generated content
  generated_title VARCHAR(100),
  generated_description TEXT,
  item_specifics JSONB,
  category_id VARCHAR(20),
  
  -- AI metadata
  ai_model_used VARCHAR(50),
  ai_confidence_score INTEGER,
  ai_recommendations JSONB,
  
  -- Quality review
  quality_score INTEGER,
  quality_feedback JSONB,
  
  -- Error tracking
  error_message TEXT,
  error_step VARCHAR(50),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  -- User
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_listing_audit_inventory ON listing_creation_audit(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_listing_audit_ebay ON listing_creation_audit(ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_audit_status ON listing_creation_audit(status);
CREATE INDEX IF NOT EXISTS idx_listing_audit_date ON listing_creation_audit(created_at);
```

#### 7.1.5 Listing Scheduled Jobs Table

```sql
CREATE TABLE IF NOT EXISTS listing_scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES listing_creation_audit(id),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  ebay_offer_id VARCHAR(50) NOT NULL,
  scheduled_publish_date TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_date ON listing_scheduled_jobs(scheduled_publish_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON listing_scheduled_jobs(status);
```

#### 7.1.6 Local Draft Storage Table

```sql
CREATE TABLE IF NOT EXISTS listing_local_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  draft_data JSONB NOT NULL, -- Complete form state
  error_context JSONB, -- Error that caused save as draft
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 7.2 TypeScript Interfaces

```typescript
// Types for listing creation feature

interface ListingCreationRequest {
  inventoryItemId: string;
  listingPrice: number;
  photos: File[];
  descriptionStyle: DescriptionStyle;
  templateId: string | null; // null = generate with AI
  optimisePhotos: boolean;
  listingType: ListingType;
  scheduledDate?: Date;
  bestOffer: BestOfferConfig;
}

type DescriptionStyle = 
  | 'minimalist' 
  | 'standard' 
  | 'professional' 
  | 'friendly' 
  | 'enthusiastic';

type ListingType = 'draft' | 'live' | 'scheduled';

interface BestOfferConfig {
  enabled: boolean; // Always true by default
  autoAcceptPercent: number; // Default 95
  autoDeclinePercent: number; // Default 75
}

interface ListingCreationProgress {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  stepStatus: 'pending' | 'processing' | 'complete' | 'error';
  percentComplete: number;
}

interface ListingCreationResult {
  success: boolean;
  ebayListingId?: string;
  ebayListingUrl?: string;
  title?: string;
  status?: 'draft' | 'live' | 'scheduled';
  scheduledDate?: Date;
  qualityReview?: QualityReviewResult;
  error?: ListingCreationError;
}

interface ListingCreationError {
  step: string;
  message: string;
  details?: string;
  recoverable: boolean;
}

interface QualityReviewResult {
  overallScore: number;
  categoryScores: {
    title: CategoryScore;
    itemSpecifics: CategoryScore;
    description: CategoryScore;
    images: CategoryScore;
    pricing: CategoryScore;
    compliance: CategoryScore;
  };
  topRecommendations: string[];
  criticalIssues: string[];
}

interface CategoryScore {
  score: number;
  feedback: string;
}

interface AIGeneratedListing {
  title: string;
  categoryId: string;
  itemSpecifics: Record<string, string>;
  descriptionHtml: string;
  conditionId: number;
  conditionDescription: string;
  recommendations: string[];
  confidenceScore: number;
}

interface EbayBusinessPolicy {
  id: string;
  policyType: 'fulfillment' | 'payment' | 'return';
  policyId: string;
  policyName: string;
  policyData: Record<string, any>;
  isDefault: boolean;
}

interface ListingTemplate {
  id: string;
  name: string;
  type: string;
  contentHtml: string;
  placeholders: string[];
  isActive: boolean;
}

interface InventoryItemListingUpdate {
  status: 'Listed';
  ebayListingId: string;
  ebayListingUrl: string;
  listingDate: Date;
  listingPrice: number;
}
```

---

## 8. API Integration

### 8.1 eBay API Endpoints

#### 8.1.1 Business Policies Retrieval

**Fulfillment Policies:**
```
GET /sell/account/v1/fulfillment_policy
Authorization: Bearer {access_token}
```

**Payment Policies:**
```
GET /sell/account/v1/payment_policy
Authorization: Bearer {access_token}
```

**Return Policies:**
```
GET /sell/account/v1/return_policy
Authorization: Bearer {access_token}
```

#### 8.1.2 Category and Taxonomy

**Get Category Suggestions:**
```
GET /commerce/taxonomy/v1/category_tree/3/get_category_suggestions?q={keywords}
Authorization: Bearer {access_token}
```

**Get Item Aspects for Category:**
```
GET /commerce/taxonomy/v1/category_tree/3/get_item_aspects_for_category?category_id={category_id}
Authorization: Bearer {access_token}
```

#### 8.1.3 Inventory and Listing

**Create/Update Inventory Item:**
```
PUT /sell/inventory/v1/inventory_item/{sku}
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "availability": {
    "shipToLocationAvailability": {
      "quantity": 1
    }
  },
  "condition": "NEW",
  "conditionDescription": "...",
  "product": {
    "title": "...",
    "description": "...",
    "aspects": {...},
    "imageUrls": [...]
  }
}
```

**Create Offer:**
```
POST /sell/inventory/v1/offer
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "sku": "...",
  "marketplaceId": "EBAY_GB",
  "format": "FIXED_PRICE",
  "availableQuantity": 1,
  "categoryId": "...",
  "listingPolicies": {
    "fulfillmentPolicyId": "...",
    "paymentPolicyId": "...",
    "returnPolicyId": "..."
  },
  "pricingSummary": {
    "price": {
      "currency": "GBP",
      "value": "..."
    },
    "bestOfferEnabled": true,
    "autoAcceptPrice": {...},
    "minimumAdvertisedPrice": {...}
  }
}
```

**Publish Offer:**
```
POST /sell/inventory/v1/offer/{offerId}/publish
Authorization: Bearer {access_token}
```

### 8.2 External Data Sources

#### 8.2.1 Bricklink Integration

Use web search or existing Bricklink integration to retrieve:
- Piece count
- Minifigure list
- Year released
- Retired status
- Dimensions
- Weight

#### 8.2.2 Brickset Integration

Use web search or existing Brickset integration to retrieve:
- Additional set details
- Theme information
- Subtheme
- Availability status

### 8.3 AI API Calls

#### 8.3.1 Claude Opus 4.5 (Listing Generation)

```typescript
const response = await anthropic.messages.create({
  model: "claude-opus-4-5-20250514",
  max_tokens: 4096,
  messages: [{
    role: "user",
    content: constructListingPrompt(inventoryItem, research, options)
  }]
});
```

#### 8.3.2 Gemini 3 Pro (Quality Review)

```typescript
const response = await googleAI.generateContent({
  model: "gemini-3-pro",
  contents: [{
    role: "user",
    parts: [{ text: constructReviewPrompt(listing, specification) }]
  }]
});
```

---

## 9. Business Rules

### 9.1 Listing Creation Rules

| Rule ID | Rule | Enforcement |
|---------|------|-------------|
| BR-001 | Listing price must be greater than £0.01 | Validation |
| BR-002 | At least 1 photo is required | Validation |
| BR-003 | Maximum 12 photos allowed | Validation |
| BR-004 | Best Offer is always enabled | System default |
| BR-005 | Auto-Accept must be > Auto-Decline | Validation |
| BR-006 | Scheduled date must be in the future | Validation |
| BR-007 | Item cannot be listed if already listed | Button disabled |
| BR-008 | Small parcel shipping is default | System default |
| BR-009 | Title cannot exceed 80 characters | AI constraint |
| BR-010 | Photos must be JPEG or PNG | Validation |

### 9.2 Default Values

| Setting | Default Value | Configurable |
|---------|---------------|--------------|
| Best Offer Enabled | true | No |
| Auto-Accept Threshold | 95% | Yes (App Settings) |
| Auto-Decline Threshold | 75% | Yes (App Settings) |
| Shipping Policy | Small Parcel (from eBay) | Yes (per listing) |
| Return Policy | From eBay defaults | Yes (per listing) |
| Description Style | Standard | Yes (per listing) |
| Photo Enhancement | Enabled | Yes (per listing) |
| Listing Type | Draft | Yes (per listing) |

### 9.3 Status Transitions

```
Inventory Item Status Flow:

  [Available] ──────────────────────┐
       │                            │
       │ Create Listing             │ Listing Fails
       ▼                            │
  [Listed] ◄────────────────────────┘
       │
       │ Listing Ends/Sold
       ▼
  [Sold] / [Ended]
```

---

## 10. Audit Logging

### 10.1 Audit Events

| Event | Description | Logged Data |
|-------|-------------|-------------|
| LISTING_STARTED | User initiated listing creation | inventory_item_id, user_id, options |
| RESEARCH_COMPLETED | External data lookup finished | sources_queried, data_retrieved |
| POLICIES_RETRIEVED | eBay policies fetched | policy_ids |
| CONTENT_GENERATED | AI generated listing content | title, description_preview, ai_model |
| PHOTOS_UPLOADED | Images uploaded to eBay | photo_count, enhanced |
| LISTING_CREATED | eBay listing created | ebay_listing_id, status |
| INVENTORY_UPDATED | Inventory item updated | field_changes |
| QUALITY_REVIEWED | Review completed | score, recommendations |
| LISTING_FAILED | Error occurred | error_step, error_message |
| DRAFT_SAVED | Saved locally after failure | draft_id |

### 10.2 Audit Record Structure

```json
{
  "id": "uuid",
  "event_type": "LISTING_CREATED",
  "timestamp": "2026-01-15T14:30:00Z",
  "inventory_item_id": "uuid",
  "ebay_listing_id": "123456789",
  "user_id": "uuid",
  "details": {
    "listing_price": 649.99,
    "description_style": "minimalist",
    "template_used": null,
    "photos_count": 6,
    "photos_enhanced": true,
    "listing_type": "live",
    "ai_confidence_score": 95,
    "quality_score": 87
  },
  "duration_ms": 12500
}
```

### 10.3 Retention Policy

- Audit records retained for 2 years minimum
- Quality review data retained indefinitely for training purposes
- Failed listing attempts retained for 90 days

---

## 11. Error Handling

### 11.1 Error Categories

| Category | Examples | Recovery Options |
|----------|----------|------------------|
| Validation | Missing price, invalid photo format | Edit & Retry |
| API - eBay | Auth expired, rate limit, service unavailable | Retry, Save as Draft |
| API - External | Bricklink unavailable | Proceed without data |
| AI - Generation | Model unavailable, invalid response | Retry, Save as Draft |
| AI - Review | Model unavailable | Skip review, continue |
| System | Database error, file system error | Retry, Save as Draft |

### 11.2 Error Recovery Matrix

| Error Type | Retry | Edit & Retry | Save Draft | Cancel |
|------------|-------|--------------|------------|--------|
| Validation Error | ❌ | ✅ | ❌ | ✅ |
| eBay Auth Error | ✅ | ❌ | ✅ | ✅ |
| eBay Rate Limit | ✅ (with delay) | ❌ | ✅ | ✅ |
| eBay Service Down | ✅ | ❌ | ✅ | ✅ |
| External API Down | ✅ | ❌ | ✅ | ✅ |
| AI Generation Fail | ✅ | ✅ | ✅ | ✅ |
| AI Review Fail | Skip | Skip | Skip | ✅ |
| Photo Upload Fail | ✅ | ✅ | ✅ | ✅ |
| Database Error | ✅ | ❌ | ❌ | ✅ |

### 11.3 Error Messages

User-friendly error messages should be displayed:

| Error Code | User Message |
|------------|--------------|
| EBAY_AUTH_EXPIRED | "Your eBay connection has expired. Please reconnect in Settings." |
| EBAY_RATE_LIMIT | "eBay is temporarily busy. Please wait a moment and try again." |
| EBAY_SERVICE_DOWN | "eBay services are currently unavailable. Please try again later." |
| PHOTO_UPLOAD_FAILED | "Failed to upload one or more photos. Please check the images and try again." |
| AI_GENERATION_FAILED | "Unable to generate listing content. Please try again." |
| INVALID_CATEGORY | "Could not determine the correct eBay category. Please try again." |

---

## 12. Listing Quality Review

### 12.1 Purpose

The independent AI review serves two purposes:
1. **User Feedback:** Provide actionable recommendations to improve listing quality
2. **Model Training:** Collect data to refine the listing generation model over time

### 12.2 Review Process

1. Triggered automatically after successful listing creation
2. Runs asynchronously (does not block success display)
3. Uses Gemini 3 Pro for independent assessment
4. Results displayed in success modal and stored for analysis

### 12.3 Scoring Methodology

| Category | Weight | Criteria |
|----------|--------|----------|
| Title Quality | 20% | Length, keywords, structure, readability |
| Item Specifics | 20% | Required fields, accuracy, completeness |
| Description | 20% | Style match, completeness, formatting |
| Images | 20% | Count, quality indicators, coverage |
| Pricing & Policies | 10% | Best Offer config, competitiveness |
| Specification Compliance | 10% | Overall adherence to spec |

### 12.4 Score Interpretation

| Score Range | Rating | Display |
|-------------|--------|---------|
| 90-100 | Excellent | Green, "Excellent listing quality" |
| 75-89 | Good | Blue, "Good listing quality" |
| 60-74 | Fair | Yellow, "Room for improvement" |
| Below 60 | Needs Work | Orange, "Consider revising" |

### 12.5 Data Collection for Training

Store the following for each review:
- Input: Inventory item data, user selections
- Output: Generated listing content
- Review: Quality score, category scores, recommendations
- Outcome: (Future) Actual listing performance (views, sales)

---

## 13. Verification Steps

### 13.1 Development Verification

After implementation, verify each requirement:

#### UI Verification
- [ ] "Create eBay Listing" button appears on inventory item screen
- [ ] Button is disabled for already-listed items
- [ ] Modal opens with correct layout
- [ ] All form fields function correctly
- [ ] Description style dropdown shows 5 options
- [ ] Template dropdown loads saved templates
- [ ] Photo drag & drop works
- [ ] Progress bar displays during processing
- [ ] Success modal shows listing details and quality score
- [ ] Error modal shows recovery options

#### Process Verification
- [ ] Inventory data loads correctly in modal
- [ ] Photos upload and enhance correctly
- [ ] AI generates title within 80 characters
- [ ] AI generates appropriate item specifics
- [ ] Description matches selected style
- [ ] Template placeholders are replaced correctly
- [ ] eBay business policies retrieved successfully
- [ ] Listing created as draft when selected
- [ ] Listing published when "live" selected
- [ ] Scheduled listings created correctly
- [ ] Best Offer configured correctly
- [ ] Inventory item updated after listing creation
- [ ] Audit records created for all steps
- [ ] Quality review executes and displays

#### Error Handling Verification
- [ ] Validation errors display correctly
- [ ] Retry option works after API failure
- [ ] Edit & Retry returns to form with data preserved
- [ ] Save as Draft stores data locally
- [ ] Draft can be resumed later

### 13.2 Integration Testing

- [ ] End-to-end test: Create listing from inventory item
- [ ] Test with each description style
- [ ] Test with template vs AI-generated
- [ ] Test draft vs live vs scheduled
- [ ] Test photo enhancement on/off
- [ ] Test with various conditions (New, Used, etc.)
- [ ] Test error recovery flows
- [ ] Test quality review with various listing qualities

### 13.3 Acceptance Testing

- [ ] Business user can create listing within 2 minutes
- [ ] Generated title follows specification
- [ ] Description is appropriate for selected style
- [ ] Photos appear correctly on eBay listing
- [ ] Inventory item shows correct status after listing
- [ ] Audit trail is complete and accurate
- [ ] Quality score provides meaningful feedback

---

## 14. Dependencies

### 14.1 External Dependencies

| Dependency | Purpose | Required |
|------------|---------|----------|
| eBay API | Listing creation, policies | Yes |
| Claude Opus 4.5 | Content generation | Yes |
| Gemini 3 Pro | Quality review | Yes |
| Bricklink | Product data | Optional |
| Brickset | Product data | Optional |

### 14.2 Internal Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| eBay OAuth tokens | API authentication | Existing |
| Listing Templates | Template selection | Existing |
| Image Studio enhancement | Photo optimisation | Existing (copy logic) |
| Inventory Items table | Source data | Existing |
| Gemini API integration | Quality review | Existing |

### 14.3 Configuration Dependencies

| Setting | Location | Default |
|---------|----------|---------|
| Auto-Accept Threshold | App Settings | 95% |
| Auto-Decline Threshold | App Settings | 75% |
| Default Description Style | App Settings | Standard |
| Default Photo Enhancement | App Settings | Enabled |

---

## 15. Glossary

| Term | Definition |
|------|------------|
| Best Offer | eBay feature allowing buyers to make offers below listing price |
| Cassini | eBay's search algorithm |
| Draft Listing | Unpublished listing saved in eBay |
| Fulfillment Policy | eBay business policy for shipping |
| Item Specifics | Structured product attributes on eBay |
| Listing Assistant | Existing separate feature for generating listings |
| MPN | Manufacturer Part Number |
| Offer | eBay API concept - the sales listing |
| SKU | Stock Keeping Unit - unique item identifier |
| Small Parcel | Standard shipping category for small items |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | January 2026 | Business Analysis | Initial specification |

---

## Appendix A: eBay Listing Specification Reference

The AI generation process must use the separate **eBay Listing Specification** document as its primary reference for:
- Title formatting rules
- Item specifics requirements
- Description guidelines
- Image requirements
- Condition mappings
- Category selection

Ensure this document is included in the AI prompt context for listing generation.

---

## Appendix B: Existing Component References

### Image Enhancement (copy from Image Studio)

Location: `[Path to Image Studio component]`  
Function: "Optimise for eBay"  
Operations:
- Brightness adjustment
- Contrast enhancement
- Sharpness filter
- Temperature correction

Copy the existing implementation logic for photo enhancement in this feature.

### Listing Templates

Location: `[Path to Listing Templates feature]`  
Table: `listing_templates`  
Placeholders supported:
- `[Set Number]`
- `[Set Name]`
- `[Year]`
- `[Retired]` (Yes/No)
- `[Condition]`
- `[Box Condition]`
- `[Description]` (AI-generated portion)

---

## Appendix C: Progress Step Details

| Step | Name | Description | Typical Duration |
|------|------|-------------|------------------|
| 1 | Validating inventory data | Check required fields, item status | <1s |
| 2 | Researching product information | Query Bricklink, Brickset | 2-5s |
| 3 | Retrieving eBay policies | Fetch business policies | 1-2s |
| 4 | Generating listing content | AI creates title, description | 5-10s |
| 5 | Uploading images | Enhance (optional) and upload | 5-15s |
| 6 | Creating eBay listing | API calls to create listing | 2-5s |
| 7 | Updating inventory record | Database update | <1s |
| 8 | Recording audit trail | Audit logging | <1s |
| 9 | Quality review | AI review and scoring | 3-5s |

**Total estimated time: 20-40 seconds**
