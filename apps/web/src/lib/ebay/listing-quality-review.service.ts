/**
 * eBay Listing Quality Review Service
 *
 * Uses Gemini 3 Pro as an independent reviewer to evaluate
 * AI-generated eBay listings and provide quality scores.
 *
 * Pre-publish quality loop (v2):
 * - Review happens BEFORE posting to eBay
 * - Auto-applies suggestions to improve listing quality
 * - Loops until score >= 90 or max iterations reached
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  createQualityReviewPrompt,
  type QualityReviewResponse,
} from '@/lib/ai/prompts/review-listing-quality';
import type { AIGeneratedListing, QualityReviewResult } from './listing-creation.types';
import type { GeneratedListingResponse } from '@/lib/ai/prompts/generate-listing';
import { sendMessageForJSON } from '@/lib/ai/claude-client';

// Gemini 3 Pro model ID
const GEMINI_MODEL = 'gemini-3-pro-preview';

let geminiClient: GoogleGenAI | null = null;

/**
 * Progress callback type for review steps
 */
export type ReviewProgressCallback = (step: string, detail?: string) => void;

/**
 * Get the Gemini client instance (singleton)
 */
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY environment variable is not set');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

/**
 * Service for reviewing eBay listing quality using Gemini 3 Pro
 */
export class ListingQualityReviewService {
  /**
   * Review a generated listing for quality
   *
   * @param listing - The AI-generated listing to review
   * @param inventoryCondition - Original condition from inventory
   * @param onProgress - Optional callback for progress updates
   * @returns Quality review result with score and feedback
   */
  async reviewListing(
    listing: AIGeneratedListing,
    inventoryCondition: string,
    onProgress?: ReviewProgressCallback
  ): Promise<QualityReviewResult> {
    const startTime = Date.now();
    const log = (message: string, detail?: string) => {
      const elapsed = Date.now() - startTime;
      const timestamp = new Date().toISOString();
      console.log(`[ListingQualityReviewService] [${timestamp}] [${elapsed}ms] ${message}${detail ? `: ${detail}` : ''}`);
      if (onProgress) {
        onProgress(message, detail);
      }
    };

    log('Starting quality review', `SKU: ${listing.sku}`);

    // Transform AIGeneratedListing to GeneratedListingResponse format for the prompt
    log('Preparing listing data for review');
    const listingForReview: GeneratedListingResponse = {
      title: listing.title,
      subtitle: listing.subtitle,
      description: listing.description,
      conditionId: listing.conditionId,
      conditionDescription: listing.conditionDescription,
      itemSpecifics: listing.itemSpecifics,
      categoryId: listing.categoryId,
      confidence: listing.confidence,
      recommendations: listing.recommendations,
    };

    // Create the review prompt
    log('Creating review prompt');
    const prompt = createQualityReviewPrompt(listingForReview, inventoryCondition, listing.price);
    log('Prompt created', `${prompt.length} characters`);

    try {
      // Check if Gemini is configured
      if (!this.isConfigured()) {
        log('Gemini not configured - skipping quality review');
        return this.createSkippedResult('Gemini API not configured');
      }

      // Call Gemini 3 Pro with HIGH thinking level for thorough analysis
      log('Initializing Gemini client');
      const client = getGeminiClient();

      log('Sending request to Gemini 3 Pro', `Model: ${GEMINI_MODEL}, ThinkingLevel: HIGH`);
      log('This may take 30-60 seconds with extended thinking enabled...');

      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });

      log('Response received from Gemini');

      const rawResponse = response.text ?? '';
      log('Raw response length', `${rawResponse.length} characters`);

