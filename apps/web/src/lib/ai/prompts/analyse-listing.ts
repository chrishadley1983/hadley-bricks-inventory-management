/**
 * AI Prompt for eBay Listing Analysis
 *
 * Uses Gemini 3 Pro to analyse existing eBay listings
 * against the ebay-listing-specification.md best practices.
 */

import type { FullItemDetails } from '@/lib/platform-stock/ebay/types';

/**
 * System prompt for analysing existing eBay listings
 */
export const ANALYSE_LISTING_SYSTEM_PROMPT = `You are an expert eBay listing analyst for LEGO products. Your task is to evaluate existing eBay listings against best practices and provide specific, actionable improvement suggestions.

## Your Role

You are reviewing EXISTING listings that are already live on eBay. Your job is to:
1. Score the listing quality across 5 categories
2. Identify specific issues that hurt visibility/sales
3. Provide exact replacement content for improvements

## Scoring Categories (100 points total)

### Title (25 points)
- Length optimization (65-80 chars ideal): 0-10 points
- Keyword placement (important terms first): 0-8 points
- Readability and natural language: 0-7 points

**Issues to flag:**
- Too short (< 65 chars) - wasted visibility opportunity
- Too long (> 80 chars) - will be truncated
- Missing set number
- Missing theme/product name
- Promotional text (!, LOOK, Best, etc.)
- ALL CAPS words (except brand names)
- "New" in title when condition is already New

### Item Specifics (20 points)
- Required fields complete (Brand, Theme, Set Number, MPN): 0-10 points
- Recommended fields populated (Piece Count, Age Level, etc.): 0-5 points
- Accuracy of values: 0-5 points

**Issues to flag:**
- Missing Brand (should be "LEGO")
- Missing LEGO Theme
- Missing LEGO Set Number
- Missing MPN
- Missing Type
- Using "N/A" or "Does not apply" when value can be determined
- Incorrect or inconsistent values

### Description (25 points)
- Completeness (what's included, condition): 0-10 points
- Formatting and readability: 0-8 points
- Mobile-friendliness (not too long): 0-7 points

**Issues to flag:**
- Missing condition details
- Missing contents list (what's included)
- Too short (lacks buyer confidence)
- Too long (over 2000 words, hurts mobile)
- Poor formatting (wall of text)
- Contains shipping/payment info (should use policies)
- Contains external links or contact info

### Condition Accuracy (15 points)
- Correct condition ID mapping: 0-10 points
- Appropriate condition description: 0-5 points

**Issues to flag:**
- Condition doesn't match description
- Missing condition description for used items
- Overstated condition (e.g., "New" for opened box)

### SEO Optimization (15 points)
- Keyword usage in description: 0-8 points
- Category selection accuracy: 0-7 points

**Issues to flag:**
- Wrong category (most LEGO sets should be 183448)
- Missing searchable keywords in description
- Missing theme/character names

## Grading Scale
- A+ (95-100): Exceptional, publication-ready
- A (85-94): Excellent, minor tweaks optional
- B (75-84): Good, some improvements recommended
- C (65-74): Acceptable, notable issues to address
- D (50-64): Below average, significant improvements needed
- F (<50): Poor, requires major revision

## Response Format

CRITICAL: Return ONLY valid JSON with this exact structure:
{
  "score": number (0-100),
  "grade": "A+" | "A" | "B" | "C" | "D" | "F",
  "breakdown": {
    "title": {
      "score": number (0-25),
      "feedback": "Brief explanation of score"
    },
    "itemSpecifics": {
      "score": number (0-20),
      "feedback": "Brief explanation of score"
    },
    "description": {
      "score": number (0-25),
      "feedback": "Brief explanation of score"
    },
    "conditionAccuracy": {
      "score": number (0-15),
      "feedback": "Brief explanation of score"
    },
    "seoOptimization": {
      "score": number (0-15),
      "feedback": "Brief explanation of score"
    }
  },
  "suggestions": [
    {
      "category": "title" | "itemSpecifics" | "description" | "condition" | "seo",
      "field": "specific field name (e.g., 'title', 'Brand', 'description')",
      "priority": "high" | "medium" | "low",
      "issue": "What's wrong with the current value",
      "currentValue": "The current value in the listing",
      "suggestedValue": "The EXACT replacement value to use",
      "explanation": "Why this change improves the listing"
    }
  ],
  "highlights": ["Things done well - positive reinforcement"],
  "criticalIssues": ["Issues that MUST be fixed (empty if none)"]
}

## Critical Rules

1. For title suggestions, ALWAYS provide the COMPLETE replacement title, not just what to add
2. For item specifics, provide the exact name-value pair
3. For description, provide the complete replacement or specific section to change
4. Be specific - vague suggestions are not actionable
5. Prioritize high-impact changes first
6. If listing is already excellent (A+), still provide 1-2 minor enhancement ideas`;

