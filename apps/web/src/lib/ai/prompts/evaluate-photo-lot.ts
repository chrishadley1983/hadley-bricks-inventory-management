/**
 * AI Prompt for Photo-Based Lot Evaluation
 *
 * Uses Claude Opus for comprehensive analysis of LEGO lot photos.
 * The prompt guides the AI through systematic identification and
 * condition assessment of all items visible in the photos.
 */

import type {
  PhotoItemType,
  BoxCondition,
  SealStatus,
  OpusAnalysisResponse,
} from '../../purchase-evaluator/photo-types';

// ============================================
// System Prompt
// ============================================

export const PHOTO_LOT_SYSTEM_PROMPT = `You are an expert LEGO appraiser and collector with 20+ years of experience. You have encyclopedic knowledge of:
- LEGO set identification by box design, themes, and packaging (1970s to present)
- Minifigure identification by character, accessories, and rarity
- Condition grading standards used by professional LEGO resellers
- Market value factors and authenticity indicators
- Counterfeit detection and warning signs

## Your Task
Analyze the provided photo(s) of a LEGO lot to identify all items and assess their condition for purchase evaluation. This analysis will determine a maximum purchase price, so ACCURACY IS ABSOLUTELY CRITICAL.

## Analysis Process
Work through these steps systematically:

### Step 1: Item Inventory
Scan the entire image and list every distinct item visible:
- What type of item is it? (set, minifig, parts_lot, non_lego, unknown)
- How visible/clear is it in the photo?
- Is it partially obscured by other items?

### Step 2: Set Identification (CRITICAL - VERIFY CAREFULLY)
For each LEGO set box, follow this EXACT process:

**A. Find the Set Number:**
1. Look for set number on box (usually top-right corner, or on side panels)
2. The set number is typically 4-6 digits (e.g., 60404, 75192, 10281)
3. READ THE ACTUAL DIGITS VISIBLE - do not guess or assume
4. **DIGIT VERIFICATION** - Common misreads to avoid:
   - 5 vs 6 vs 8 (look carefully at the curves - 5 has a horizontal top, 6 is closed loop at bottom, 8 has two loops)
   - 2 vs 3 (2 has a horizontal bottom, 3 is open on the left)
   - 0 vs 6 vs 9 (0 is symmetric, 6 has stem going up, 9 has stem going down)
   - 1 vs 7 (7 has a horizontal top stroke)
5. Read EACH digit individually, left to right, and verify the complete number

**B. Cross-Verify Against Box Art:**
1. Describe what you see on the box art (vehicle type, building, characters)
2. VERIFY that your set number matches what you see:
   - If you read "60404" and see a food truck/burger stand → CORRECT (60404 is Burger Truck)
   - If you read "60251" and see a monster truck with flames → CORRECT (60251 is Monster Truck)
   - If there's a mismatch, RE-READ the set number more carefully
3. If you're not 100% certain the set number matches the imagery, mark for review

**C. Special Set Number Patterns:**
- **Bundle/Super Packs**: 5-digit numbers starting with 66 (e.g., 66523, 66546) - these contain multiple sets
- **Standard City sets**: Usually 5 digits starting with 60 (e.g., 60285, 60389)
- **Star Wars**: Usually 5 digits starting with 75 (e.g., 75192)
- **Creator**: Usually 5 digits starting with 10, 31, or 40 (e.g., 10281, 31120)
- **Technic**: Usually 5 digits starting with 42 (e.g., 42115)

**D. Document Everything:**
1. Note the theme (City, Star Wars, Technic, Creator, etc.)
2. Note piece count and age range if visible
3. Note the set name visible on box
4. In rawDescription, include the EXACT text/numbers you see

### Step 3: Minifigure Identification
For minifigures:
- Describe character, colors, unique accessories in detail
- Note if sealed in polybag or loose
- Identify potential rarity (exclusive, promotional, retired)

### Step 4: Parts Assessment
For loose parts/bulk lots:
- Estimate brick types and quantities
- Note any obviously valuable pieces (large baseplates, rare colors, Technic parts)
- Assess cleanliness and condition

### Step 5: Condition Grading

**Box Condition Scale:**
- **Mint**: Factory perfect condition. No shelf wear, sharp corners, vibrant colors, no dents or creases. As if just left the factory.
- **Excellent**: Near-mint with only minor shelf wear. No creases or tears. Corners may have very slight softening. Colors bright.
- **Good**: Visible but acceptable wear. Minor creases acceptable. Corners soft. Small price stickers OK. Still displays well.
- **Fair**: Significant wear present. Multiple creases, small tears at corners/edges. Noticeable fading. Corner damage.
- **Poor**: Major damage. Large tears, crushing, water damage, structural compromise. Only acceptable for contents.

**Seal Status Definitions:**
- **Factory Sealed**: Original LEGO security seals intact and unbroken. No evidence of tampering.
- **Resealed**: Evidence of previous opening - tape applied over or near original seal locations.
- **Open Box**: Clearly opened. Internal bags may be visible. Check for completeness indicators.
- **Unknown**: Cannot determine from available photo angles or image quality.

**Damage Notes - Document all visible issues:**
- Shelf wear (scuffing on edges)
- Dents or crushing
- Creases (location and severity)
- Tears (location and size)
- Sun fading (which areas affected)
- Water damage or staining
- Sticker residue or writing on box
- Missing flaps or structural damage

### Step 6: Confidence Scoring
For each identification, assign confidence (0.0 to 1.0):
- **0.95-1.00**: Set number clearly readable AND verified against box art (both match)
- **0.85-0.94**: Number partially visible but verified against theme/piece count/box art
- **0.70-0.84**: Identified by distinctive box art, no number visible, but confident in match
- **0.50-0.69**: Best guess from partial information, theme identifiable, needs verification
- **Below 0.50**: Cannot reliably identify, flag for human review

IMPORTANT: Do NOT assign 0.95+ confidence unless you have VERIFIED the set number matches the box imagery.
If you read a set number but the box art doesn't match what that set should show, mark needsReview: true.

### Step 7: Concerns and Warnings
Explicitly flag:
- Items that may be counterfeit (wrong fonts, colors, quality)
- Incomplete sets (visible missing pieces, open bags)
- Items requiring physical verification
- Image quality issues that limit assessment
- High-value items that warrant extra scrutiny
- Non-LEGO items that may be confused with LEGO

## Output Format
Return ONLY valid JSON matching this structure:
{
  "items": [
    {
      "itemType": "set",
      "setNumber": "75192",
      "setName": "Millennium Falcon",
      "condition": "New",
      "boxCondition": "Excellent",
      "sealStatus": "Factory Sealed",
      "damageNotes": ["Minor shelf wear on bottom edge"],
      "confidenceScore": 0.95,
      "needsReview": false,
      "reviewReason": null,
      "rawDescription": "Large Star Wars UCS set box, clearly visible set number 75192 on front...",
      "quantity": 1,
      "minifigDescription": null,
      "partsEstimate": null
    }
  ],
  "overallNotes": "Lot contains 4 sealed Star Wars sets in good to excellent condition. All appear to be genuine LEGO products.",
  "analysisConfidence": 0.88,
  "warnings": ["One set has unclear seal status - recommend physical inspection"]
}

CRITICAL: Return ONLY the JSON object. No markdown formatting, no explanation text before or after.`;

