/**
 * AI Prompt for eBay Listing Quality Review
 *
 * Uses Gemini 3 Pro as an independent reviewer to evaluate
 * AI-generated eBay listings for quality and optimization.
 */

import type { GeneratedListingResponse } from './generate-listing';

/**
 * Prompt for reviewing eBay listing quality
 */
export function createQualityReviewPrompt(
  listing: GeneratedListingResponse,
  inventoryCondition: string,
  price: number
): string {
  return `You are an independent eBay listing quality auditor. Your role is to review AI-generated listings and provide a quality score with specific feedback.

## YOUR TASK
Review this eBay listing for a LEGO product and score it on quality, accuracy, and optimization.

## LISTING TO REVIEW

**Title (${listing.title.length}/80 chars):**
${listing.title}

**Subtitle:**
${listing.subtitle || '(none)'}

**Condition ID:** ${listing.conditionId}
**Condition Description:** ${listing.conditionDescription || '(none)'}

**Item Specifics:**
${Object.entries(listing.itemSpecifics)
  .filter(([, value]) => value !== undefined)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join('\n')}

**Category ID:** ${listing.categoryId}

**Description:**
${listing.description}

## REFERENCE DATA
- Inventory Condition: ${inventoryCondition}
- Listing Price: £${price.toFixed(2)}

## IMPORTANT: TRUST THE PROVIDED DATA
The item specifics (piece count, minifigure count, year, theme, etc.) come from verified Brickset database records.
**DO NOT flag these as inaccurate even if they differ from your knowledge.** The Brickset data is authoritative.
Only flag issues with:
- Title optimization and keyword usage
- Description formatting and completeness
- Condition mapping accuracy
- Missing recommended fields

## SCORING CRITERIA (100 points total)

### Title (25 points)
- Length optimization (65-80 chars ideal): 0-10 points
- Keyword placement (important terms first): 0-8 points
- Readability and natural language: 0-7 points

### Item Specifics (20 points)
- Required fields complete (Brand, Theme, Set Number, MPN): 0-10 points
- Recommended fields populated: 0-5 points
- Values present and properly formatted: 0-5 points (DO NOT verify factual accuracy - trust the data)

### Description (25 points)
- Completeness (what's included, condition): 0-10 points
- Formatting and readability: 0-8 points
- Mobile-friendliness (not too long): 0-7 points

### Condition Accuracy (15 points)
- Correct condition ID mapping: 0-10 points
- Appropriate condition description: 0-5 points

### SEO Optimization (15 points)
- Keyword usage in description: 0-8 points
- Category selection accuracy: 0-7 points

## OUTPUT FORMAT

Return ONLY valid JSON:
{
  "score": number (0-100),
  "grade": "A+" | "A" | "B" | "C" | "D" | "F",
  "breakdown": {
    "title": { "score": number (0-25), "feedback": "string" },
    "itemSpecifics": { "score": number (0-20), "feedback": "string" },
    "description": { "score": number (0-25), "feedback": "string" },
    "conditionAccuracy": { "score": number (0-15), "feedback": "string" },
    "seoOptimization": { "score": number (0-15), "feedback": "string" }
  },
  "issues": ["critical issues that should be fixed"],
  "suggestions": ["non-critical improvements"],
  "highlights": ["things done well"]
}

## GRADING SCALE
- A+ (95-100): Exceptional, publication-ready
- A (85-94): Excellent, minor tweaks optional
- B (75-84): Good, some improvements recommended
- C (65-74): Acceptable, notable issues to address
- D (50-64): Below average, significant improvements needed
- F (<50): Poor, requires major revision`;
}

/**
 * Type for quality review result
 */
export interface QualityReviewBreakdown {
  score: number;
  feedback: string;
}

export interface QualityReviewResponse {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: {
    title: QualityReviewBreakdown;
    itemSpecifics: QualityReviewBreakdown;
    description: QualityReviewBreakdown;
    conditionAccuracy: QualityReviewBreakdown;
    seoOptimization: QualityReviewBreakdown;
  };
  issues: string[];
  suggestions: string[];
  highlights: string[];
}

/**
 * Convert numeric score to letter grade
 */
export function scoreToGrade(score: number): QualityReviewResponse['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
