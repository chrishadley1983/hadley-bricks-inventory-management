/**
 * AI Prompt for eBay Listing Generation
 *
 * Uses Claude Opus 4.5 to generate optimized eBay listing content
 * based on inventory item data, research data, and user preferences.
 */

import type { DescriptionStyle } from '@/lib/ebay/listing-creation.types';

/**
 * System prompt for generating eBay listings
 */
export const GENERATE_LISTING_SYSTEM_PROMPT = `You are an expert eBay listing specialist for LEGO products. Your task is to generate optimized eBay listing content that maximizes visibility, buyer engagement, and sales conversion.

## eBay Optimization Expertise

You understand eBay's Cassini search algorithm and optimize for:
- **Title Relevance:** Keywords placed strategically left-to-right
- **Listing Quality:** Complete item specifics, detailed descriptions
- **Buyer Behaviour:** Writing that drives click-through and conversion

## Core Rules

1. **TITLES:**
   - Maximum 80 characters
   - Target 65-80 characters (1.5x more likely to sell)
   - Use Title Case
   - Place most important keywords at start
   - Include: Condition, Brand, Theme, Set Name, Set Number, Key Features
   - Do NOT include "New" if condition is New (redundant)
   - Do NOT use promotional text (!, Look, Best, etc.)
   - Do NOT use ALL CAPS for entire words

2. **ITEM SPECIFICS (CRITICAL):**
   - ALWAYS include ALL of these required fields:
     * Brand: "LEGO"
     * LEGO Theme: The theme name (e.g., "Technic", "Star Wars", "City")
     * LEGO Set Number: The set number from the input
     * MPN: Same as set number (Manufacturer Part Number)
     * Type: e.g., "Complete Set", "LEGO Set"
   - Include these if you can determine from context/set number:
     * Piece Count: Number of pieces (look up if known LEGO set)
     * Age Level: e.g., "16+ Years", "8-11 Years", "10+"
     * Minifigure Count: Number of minifigures included
     * Character Family: For licensed themes (e.g., "Star Wars", "Marvel", "McLaren")
     * LEGO Set Name: The official name of the set
     * LEGO Character: Main characters/figures (e.g., "Luke Skywalker", "Batman")
     * Features: Key features like "Working Suspension", "Minifigures Included"
     * Material: "Plastic"
     * Packaging: e.g., "Original (Opened)", "Original (Sealed)"
     * Release Year: Year the set was released
     * Year Manufactured: Same as release year
   - Use eBay's accepted values where known
   - NEVER leave item specifics empty - use context to populate as many as possible
   - Never use "N/A" or "Does not apply" when actual value can be determined

3. **DESCRIPTIONS:**
   - Adapt tone to the requested style
   - Be accurate and honest about condition
   - Include what's in the box and what's not
   - Use HTML formatting sparingly (<p>, <b>, <br>)
   - Do NOT include shipping/payment/return info (handled by eBay policies)
   - Do NOT include contact information or external links

4. **CONDITION MAPPING:**
   - Factory Sealed / Sealed → NEW (1000)
   - Open Box - Complete → NEW_OTHER (1500)
   - Used - Excellent → USED_EXCELLENT (3000)
   - Used - Very Good → USED_VERY_GOOD (4000)
   - Used - Good → USED_GOOD (5000)
   - Used - Acceptable → USED_ACCEPTABLE (6000)
   - Parts Only / Incomplete → FOR_PARTS_OR_NOT_WORKING (7000)

## CATEGORY SELECTION (CRITICAL)

You MUST use one of these exact eBay leaf category IDs. Using any other category will cause listing failure:

- **183448** - LEGO Complete Sets & Packs - Use for complete sets with all pieces, sealed or used
- **183447** - LEGO Minifigures - Use ONLY for individual minifigures sold separately
- **183449** - LEGO Pieces & Parts - Use ONLY for bulk parts, individual pieces, or partial sets
- **183450** - LEGO Instruction Manuals - Use ONLY for instruction booklets sold separately

For 99% of listings (complete LEGO sets), use category ID "183448".

## Response Format

Always return valid JSON with this exact structure:
{
  "title": "string (max 80 chars)",
  "subtitle": "string (max 55 chars) or null",
  "description": "string (HTML formatted)",
  "conditionId": number,
  "conditionDescription": "string or null",
  "itemSpecifics": {
    "Brand": "LEGO",
    "LEGO Theme": "string (required)",
    "LEGO Set Number": "string (required)",
    "MPN": "string (required - same as set number)",
    "Type": "string (e.g., Complete Set)",
    "Piece Count": "string (number as string)",
    "Age Level": "string (e.g., 16+ Years)",
    "Minifigure Count": "string (number as string)",
    "Features": "string (comma-separated list)",
    "Character Family": "string or null",
    "LEGO Set Name": "string (official name)",
    "LEGO Character": "string or null",
    "Material": "Plastic",
    "Packaging": "string (e.g., Original (Opened))",
    "Release Year": "string (year)",
    "Year Manufactured": "string (same as release year)"
  },
  "categoryId": "string",
  "confidence": number (0-100),
  "recommendations": ["array of suggestions for improvement"]
}`;

/**
 * Description style instructions
 */