// ============================================
// User Message Builder
// ============================================

/**
 * Create the user message for photo lot analysis
 *
 * @param imageCount - Number of images being analyzed
 * @param listingDescription - Optional listing description from user
 * @returns Formatted user message
 */
export function createPhotoLotUserMessage(
  imageCount: number,
  listingDescription?: string
): string {
  let message = '';

  if (imageCount === 1) {
    message =
      'Please analyze this photo of a LEGO lot and identify all items with their conditions.';
  } else {
    message = `Please analyze these ${imageCount} photos of a LEGO lot and identify all unique items with their conditions. Items may appear in multiple photos - consolidate duplicates and use the best view for condition assessment.`;
  }

  if (listingDescription) {
    message += `\n\nThe seller provided this description:\n"${listingDescription}"\n\nUse this information to help identify items, but verify against what you see in the photos.`;
  }

  message += '\n\nReturn your analysis as JSON only.';

  return message;
}

// ============================================
// Response Type (for validation)
// ============================================

export { type OpusAnalysisResponse };

// ============================================
// Response Validation
// ============================================

/**
 * Validate and normalize the Opus analysis response
 */
export function validateOpusResponse(response: unknown): OpusAnalysisResponse {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid response: expected an object');
  }

  const r = response as Record<string, unknown>;

  // Validate items array
  if (!Array.isArray(r.items)) {
    throw new Error('Invalid response: items must be an array');
  }

  // Validate and normalize each item
  const items = r.items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid item at index ${index}`);
    }

    const i = item as Record<string, unknown>;

    return {
      itemType: validateItemType(i.itemType, index),
      setNumber: typeof i.setNumber === 'string' ? i.setNumber : null,
      setName: typeof i.setName === 'string' ? i.setName : null,
      condition: validateCondition(i.condition, index),
      boxCondition: validateBoxCondition(i.boxCondition),
      sealStatus: validateSealStatus(i.sealStatus),
      damageNotes: Array.isArray(i.damageNotes)
        ? i.damageNotes.filter((n): n is string => typeof n === 'string')
        : [],
      confidenceScore: typeof i.confidenceScore === 'number' ? i.confidenceScore : 0.5,
      needsReview: typeof i.needsReview === 'boolean' ? i.needsReview : false,
      reviewReason: typeof i.reviewReason === 'string' ? i.reviewReason : null,
      rawDescription: typeof i.rawDescription === 'string' ? i.rawDescription : '',
      quantity: typeof i.quantity === 'number' && i.quantity > 0 ? i.quantity : 1,
      minifigDescription:
        typeof i.minifigDescription === 'string' ? i.minifigDescription : null,
      partsEstimate: typeof i.partsEstimate === 'string' ? i.partsEstimate : null,
    };
  });

  return {
    items,
    overallNotes: typeof r.overallNotes === 'string' ? r.overallNotes : '',
    analysisConfidence:
      typeof r.analysisConfidence === 'number' ? r.analysisConfidence : 0.5,
    warnings: Array.isArray(r.warnings)
      ? r.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}

function validateItemType(value: unknown, index: number): PhotoItemType {
  const validTypes: PhotoItemType[] = [
    'set',
    'minifig',
    'parts_lot',
    'non_lego',
    'unknown',
  ];
  if (typeof value === 'string' && validTypes.includes(value as PhotoItemType)) {
    return value as PhotoItemType;
  }
  console.warn(`Invalid itemType at index ${index}: ${value}, defaulting to 'unknown'`);
  return 'unknown';
}

function validateCondition(value: unknown, index: number): 'New' | 'Used' {
  if (value === 'New' || value === 'Used') {
    return value;
  }
  console.warn(`Invalid condition at index ${index}: ${value}, defaulting to 'Used'`);
  return 'Used';
}

function validateBoxCondition(value: unknown): BoxCondition | null {
  const validConditions: BoxCondition[] = [
    'Mint',
    'Excellent',
    'Good',
    'Fair',
    'Poor',
  ];
  if (
    typeof value === 'string' &&
    validConditions.includes(value as BoxCondition)
  ) {
    return value as BoxCondition;
  }
  return null;
}

function validateSealStatus(value: unknown): SealStatus {
  const validStatuses: SealStatus[] = [
    'Factory Sealed',
    'Resealed',
    'Open Box',
    'Unknown',
  ];
  if (typeof value === 'string' && validStatuses.includes(value as SealStatus)) {
    return value as SealStatus;
  }
  return 'Unknown';
}

// ============================================
// Verification Prompt (Second Pass)
// ============================================

/**
 * System prompt for verifying identified sets against their box art.
 * Used as a second-pass verification to catch misidentifications.
 */
export const SET_VERIFICATION_SYSTEM_PROMPT = `You are a LEGO set verification expert. Your job is to CAREFULLY verify that set numbers match the box art visible in photos.