/**
 * Create the user message for analysing an existing listing
 */
export function createAnalyseListingMessage(
  listing: FullItemDetails,
  inventoryData?: {
    setNumber?: string;
    theme?: string;
    condition?: string;
    pieceCount?: number;
    hasBox?: boolean;
    hasInstructions?: boolean;
    costPrice?: number;
  }
): string {
  // Format item specifics for display
  const itemSpecificsText = listing.itemSpecifics
    .map(spec => `  - ${spec.name}: ${spec.value}`)
    .join('\n');

  let message = `## LISTING TO ANALYSE

**Item ID:** ${listing.itemId}
**Title (${listing.title.length}/80 chars):** ${listing.title}

**Condition ID:** ${listing.conditionId || 'Not set'}
**Condition Description:** ${listing.conditionDescription || 'None'}

**Category ID:** ${listing.categoryId}
${listing.categoryName ? `**Category Name:** ${listing.categoryName}` : ''}

**Item Specifics:**
${itemSpecificsText || '  (none)'}

**Description:**
${listing.description || '(empty)'}

**Images:** ${listing.pictureUrls.length} image(s)

**Price:** £${listing.startPrice.toFixed(2)}
**Quantity:** ${listing.quantity}
`;

  // Add inventory reference data if available
  if (inventoryData) {
    message += `
## INVENTORY REFERENCE DATA (for verification)
${inventoryData.setNumber ? `- Set Number: ${inventoryData.setNumber}` : ''}
${inventoryData.theme ? `- Theme: ${inventoryData.theme}` : ''}
${inventoryData.condition ? `- Condition (from inventory): ${inventoryData.condition}` : ''}
${inventoryData.pieceCount ? `- Piece Count: ${inventoryData.pieceCount}` : ''}
${inventoryData.hasBox !== undefined ? `- Has Box: ${inventoryData.hasBox ? 'Yes' : 'No'}` : ''}
${inventoryData.hasInstructions !== undefined ? `- Has Instructions: ${inventoryData.hasInstructions ? 'Yes' : 'No'}` : ''}
`;
  }

  message += `
## TASK
1. Score this listing on all 5 categories
2. Identify specific issues with exact locations
3. Provide actionable suggestions with EXACT replacement values
4. Flag any critical issues that must be fixed

Return ONLY valid JSON, no other text.`;

  return message;
}

/**
 * Type for a single improvement suggestion
 */
export interface ListingSuggestion {
  category: 'title' | 'itemSpecifics' | 'description' | 'condition' | 'seo';
  field: string;
  priority: 'high' | 'medium' | 'low';
  issue: string;
  currentValue: string;
  suggestedValue: string;
  explanation: string;
}

/**
 * Type for category breakdown
 */
export interface CategoryBreakdown {
  score: number;
  feedback: string;
}

/**
 * Type for the analysis response
 */
export interface ListingAnalysisResponse {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: {
    title: CategoryBreakdown;
    itemSpecifics: CategoryBreakdown;
    description: CategoryBreakdown;
    conditionAccuracy: CategoryBreakdown;
    seoOptimization: CategoryBreakdown;
  };
  suggestions: ListingSuggestion[];
  highlights: string[];
  criticalIssues: string[];
}

/**
 * Convert numeric score to letter grade
 */
export function scoreToGrade(score: number): ListingAnalysisResponse['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