export const DESCRIPTION_STYLE_INSTRUCTIONS: Record<DescriptionStyle, string> = {
  Minimalist: `Write in a MINIMALIST style:
- Ultra-concise, bullet-point focused
- No flowery language, just facts
- Short sentences and lists
- Target 100-150 words
- Focus on: what it is, condition, what's included`,

  Standard: `Write in a STANDARD style:
- Balanced and informative
- Professional but approachable
- Clear structure with sections
- Target 200-300 words
- Include product highlights and condition details`,

  Professional: `Write in a PROFESSIONAL style:
- Formal and business-like
- Detailed specifications
- Comprehensive condition report
- Target 300-400 words
- Emphasize accuracy and thoroughness`,

  Friendly: `Write in a FRIENDLY style:
- Warm and conversational
- Personal touches and enthusiasm
- Approachable language
- Target 200-300 words
- Make the buyer feel welcome`,

  Enthusiastic: `Write in an ENTHUSIASTIC style:
- Energetic and exciting
- Highlight what makes this special
- Persuasive without being pushy
- Target 250-350 words
- Convey genuine excitement about the product`,
};

/**
 * LEGO category mapping
 */
export const LEGO_CATEGORIES = {
  COMPLETE_SET: '183448', // LEGO Complete Sets & Packs
  MINIFIGURES: '183447', // LEGO Minifigures
  PARTS: '183449', // LEGO Pieces & Parts
  INSTRUCTIONS: '183450', // LEGO Instruction Manuals
};

/**
 * Interface for inventory item input
 */
export interface ListingInventoryInput {
  setNumber: string;
  setName?: string;
  theme?: string;
  condition: string;
  conditionNotes?: string;
  pieceCount?: number;
  minifigureCount?: number;
  yearReleased?: number;
  isRetired?: boolean;
  hasBox?: boolean;
  hasInstructions?: boolean;
  notes?: string;
}

/**
 * Interface for Brickset research data
 */
export interface ListingResearchData {
  setName?: string;
  theme?: string;
  subtheme?: string;
  pieces?: number;
  minifigs?: number;
  year?: number;
  retired?: boolean;
  ageRange?: string;
  dimensions?: string;
  description?: string;
  barcode?: string;
}

/**
 * Interface for listing template
 */
export interface ListingTemplate {
  content: string;
  type: 'lego_used' | 'lego_new' | 'general' | 'custom';
}

/**
 * Create the user message for generating an eBay listing
 */
export function createGenerateListingMessage(
  item: ListingInventoryInput,
  style: DescriptionStyle,
  template?: ListingTemplate,
  research?: ListingResearchData
): string {
  const styleInstructions = DESCRIPTION_STYLE_INSTRUCTIONS[style];

  // Build context sections
  let message = `## TASK
Generate an optimized eBay listing for this LEGO item.

## STYLE INSTRUCTIONS
${styleInstructions}

## INVENTORY ITEM DATA
- Set Number: ${item.setNumber}
- Set Name: ${item.setName}
- Theme: ${item.theme}
- Condition: ${item.condition}
${item.conditionNotes ? `- Condition Notes: ${item.conditionNotes}` : ''}
${item.pieceCount ? `- Piece Count: ${item.pieceCount}` : ''}
${item.minifigureCount ? `- Minifigure Count: ${item.minifigureCount}` : ''}
${item.yearReleased ? `- Year Released: ${item.yearReleased}` : ''}
${item.isRetired !== undefined ? `- Retired: ${item.isRetired ? 'Yes' : 'No'}` : ''}
${item.hasBox !== undefined ? `- Has Box: ${item.hasBox ? 'Yes' : 'No'}` : ''}
${item.hasInstructions !== undefined ? `- Has Instructions: ${item.hasInstructions ? 'Yes' : 'No'}` : ''}
${item.notes ? `- Additional Notes: ${item.notes}` : ''}
`;

  // Add research data if available
  if (research) {
    message += `
## BRICKSET RESEARCH DATA (verified product information)
${research.setName ? `- Official Name: ${research.setName}` : ''}
${research.theme ? `- Theme: ${research.theme}` : ''}
${research.subtheme ? `- Subtheme: ${research.subtheme}` : ''}
${research.pieces ? `- Piece Count: ${research.pieces}` : ''}
${research.minifigs ? `- Minifigure Count: ${research.minifigs}` : ''}
${research.year ? `- Release Year: ${research.year}` : ''}
${research.retired !== undefined ? `- Retired: ${research.retired ? 'Yes' : 'No'}` : ''}
${research.ageRange ? `- Age Range: ${research.ageRange}` : ''}
${research.dimensions ? `- Dimensions: ${research.dimensions}` : ''}
${research.barcode ? `- Barcode: ${research.barcode}` : ''}
${research.description ? `- Official Description: ${research.description}` : ''}
`;
  }

  // Add template if provided
  if (template) {
    message += `
## TEMPLATE TO USE
Incorporate this template structure into the description, filling in the placeholders with actual data:

\`\`\`html
${template.content}
\`\`\`
`;
  }

  // Add final instructions
  message += `
## OUTPUT REQUIREMENTS
1. Generate an optimized 65-80 character title
2. Generate a subtitle if beneficial (max 55 chars) or null
3. Generate an HTML description following the style and template
4. Map condition to correct eBay condition ID
5. Provide complete item specifics
6. Select appropriate category ID
7. Provide confidence score (0-100) and any recommendations

Return ONLY valid JSON, no other text.`;

  return message;
}

/**
 * Type for the generated listing response
 */
export interface GeneratedListingResponse {
  title: string;
  subtitle: string | null;
  description: string;
  conditionId: number;
  conditionDescription: string | null;
  itemSpecifics: {
    Brand: string;
    'LEGO Theme': string;
    'LEGO Set Number': string;
    MPN: string;
    Type?: string;
    'Piece Count'?: string;
    'Age Level'?: string;
    'Minifigure Count'?: string;
    Features?: string;
    'Character Family'?: string;
    'LEGO Set Name'?: string;
    'LEGO Character'?: string;
    Material?: string;
    Packaging?: string;
    'Release Year'?: string;
    'Year Manufactured'?: string;
    [key: string]: string | undefined;
  };
  categoryId: string;
  confidence: number;
  recommendations: string[];
}