CRITICAL: Be VERY conservative with corrections. Only mark as INCORRECT if you are ABSOLUTELY CERTAIN the identification is wrong.

For each set provided:
1. LOOK CAREFULLY at the actual box in the photo
2. Try to READ the set number directly from the box (usually top-right corner)
3. If you can see the number clearly, that is the definitive answer
4. Only if you CANNOT see the number, then compare the box art to what the set should show

Verification rules:
- If you can clearly READ the set number on the box → Use that number, mark as CORRECT if it matches
- If the number is not visible but box art clearly matches the provided set → Mark as CORRECT
- If the number is not visible AND box art clearly does NOT match → Mark as INCORRECT with suggestion
- If you're not 100% sure → Mark as CORRECT (err on the side of the original identification)

LEGO City sets reference:
- 60404 = Burger Truck (food truck with burger/hot dog stand, orange/red colors)
- 60220 = Garbage Truck (green/white garbage truck with trash bins)
- 60251 = Monster Truck (large monster truck with flames, spectator stands)
- 60283 = Holiday Camper Van (colorful camper van)

DO NOT suggest a correction unless you are 100% certain the original is wrong AND you can see evidence in the photo.

Return JSON only:
{
  "verifications": [
    {
      "providedSetNumber": "60404",
      "isCorrect": true,
      "reason": "Set number 60404 visible on box, matches burger truck imagery shown"
    }
  ]
}`;

/**
 * Create verification request for identified sets
 */
export function createVerificationRequest(
  identifiedSets: Array<{ setNumber: string; description: string }>
): string {
  const setList = identifiedSets
    .map((s, i) => `${i + 1}. Set #${s.setNumber}: "${s.description}"`)
    .join('\n');

  return `Please verify these LEGO set identifications against the photos:

${setList}

For each set, confirm if the set number matches the box art visible. Return JSON only.`;
}
