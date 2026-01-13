/**
 * Purchase Evaluator Module
 *
 * Exports for the purchase evaluation feature.
 *
 * NOTE: PurchaseEvaluatorService is NOT exported from this barrel file
 * because it contains server-side dependencies (Supabase server client).
 * Import it directly from './evaluator.service' in API routes only.
 */

export {
  parseEvaluationContent,
  parseAndConsolidate,
  consolidateDuplicates,
  generateTemplate,
} from './parser';

export {
  calculateCOGPercent,
  calculateEbayProfit,
  calculateItemProfitability,
  allocateCostsProportionally,
  allocateCostsEqually,
  calculateEvaluationSummary,
} from './calculations';

export * from './types';