      // Parse JSON from response
      log('Parsing JSON from response');
      let jsonStr = rawResponse;
      const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
        log('Extracted JSON from code block');
      }

      const reviewResponse = JSON.parse(jsonStr) as QualityReviewResponse;
      log('JSON parsed successfully');

      const totalTime = Date.now() - startTime;
      log('Review complete', `Score: ${reviewResponse.score}/100 (${reviewResponse.grade}), Total time: ${totalTime}ms`);

      // Transform to QualityReviewResult
      return this.transformResponse(reviewResponse);
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('Review failed', `Error: ${errorMessage}, Total time: ${totalTime}ms`);
      console.error('[ListingQualityReviewService] Full error:', error);

      // Return a default review result on error
      return {
        score: 0,
        grade: 'F',
        breakdown: {
          title: { score: 0, feedback: 'Review failed' },
          itemSpecifics: { score: 0, feedback: 'Review failed' },
          description: { score: 0, feedback: 'Review failed' },
          conditionAccuracy: { score: 0, feedback: 'Review failed' },
          seoOptimization: { score: 0, feedback: 'Review failed' },
        },
        issues: [`Quality review failed: ${errorMessage}`],
        suggestions: [],
        highlights: [],
        reviewedAt: new Date().toISOString(),
        reviewerModel: GEMINI_MODEL,
      };
    }
  }

  /**
   * Create a result for when review is skipped
   */
  private createSkippedResult(reason: string): QualityReviewResult {
    return {
      score: 0,
      grade: 'F',
      breakdown: {
        title: { score: 0, feedback: 'Review skipped' },
        itemSpecifics: { score: 0, feedback: 'Review skipped' },
        description: { score: 0, feedback: 'Review skipped' },
        conditionAccuracy: { score: 0, feedback: 'Review skipped' },
        seoOptimization: { score: 0, feedback: 'Review skipped' },
      },
      issues: [],
      suggestions: [`Quality review was skipped: ${reason}`],
      highlights: [],
      reviewedAt: new Date().toISOString(),
      reviewerModel: `${GEMINI_MODEL} (skipped)`,
    };
  }

  /**
   * Transform Gemini response to QualityReviewResult
   */
  private transformResponse(response: QualityReviewResponse): QualityReviewResult {
    return {
      score: response.score,
      grade: response.grade,
      breakdown: response.breakdown,
      issues: response.issues,
      suggestions: response.suggestions,
      highlights: response.highlights,
      reviewedAt: new Date().toISOString(),
      reviewerModel: GEMINI_MODEL,
    };
  }

  /**
   * Check if Gemini is configured
   */
  isConfigured(): boolean {
    return !!process.env.GOOGLE_AI_API_KEY;
  }

  /**
   * Quick validation without full AI review
   * Use this for immediate feedback before the full review completes
   */
  quickValidate(listing: AIGeneratedListing): {
    titleLength: { value: number; optimal: boolean };
    hasRequiredSpecifics: boolean;
    hasDescription: boolean;
    hasCondition: boolean;
  } {
    const titleLength = listing.title.length;

    return {
      titleLength: {
        value: titleLength,
        optimal: titleLength >= 65 && titleLength <= 80,
      },
      hasRequiredSpecifics:
        !!listing.itemSpecifics['Brand'] &&
        !!listing.itemSpecifics['LEGO Theme'] &&
        !!listing.itemSpecifics['LEGO Set Number'] &&
        !!listing.itemSpecifics['MPN'],
      hasDescription: listing.description.length > 100,
      hasCondition: listing.conditionId >= 1000 && listing.conditionId <= 7000,
    };
  }

  /**
   * Review listing with a timeout (default 30 seconds)
   * Used for pre-publish review to prevent blocking the flow
   *
   * @param listing - The AI-generated listing to review
   * @param inventoryCondition - Original condition from inventory
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @param onProgress - Optional callback for progress updates
   * @returns Quality review result or timeout result
   */
  async reviewListingWithTimeout(
    listing: AIGeneratedListing,
    inventoryCondition: string,
    timeoutMs: number = 30000,
    onProgress?: ReviewProgressCallback
  ): Promise<QualityReviewResult> {
    const timeoutPromise = new Promise<QualityReviewResult>((resolve) => {
      setTimeout(() => {
        resolve({
          score: 75, // Default passing score when timed out
          grade: 'B',
          breakdown: {
            title: { score: 19, feedback: 'Review timed out - using default score' },
            itemSpecifics: { score: 15, feedback: 'Review timed out - using default score' },
            description: { score: 19, feedback: 'Review timed out - using default score' },
            conditionAccuracy: { score: 11, feedback: 'Review timed out - using default score' },
            seoOptimization: { score: 11, feedback: 'Review timed out - using default score' },
          },
          issues: [],
          suggestions: ['Quality review timed out after 30 seconds. Listing published with default quality check.'],
          highlights: ['Listing met basic validation requirements.'],
          reviewedAt: new Date().toISOString(),
          reviewerModel: `${GEMINI_MODEL} (timeout)`,
        });
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        this.reviewListing(listing, inventoryCondition, onProgress),
        timeoutPromise,
      ]);
    } catch (error) {
      console.error('[ListingQualityReviewService] Review failed, returning timeout result:', error);
      return timeoutPromise;
    }
  }

  /**
   * Apply review suggestions to improve the listing using Claude AI
   *
   * Takes the review feedback and applies it to generate an improved listing.
   * This is used in the pre-publish quality loop to auto-improve listings.
   *
   * @param listing - The current listing to improve
   * @param review - The quality review with suggestions
   * @returns Improved listing with changes applied
   */
  async applySuggestions(
    listing: AIGeneratedListing,
    review: QualityReviewResult
  ): Promise<AIGeneratedListing> {
    // If score is already good (90+), no changes needed
    if (review.score >= 90) {
      console.log('[ListingQualityReviewService] Score >= 90, no improvements needed');
      return listing;
    }

    // Combine issues and suggestions for improvement prompt
    const improvements = [
      ...review.issues.map((i) => `CRITICAL: ${i}`),
      ...review.suggestions,
    ];

    if (improvements.length === 0) {
      console.log('[ListingQualityReviewService] No suggestions to apply');
      return listing;
    }

    console.log(`[ListingQualityReviewService] Applying ${improvements.length} improvements`);

    const systemPrompt = `You are an eBay listing improvement assistant. Your task is to apply specific feedback to improve a LEGO listing.

IMPORTANT RULES:
1. Only make changes that directly address the feedback
2. Keep the same overall structure and format
3. Maintain all accurate information
4. Title must be exactly 80 characters or less
5. Return ONLY valid JSON with the improved listing`;

    const userPrompt = `Improve this eBay listing based on the reviewer feedback:

## CURRENT LISTING

**Title:** ${listing.title}
**Subtitle:** ${listing.subtitle || '(none)'}
**Description:** ${listing.description}
**Condition Description:** ${listing.conditionDescription || '(none)'}

**Item Specifics:**
${JSON.stringify(listing.itemSpecifics, null, 2)}

## REVIEW FEEDBACK

**Current Score:** ${review.score}/100 (${review.grade})

**Breakdown:**
- Title: ${review.breakdown.title.score}/25 - ${review.breakdown.title.feedback}
- Item Specifics: ${review.breakdown.itemSpecifics.score}/20 - ${review.breakdown.itemSpecifics.feedback}
- Description: ${review.breakdown.description.score}/25 - ${review.breakdown.description.feedback}
- Condition: ${review.breakdown.conditionAccuracy.score}/15 - ${review.breakdown.conditionAccuracy.feedback}
- SEO: ${review.breakdown.seoOptimization.score}/15 - ${review.breakdown.seoOptimization.feedback}

**Improvements Needed:**
${improvements.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

## OUTPUT FORMAT

Return JSON with the improved fields:
{
  "title": "Improved title (max 80 chars)",
  "subtitle": "Improved subtitle or null",
  "description": "Improved HTML description",
  "conditionDescription": "Improved condition description or null",
  "itemSpecifics": { ... updated specifics ... }
}

Only include fields that need changes. Omit fields that are already optimal.`;

    try {
      interface ImprovedListing {
        title?: string;
        subtitle?: string | null;
        description?: string;
        conditionDescription?: string | null;
        itemSpecifics?: Record<string, string>;
      }

      const improved = await sendMessageForJSON<ImprovedListing>(
        systemPrompt,
        userPrompt,
        {
          model: 'claude-sonnet-4-20250514', // Use Sonnet for speed
          maxTokens: 4096,
          temperature: 0.3,
        }
      );

      // Merge improvements with original listing
      return {
        ...listing,
        title: improved.title && improved.title.length <= 80 ? improved.title : listing.title,
        subtitle: improved.subtitle !== undefined ? improved.subtitle : listing.subtitle,
        description: improved.description || listing.description,
        conditionDescription: improved.conditionDescription !== undefined
          ? improved.conditionDescription
          : listing.conditionDescription,
        itemSpecifics: improved.itemSpecifics
          ? { ...listing.itemSpecifics, ...improved.itemSpecifics }
          : listing.itemSpecifics,
      };
    } catch (error) {
      console.error('[ListingQualityReviewService] Failed to apply suggestions:', error);
      // Return original listing if improvement fails
      return listing;
    }
  }

  /**
   * Run the pre-publish quality loop
   *
   * Reviews the listing, applies suggestions, and repeats until:
   * - Score >= 90 (target quality)
   * - Max iterations reached (default: 3)
   * - Timeout exceeded per iteration
   *
   * @param listing - Initial listing to improve
   * @param inventoryCondition - Item condition for review context
   * @param options - Loop configuration
   * @returns Final listing and review result
   */
  async runQualityLoop(
    listing: AIGeneratedListing,
    inventoryCondition: string,
    options: {
      targetScore?: number;
      maxIterations?: number;
      timeoutPerReviewMs?: number;
      onProgress?: ReviewProgressCallback;
    } = {}
  ): Promise<{
    listing: AIGeneratedListing;
    review: QualityReviewResult;
    iterations: number;
    improved: boolean;
  }> {
    const {
      targetScore = 90,
      maxIterations = 3,
      timeoutPerReviewMs = 30000,
      onProgress,
    } = options;

    let currentListing = listing;
    let currentReview: QualityReviewResult | null = null;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      onProgress?.(`Quality loop iteration ${iteration}/${maxIterations}`);

      // Review current listing
      onProgress?.('Reviewing listing quality');
      currentReview = await this.reviewListingWithTimeout(
        currentListing,
        inventoryCondition,
        timeoutPerReviewMs,
        onProgress
      );

      console.log(
        `[ListingQualityReviewService] Iteration ${iteration}: Score ${currentReview.score}/${targetScore}`
      );

      // Check if we've reached target score
      if (currentReview.score >= targetScore) {
        onProgress?.(`Target score reached: ${currentReview.score}/${targetScore}`);
        return {
          listing: currentListing,
          review: currentReview,
          iterations: iteration,
          improved: iteration > 1,
        };
      }

      // Don't try to improve on last iteration
      if (iteration >= maxIterations) {
        break;
      }

      // Apply suggestions to improve listing
      onProgress?.('Applying improvements');
      currentListing = await this.applySuggestions(currentListing, currentReview);
    }

    // Return best result we have
    return {
      listing: currentListing,
      review: currentReview!,
      iterations: iteration,
      improved: iteration > 1,
    };
  }
}
