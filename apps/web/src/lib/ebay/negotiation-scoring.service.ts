/**
 * Negotiation Scoring Service
 *
 * Calculates a score (0-100) for each eligible listing to determine
 * the appropriate discount percentage for offers.
 *
 * Score is based on weighted factors:
 * - Listing age (default 50%): How long since original listing date
 * - Stock level (default 15%): Higher stock = higher urgency to clear
 * - Item value (default 15%): Lower value = more aggressive discounting OK
 * - Category (default 10%): Category-specific adjustments
 * - Watcher count (default 10%): Fewer watchers = needs bigger discount
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NegotiationScoringWeights,
  NegotiationScoringInput,
  NegotiationScoreResult,
} from './negotiation.types';

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_WEIGHTS: NegotiationScoringWeights = {
  listingAge: 50,
  stockLevel: 15,
  itemValue: 15,
  category: 10,
  watchers: 10,
};

// Minimum discount percentage (enforced throughout the system)
export const MIN_DISCOUNT_PERCENTAGE = 10;

// Maximum discount percentage allowed
export const MAX_DISCOUNT_PERCENTAGE = 50;

// Maximum age in days for full score (listings older than this get max age score)
const MAX_AGE_DAYS_FOR_SCORING = 90;

// Default discount percentages when no rules configured
const DEFAULT_DISCOUNT_MAP: Array<{ minScore: number; maxScore: number; discount: number }> = [
  { minScore: 0, maxScore: 39, discount: 10 },
  { minScore: 40, maxScore: 59, discount: 15 },
  { minScore: 60, maxScore: 79, discount: 20 },
  { minScore: 80, maxScore: 100, discount: 25 },
];

// ============================================================================
// Scoring Service Class
// ============================================================================

export class NegotiationScoringService {
  private weights: NegotiationScoringWeights;

  constructor(weights?: Partial<NegotiationScoringWeights>) {
    this.weights = {
      listingAge: weights?.listingAge ?? DEFAULT_WEIGHTS.listingAge,
      stockLevel: weights?.stockLevel ?? DEFAULT_WEIGHTS.stockLevel,
      itemValue: weights?.itemValue ?? DEFAULT_WEIGHTS.itemValue,
      category: weights?.category ?? DEFAULT_WEIGHTS.category,
      watchers: weights?.watchers ?? DEFAULT_WEIGHTS.watchers,
    };
  }

  /**
   * Calculate the overall score for a listing
   *
   * @param input The scoring input data
   * @returns Score result with overall score (0-100) and individual factors
   */
  calculateScore(input: NegotiationScoringInput): NegotiationScoreResult {
    const factors = {
      listing_age: this.calculateAgeScore(input.originalListingDate),
      stock_level: this.calculateStockScore(input.stockLevel),
      item_value: this.calculateValueScore(input.itemCost),
      category: this.calculateCategoryScore(input.category),
      watchers: this.calculateWatcherScore(input.watcherCount),
    };

    // Weighted sum: each factor is 0-100, weights should sum to 100
    const weightedSum =
      factors.listing_age * this.weights.listingAge +
      factors.stock_level * this.weights.stockLevel +
      factors.item_value * this.weights.itemValue +
      factors.category * this.weights.category +
      factors.watchers * this.weights.watchers;

    const totalWeight =
      this.weights.listingAge +
      this.weights.stockLevel +
      this.weights.itemValue +
      this.weights.category +
      this.weights.watchers;

    // Normalize to 0-100 range
    const score = Math.round(weightedSum / totalWeight);

    return {
      score: Math.min(100, Math.max(0, score)),
      factors,
    };
  }

  /**
   * Calculate the listing age score
   *
   * Higher score = older listing = more likely to need aggressive discount
   * - 0 days = 0 score
   * - 30 days = 33 score
   * - 60 days = 67 score
   * - 90+ days = 100 score
   */
  private calculateAgeScore(listingDate: Date): number {
    const now = new Date();
    const daysSinceListing = Math.floor(
      (now.getTime() - listingDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceListing <= 0) return 0;
    if (daysSinceListing >= MAX_AGE_DAYS_FOR_SCORING) return 100;

    // Linear scaling: 0 days = 0, MAX_AGE_DAYS = 100
    return Math.round((daysSinceListing / MAX_AGE_DAYS_FOR_SCORING) * 100);
  }

  /**
   * Calculate the stock level score
   *
   * Higher score = more stock = more urgent to clear
   * - 1 item = 20 score (low urgency)
   * - 2-3 items = 50 score (medium urgency)
   * - 4-5 items = 70 score (high urgency)
   * - 6+ items = 100 score (very high urgency)
   */
  private calculateStockScore(stockLevel: number): number {
    if (stockLevel <= 1) return 20;
    if (stockLevel <= 3) return 50;
    if (stockLevel <= 5) return 70;
    return 100;
  }

  /**
   * Calculate the item value score
   *
   * Higher score = lower value = OK to discount more aggressively
   * Lower score = higher value = protect margin
   * - >= GBP 100 = 20 score (protect margin)
   * - GBP 50-99 = 40 score
   * - GBP 25-49 = 60 score
   * - < GBP 25 = 80 score (OK to discount)
   */
  private calculateValueScore(cost: number): number {
    if (cost >= 100) return 20;
    if (cost >= 50) return 40;
    if (cost >= 25) return 60;
    return 80;
  }

  /**
   * Calculate the category score
   *
   * Default neutral score; can be enhanced with category-specific rules
   * based on historical conversion data.
   *
   * Future enhancement: Learn from data which categories need bigger discounts
   */
  private calculateCategoryScore(_category?: string): number {
    // Default neutral score - all categories treated equally for now
    // TODO: Implement category-specific scoring based on historical data
    return 50;
  }

  /**
   * Calculate the watcher score
   *
   * Higher score = fewer watchers = needs bigger discount to convert
   * Lower score = more watchers = high interest, smaller discount OK
   * - 10+ watchers = 20 score (high interest)
   * - 5-9 watchers = 40 score
   * - 2-4 watchers = 60 score
   * - 0-1 watchers = 80 score (low interest, needs push)
   */
  private calculateWatcherScore(watcherCount: number): number {
    if (watcherCount >= 10) return 20;
    if (watcherCount >= 5) return 40;
    if (watcherCount >= 2) return 60;
    return 80;
  }

  /**
   * Get the discount percentage for a given score
   *
   * @param userId The user ID for custom rules lookup
   * @param score The calculated score (0-100)
   * @param supabase Supabase client for database access
   * @returns Discount percentage (minimum 10%)
   */
  async getDiscountForScore(
    userId: string,
    score: number,
    supabase: SupabaseClient
  ): Promise<number> {
    // Query user's custom discount rules
    const { data: rules, error } = await supabase
      .from('negotiation_discount_rules')
      .select('min_score, max_score, discount_percentage')
      .eq('user_id', userId)
      .order('min_score', { ascending: true });

    if (error) {
      console.error('[NegotiationScoringService] Error fetching rules:', error);
      // Fall back to default mapping
      return this.getDefaultDiscount(score);
    }

    if (!rules || rules.length === 0) {
      // No custom rules configured, use default mapping
      return this.getDefaultDiscount(score);
    }

    // Find matching rule for the score
    const matchingRule = rules.find(
      (rule) => score >= rule.min_score && score <= rule.max_score
    );

    if (matchingRule) {
      // Ensure minimum 10% discount
      return Math.max(MIN_DISCOUNT_PERCENTAGE, matchingRule.discount_percentage);
    }

    // No matching rule, use default
    return this.getDefaultDiscount(score);
  }

  /**
   * Get discount from default mapping
   */
  private getDefaultDiscount(score: number): number {
    const match = DEFAULT_DISCOUNT_MAP.find(
      (rule) => score >= rule.minScore && score <= rule.maxScore
    );
    return match ? match.discount : MIN_DISCOUNT_PERCENTAGE;
  }

  /**
   * Validate that discount rules don't have gaps or overlaps
   *
   * @param rules Array of discount rules to validate
   * @returns Validation result with any errors
   */
  static validateDiscountRules(
    rules: Array<{ minScore: number; maxScore: number; discountPercentage: number }>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check each rule
    for (const rule of rules) {
      // Check min <= max
      if (rule.minScore > rule.maxScore) {
        errors.push(
          `Invalid range: min (${rule.minScore}) > max (${rule.maxScore})`
        );
      }

      // Check discount >= 10%
      if (rule.discountPercentage < MIN_DISCOUNT_PERCENTAGE) {
        errors.push(
          `Discount must be at least ${MIN_DISCOUNT_PERCENTAGE}%: got ${rule.discountPercentage}%`
        );
      }

      // Check discount <= MAX_DISCOUNT_PERCENTAGE
      if (rule.discountPercentage > MAX_DISCOUNT_PERCENTAGE) {
        errors.push(
          `Discount must be at most ${MAX_DISCOUNT_PERCENTAGE}%: got ${rule.discountPercentage}%`
        );
      }

      // Check score range is valid
      if (rule.minScore < 0 || rule.maxScore > 100) {
        errors.push(
          `Score must be between 0-100: got ${rule.minScore}-${rule.maxScore}`
        );
      }
    }

    // Check for overlapping ranges
    const sortedRules = [...rules].sort((a, b) => a.minScore - b.minScore);
    for (let i = 0; i < sortedRules.length - 1; i++) {
      const current = sortedRules[i];
      const next = sortedRules[i + 1];
      if (current.maxScore >= next.minScore) {
        errors.push(
          `Overlapping ranges: ${current.minScore}-${current.maxScore} and ${next.minScore}-${next.maxScore}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if listing age weight is at least 50%
   * (Required by F5 criterion)
   */
  isListingAgePrimaryFactor(): boolean {
    const totalWeight =
      this.weights.listingAge +
      this.weights.stockLevel +
      this.weights.itemValue +
      this.weights.category +
      this.weights.watchers;

    return (this.weights.listingAge / totalWeight) >= 0.5;
  }

  /**
   * Get current weights
   */
  getWeights(): NegotiationScoringWeights {
    return { ...this.weights };
  }

  /**
   * Update weights (creates new instance)
   */
  withWeights(weights: Partial<NegotiationScoringWeights>): NegotiationScoringService {
    return new NegotiationScoringService({
      ...this.weights,
      ...weights,
    });
  }
}
