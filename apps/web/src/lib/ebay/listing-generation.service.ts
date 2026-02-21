/**
 * eBay Listing Generation Service
 *
 * Uses Claude Opus 4.5 to generate optimized eBay listing content
 * from inventory item data and research.
 */

import { sendMessageForJSON } from '@/lib/ai/claude-client';
import {
  GENERATE_LISTING_SYSTEM_PROMPT,
  createGenerateListingMessage,
  type ListingInventoryInput,
  type ListingResearchData,
  type ListingTemplate,
  type GeneratedListingResponse,
} from '@/lib/ai/prompts/generate-listing';
import type { DescriptionStyle, AIGeneratedListing } from './listing-creation.types';

// Claude Opus 4.5 model ID
const CLAUDE_OPUS_MODEL = 'claude-opus-4-5-20251101';

/**
 * Options for listing generation
 */
export interface ListingGenerationOptions {
  /** Description style to use */
  style: DescriptionStyle;
  /** Optional template to incorporate */
  template?: ListingTemplate;
  /** Listing price for context */
  price: number;
}

/**
 * Service for generating eBay listings using AI
 */
export class ListingGenerationService {
  /**
   * Generate an eBay listing from inventory item data
   *
   * @param item - Inventory item data
   * @param options - Generation options (style, template, price)
   * @param research - Optional Brickset research data
   * @returns Generated listing content
   */
  async generateListing(
    item: ListingInventoryInput,
    options: ListingGenerationOptions,
    research?: ListingResearchData
  ): Promise<AIGeneratedListing> {
    console.log(
      `[ListingGenerationService] Generating listing for ${item.setNumber} with style: ${options.style}`
    );

    // Create the prompt message
    const userMessage = createGenerateListingMessage(
      item,
      options.style,
      options.template,
      research
    );

    // Call Claude Opus 4.5 for generation
    const response = await sendMessageForJSON<GeneratedListingResponse>(
      GENERATE_LISTING_SYSTEM_PROMPT,
      userMessage,
      {
        model: CLAUDE_OPUS_MODEL,
        maxTokens: 4096,
        temperature: 0.4, // Slightly creative but mostly consistent
      }
    );

    console.log(
      `[ListingGenerationService] Generated listing with confidence: ${response.confidence}%`
    );

    // Transform to AIGeneratedListing format
    return this.transformResponse(response, item.setNumber, options.price);
  }

  /**
   * Transform API response to our AIGeneratedListing type
   */
  private transformResponse(
    response: GeneratedListingResponse,
    sku: string,
    price: number
  ): AIGeneratedListing {
    return {
      title: response.title,
      subtitle: response.subtitle,
      description: response.description,
      conditionId: response.conditionId,
      conditionDescription: response.conditionDescription,
      itemSpecifics: response.itemSpecifics,
      categoryId: response.categoryId,
      sku,
      price,
      confidence: response.confidence,
      recommendations: response.recommendations,
    };
  }

  /**
   * Validate a generated title meets eBay requirements
   */
  validateTitle(title: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Length check
    if (title.length > 80) {
      errors.push(`Title exceeds 80 characters (${title.length})`);
    }

    if (title.length < 40) {
      errors.push(`Title is too short (${title.length} chars). Aim for 65-80.`);
    }

    // Prohibited patterns
    const prohibitedPatterns = [
      { pattern: /!!!/, msg: 'Multiple exclamation marks' },
      { pattern: /\*\*\*/, msg: 'Multiple asterisks' },
      { pattern: /\bLOOK\b/i, msg: 'Promotional word "LOOK"' },
      { pattern: /\bWOW\b/i, msg: 'Promotional word "WOW"' },
      { pattern: /L@@K/i, msg: 'Promotional pattern "L@@K"' },
      { pattern: /\bFREE\b/i, msg: 'Promotional word "FREE"' },
      { pattern: /\bBEST\b/i, msg: 'Promotional word "BEST"' },
    ];

    for (const { pattern, msg } of prohibitedPatterns) {
      if (pattern.test(title)) {
        errors.push(`Contains prohibited content: ${msg}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate item specifics are complete
   */
  validateItemSpecifics(specifics: GeneratedListingResponse['itemSpecifics']): {
    valid: boolean;
    missing: string[];
    warnings: string[];
  } {
    const required = ['Brand', 'LEGO Theme', 'LEGO Set Number', 'MPN'];
    const recommended = ['Piece Count', 'Age Level'];

    const missing: string[] = [];
    const warnings: string[] = [];

    for (const field of required) {
      if (!specifics[field]) {
        missing.push(field);
      }
    }

    for (const field of recommended) {
      if (!specifics[field]) {
        warnings.push(`Recommended field "${field}" is empty`);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
      warnings,
    };
  }

  /**
   * Map inventory condition string to eBay condition ID
   */
  mapConditionToId(condition: string): number {
    const normalizedCondition = condition.toLowerCase();

    // New conditions
    if (
      normalizedCondition.includes('factory sealed') ||
      normalizedCondition === 'sealed' ||
      normalizedCondition === 'new'
    ) {
      return 1000; // NEW
    }

    if (
      normalizedCondition.includes('open box') ||
      normalizedCondition.includes('new other') ||
      normalizedCondition.includes('like new')
    ) {
      return 1500; // NEW_OTHER
    }

    // Used conditions
    if (normalizedCondition.includes('excellent')) {
      return 3000; // USED_EXCELLENT
    }

    if (normalizedCondition.includes('very good')) {
      return 4000; // USED_VERY_GOOD
    }

    if (normalizedCondition.includes('good')) {
      return 5000; // USED_GOOD
    }

    if (normalizedCondition.includes('acceptable')) {
      return 6000; // USED_ACCEPTABLE
    }

    // Parts/incomplete
    if (
      normalizedCondition.includes('parts') ||
      normalizedCondition.includes('incomplete') ||
      normalizedCondition.includes('not working')
    ) {
      return 7000; // FOR_PARTS_OR_NOT_WORKING
    }

    // Default to used for anything else
    if (normalizedCondition === 'used') {
      return 3000; // USED_EXCELLENT (default for generic "used")
    }

    // Fallback
    return 3000;
  }

  /**
   * Map eBay condition ID to condition enum string
   */
  mapConditionIdToEnum(
    conditionId: number
  ):
    | 'NEW'
    | 'NEW_OTHER'
    | 'USED_EXCELLENT'
    | 'USED_VERY_GOOD'
    | 'USED_GOOD'
    | 'USED_ACCEPTABLE'
    | 'FOR_PARTS_OR_NOT_WORKING' {
    switch (conditionId) {
      case 1000:
        return 'NEW';
      case 1500:
        return 'NEW_OTHER';
      case 3000:
        return 'USED_EXCELLENT';
      case 4000:
        return 'USED_VERY_GOOD';
      case 5000:
        return 'USED_GOOD';
      case 6000:
        return 'USED_ACCEPTABLE';
      case 7000:
        return 'FOR_PARTS_OR_NOT_WORKING';
      default:
        return 'USED_EXCELLENT';
    }
  }
}
