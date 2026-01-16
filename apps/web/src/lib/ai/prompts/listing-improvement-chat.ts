/**
 * AI Prompt for Listing Improvement Chat
 *
 * Creates the system prompt for the conversational assistant
 * that helps users improve their eBay listings based on quality review feedback.
 */

import type { QualityReviewResult } from '@/lib/ebay/listing-creation.types';

/**
 * Context for the listing improvement chat
 */
export interface ListingChatContext {
  title: string;
  description: string;
  itemSpecifics: Record<string, string>;
  qualityScore: number;
  qualityFeedback: QualityReviewResult;
  listingPrice: number | null;
  descriptionStyle: string | null;
}

/**
 * Creates the system prompt for the listing improvement chat assistant
 */
export function createListingImprovementSystemPrompt(context: ListingChatContext): string {
  const { title, itemSpecifics, qualityScore, qualityFeedback, listingPrice } = context;

  // Format item specifics for the prompt
  const specificsFormatted = Object.entries(itemSpecifics)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  // Format issues, suggestions, and highlights
  const issuesFormatted =
    qualityFeedback.issues.length > 0
      ? qualityFeedback.issues.map((i) => `- ${i}`).join('\n')
      : 'None';

  const suggestionsFormatted =
    qualityFeedback.suggestions.length > 0
      ? qualityFeedback.suggestions.map((s) => `- ${s}`).join('\n')
      : 'None';

  const highlightsFormatted =
    qualityFeedback.highlights.length > 0
      ? qualityFeedback.highlights.map((h) => `- ${h}`).join('\n')
      : 'None';

  // Format score breakdown
  const breakdownFormatted = [
    `- Title: ${qualityFeedback.breakdown.title.score}/25 - "${qualityFeedback.breakdown.title.feedback}"`,
    `- Item Specifics: ${qualityFeedback.breakdown.itemSpecifics.score}/20 - "${qualityFeedback.breakdown.itemSpecifics.feedback}"`,
    `- Description: ${qualityFeedback.breakdown.description.score}/25 - "${qualityFeedback.breakdown.description.feedback}"`,
    `- Condition Accuracy: ${qualityFeedback.breakdown.conditionAccuracy.score}/15 - "${qualityFeedback.breakdown.conditionAccuracy.feedback}"`,
    `- SEO Optimization: ${qualityFeedback.breakdown.seoOptimization.score}/15 - "${qualityFeedback.breakdown.seoOptimization.feedback}"`,
  ].join('\n');

  return `You are an eBay listing optimization assistant specializing in LEGO products. You help sellers improve their listings to achieve better search visibility and higher conversion rates.

## CURRENT LISTING

**Title (${title.length}/80 characters):**
${title}

**Price:** ${listingPrice ? `£${listingPrice.toFixed(2)}` : 'Not set'}

**Item Specifics:**
${specificsFormatted}

## QUALITY REVIEW RESULTS

**Overall Score:** ${qualityScore}/100 (Grade: ${qualityFeedback.grade})

**Score Breakdown:**
${breakdownFormatted}

**Issues to Address:**
${issuesFormatted}

**Suggestions for Improvement:**
${suggestionsFormatted}

**What's Working Well:**
${highlightsFormatted}

## YOUR ROLE

1. **Answer questions** about the listing quality review and what specific scores mean
2. **Suggest specific improvements** to title, description, or item specifics
3. **Explain how changes would impact** the quality score and search visibility
4. **Provide alternative wording** when asked for title or description improvements
5. **Focus on eBay SEO best practices** for LEGO products

## GUIDELINES

- Be concise and actionable - provide specific text changes, not vague advice
- When suggesting title changes, always stay within 80 characters
- Reference the score breakdown when explaining what needs improvement
- Acknowledge the highlights - don't suggest changing things that are already working well
- For LEGO items, emphasize set numbers, themes, and condition in titles
- Remember that eBay's search algorithm favors titles with relevant keywords at the start

## RESPONSE FORMAT

Keep responses short and focused. When providing improved text:
- Use **bold** for suggested new text
- Explain briefly why the change helps
- Note the expected impact on the score category`;
}

/**
 * Message type for chat conversation
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
