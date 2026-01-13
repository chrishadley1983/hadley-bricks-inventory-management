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

// Photo analysis types - explicitly exported to avoid naming conflicts
export type {
  PhotoItemType,
  BoxCondition,
  SealStatus,
  AIModel,
  ModelIdentification,
  BrickognizeItem,
  GeminiSetExtraction,
  PhotoAnalysisItem,
  PhotoAnalysisResult,
  PhotoAnalysisOptions,
  OpusAnalysisResponse,
  GeminiExtractionResponse,
  AnalysisImageInput,
  // EvaluationMode is already exported from ./types
  EbayFeeBreakdown,
  AmazonFeeBreakdown,
} from './photo-types';

export {
  generatePhotoItemId,
  createEmptyPhotoAnalysisItem,
  getItemTypeLabel,
  getBoxConditionColor,
  getConfidenceColor,
  formatConfidence,
} from './photo-types';

// Image chunking utilities (client-side)
export {
  processImagesForChunking,
  detectItemRegions,
  cropImageToRegion,
  isChunkingAvailable,
  type ItemRegion,
  type ChunkedImage,
  type ChunkingResult,
} from './image-chunking.service';
