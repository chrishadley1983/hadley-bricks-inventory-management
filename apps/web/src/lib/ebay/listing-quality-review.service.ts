/**
 * eBay Listing Quality Review Service
 *
 * Uses Gemini 3 Pro as an independent reviewer to evaluate
 * AI-generated eBay listings and provide quality scores.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  createQualityReviewPrompt,
  type QualityReviewResponse,
} from '@/lib/ai/prompts/review-listing-quality';
import type { AIGeneratedListing, QualityReviewResult } from './listing-creation.types';
import type { GeneratedListingResponse } from '@/lib/ai/prompts/generate-listing';

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
}
