/**
 * Photo Analysis Service
 *
 * Orchestrates the multi-model AI pipeline for analyzing LEGO lot photos.
 * Uses Claude Opus for primary analysis, Gemini for verification,
 * and Brickognize for specialized part/minifig identification.
 */

import { sendMessageWithImagesForJSON } from '../ai/claude-client';
import {
  PHOTO_LOT_SYSTEM_PROMPT,
  createPhotoLotUserMessage,
  validateOpusResponse,
} from '../ai/prompts/evaluate-photo-lot';
import {
  extractSetNumbersWithGemini,
  isGeminiConfigured,
  type GeminiImageInput,
} from '../ai/gemini-client';
import {
  identifyAllItemsFromImages,
  getBestSetMatch,
  getMinifigMatches,
  getPartMatches,
  type BrickognizeImageInput,
} from '../brickognize/client';
import type {
  PhotoAnalysisResult,
  PhotoAnalysisItem,
  PhotoAnalysisOptions,
  AnalysisImageInput,
  OpusAnalysisResponse,
  ModelIdentification,
  AIModel,
  BrickognizeItem,
} from './photo-types';
import { generatePhotoItemId } from './photo-types';

// ============================================
// Configuration
// ============================================

/**
 * Confidence boost when models agree
 */
const CONFIDENCE_BOOST_AGREEMENT = 0.15;

/**
 * Confidence boost when Brickognize confirms
 */
const CONFIDENCE_BOOST_BRICKOGNIZE = 0.1;

/**
 * Maximum confidence score
 */
const MAX_CONFIDENCE = 1.0;

/**
 * Threshold for flagging disagreement
 */
const DISAGREEMENT_THRESHOLD = 0.3;

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze photos using multi-model AI pipeline
 *
 * Pipeline:
 * 1. Claude Opus: Primary analysis (condition, identification)
 * 2. Gemini Flash: Cross-verify set numbers (parallel)
 * 3. Brickognize: Identify parts/minifigs (parallel)
 * 4. Merge results and calculate combined confidence
 *
 * @param images - Array of images to analyze
 * @param options - Analysis configuration options
 * @returns Complete analysis result
 */
export async function analyzePhotos(
  images: AnalysisImageInput[],
  options: PhotoAnalysisOptions = {
    useGeminiVerification: true,
    useBrickognize: true,
  }
): Promise<PhotoAnalysisResult> {
  const startTime = Date.now();
  const modelsUsed: AIModel[] = ['opus'];

  if (images.length === 0) {
    return createEmptyResult(startTime, modelsUsed);
  }

  // Step 1: Primary analysis with Claude Opus
  console.log('[PhotoAnalysis] Starting Claude Opus analysis...');
  const opusResult = await analyzeWithOpus(images, options.listingDescription);

  // Step 2: Parallel verification with other models
  console.log('[PhotoAnalysis] Running parallel verification...');
  const [geminiResult, brickognizeResult] = await Promise.all([
    options.useGeminiVerification && isGeminiConfigured()
      ? runGeminiVerification(images)
      : null,
    options.useBrickognize ? runBrickognizeIdentification(images) : null,
  ]);

  if (geminiResult) modelsUsed.push('gemini');
  if (brickognizeResult) modelsUsed.push('brickognize');

  // Step 3: Merge and reconcile results
  console.log('[PhotoAnalysis] Merging results...');
  const mergedItems = mergeModelResults(opusResult, geminiResult, brickognizeResult);

  // Step 4: Calculate final confidence and prepare result
  const processingTimeMs = Date.now() - startTime;

  return {
    items: mergedItems,
    overallNotes: opusResult.overallNotes,
    analysisConfidence: calculateOverallConfidence(mergedItems),
    warnings: collectWarnings(opusResult, mergedItems),
    sourceDescription: options.listingDescription || null,
    modelsUsed,
    processingTimeMs,
  };
}

// ============================================
// Model-Specific Analysis Functions
// ============================================

/**
 * Run primary analysis with Claude Opus
 */
async function analyzeWithOpus(
  images: AnalysisImageInput[],
  listingDescription?: string
): Promise<OpusAnalysisResponse> {
  try {
    const claudeImages = images.map((img) => ({
      base64: img.base64,
      mediaType: img.mediaType,
    }));

    const userMessage = createPhotoLotUserMessage(images.length, listingDescription);

    const response = await sendMessageWithImagesForJSON<OpusAnalysisResponse>(
      PHOTO_LOT_SYSTEM_PROMPT,
      userMessage,
      claudeImages,
      {
        model: 'claude-opus-4-20250514', // Use Opus for best reasoning
        maxTokens: 4096,
        temperature: 0.2, // Low temperature for consistent structured output
      }
    );

    return validateOpusResponse(response);
  } catch (error) {
    console.error('[PhotoAnalysis] Opus analysis failed:', error);
    throw new Error(
      `Claude Opus analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Run Gemini verification for set numbers
 */
async function runGeminiVerification(
  images: AnalysisImageInput[]
): Promise<{ setNumbers: { number: string; confidence: number }[] } | null> {
  try {
    const geminiImages: GeminiImageInput[] = images.map((img) => ({
      base64: img.base64,
      mimeType: img.mediaType,
    }));

    const result = await extractSetNumbersWithGemini(geminiImages);

    return {
      setNumbers: result.setNumbers.map((s) => ({
        number: s.setNumber,
        confidence: s.confidence,
      })),
    };
  } catch (error) {
    console.error('[PhotoAnalysis] Gemini verification failed:', error);
    return null;
  }
}

/**
 * Run Brickognize identification
 */
async function runBrickognizeIdentification(
  images: AnalysisImageInput[]
): Promise<BrickognizeItem[] | null> {
  try {
    const brickognizeImages: BrickognizeImageInput[] = images.map((img, i) => ({
      base64: img.base64,
      filename: img.filename || `image-${i}.jpg`,
    }));

    const result = await identifyAllItemsFromImages(brickognizeImages);

    if (result.success) {
      return result.items;
    }

    console.warn('[PhotoAnalysis] Brickognize returned error:', result.error);
    return null;
  } catch (error) {
    console.error('[PhotoAnalysis] Brickognize identification failed:', error);
    return null;
  }
}

// ============================================
// Result Merging Logic
// ============================================

/**
 * Merge results from all models
 */
function mergeModelResults(
  opusResult: OpusAnalysisResponse,
  geminiResult: { setNumbers: { number: string; confidence: number }[] } | null,
  brickognizeItems: BrickognizeItem[] | null
): PhotoAnalysisItem[] {
  const mergedItems: PhotoAnalysisItem[] = [];

  for (const opusItem of opusResult.items) {
    const modelIdentifications: ModelIdentification[] = [];

    // Add Opus identification
    modelIdentifications.push({
      model: 'opus',
      setNumber: opusItem.setNumber,
      setName: opusItem.setName,
      confidence: opusItem.confidenceScore,
      rawResponse: opusItem.rawDescription,
    });

    let confidenceBoost = 0;
    let modelsAgree = true;

    // Check Gemini verification (for sets)
    if (geminiResult && opusItem.itemType === 'set' && opusItem.setNumber) {
      const geminiMatch = geminiResult.setNumbers.find(
        (s) => normalizeSetNumber(s.number) === normalizeSetNumber(opusItem.setNumber!)
      );

      if (geminiMatch) {
        modelIdentifications.push({
          model: 'gemini',
          setNumber: geminiMatch.number,
          setName: null,
          confidence: geminiMatch.confidence,
        });
        confidenceBoost += CONFIDENCE_BOOST_AGREEMENT;
      } else if (geminiResult.setNumbers.length > 0) {
        // Gemini found different numbers - check if any match
        const closestMatch = geminiResult.setNumbers[0];
        modelIdentifications.push({
          model: 'gemini',
          setNumber: closestMatch.number,
          setName: null,
          confidence: closestMatch.confidence,
        });
        modelsAgree = false;
      }
    }

    // Check Brickognize results
    if (brickognizeItems) {
      if (opusItem.itemType === 'set' && opusItem.setNumber) {
        const brickognizeMatch = getBestSetMatch(brickognizeItems);
        if (brickognizeMatch) {
          const matchesOpus =
            brickognizeMatch.id === opusItem.setNumber ||
            brickognizeMatch.externalIds?.bricklink === opusItem.setNumber;

          modelIdentifications.push({
            model: 'brickognize',
            setNumber: brickognizeMatch.id,
            setName: brickognizeMatch.name,
            confidence: brickognizeMatch.confidence,
          });

          if (matchesOpus) {
            confidenceBoost += CONFIDENCE_BOOST_BRICKOGNIZE;
          } else {
            modelsAgree = false;
          }
        }
      }
    }

    // Calculate final confidence
    let finalConfidence = Math.min(
      MAX_CONFIDENCE,
      opusItem.confidenceScore + confidenceBoost
    );

    // If models disagree significantly, flag for review
    const needsReview =
      opusItem.needsReview ||
      !modelsAgree ||
      finalConfidence < 0.5;

    const reviewReason = determineReviewReason(
      opusItem,
      modelsAgree,
      finalConfidence
    );

    // Build merged item
    const mergedItem: PhotoAnalysisItem = {
      id: generatePhotoItemId(),
      itemType: opusItem.itemType,
      setNumber: opusItem.setNumber,
      setName: opusItem.setName,
      condition: opusItem.condition,
      boxCondition: opusItem.boxCondition,
      sealStatus: opusItem.sealStatus,
      damageNotes: opusItem.damageNotes,
      confidenceScore: finalConfidence,
      needsReview,
      reviewReason,
      rawDescription: opusItem.rawDescription,
      modelIdentifications,
      modelsAgree,
      minifigId: null,
      minifigDescription: opusItem.minifigDescription,
      partIds: null,
      partsEstimate: opusItem.partsEstimate,
      quantity: opusItem.quantity,
    };

    // Enhance with Brickognize data for minifigs
    if (opusItem.itemType === 'minifig' && brickognizeItems) {
      const minifigMatches = getMinifigMatches(brickognizeItems);
      if (minifigMatches.length > 0) {
        mergedItem.minifigId = minifigMatches[0].externalIds?.bricklink || minifigMatches[0].id;
        mergedItem.brickognizeMatches = minifigMatches.slice(0, 3);
        mergedItem.confidenceScore = Math.min(
          MAX_CONFIDENCE,
          mergedItem.confidenceScore + CONFIDENCE_BOOST_BRICKOGNIZE
        );
      }
    }

    // Enhance with Brickognize data for parts
    if (opusItem.itemType === 'parts_lot' && brickognizeItems) {
      const partMatches = getPartMatches(brickognizeItems);
      if (partMatches.length > 0) {
        mergedItem.partIds = partMatches.slice(0, 10).map(
          (p) => p.externalIds?.bricklink || p.id
        );
        mergedItem.brickognizeMatches = partMatches.slice(0, 5);
      }
    }

    mergedItems.push(mergedItem);
  }

  return mergedItems;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize set number for comparison
 */
function normalizeSetNumber(setNumber: string): string {
  // Remove common suffixes like "-1" and clean whitespace
  return setNumber.replace(/-\d+$/, '').trim();
}

/**
 * Determine why an item needs review
 */
function determineReviewReason(
  opusItem: OpusAnalysisResponse['items'][0],
  modelsAgree: boolean,
  confidence: number
): string | null {
  if (opusItem.reviewReason) return opusItem.reviewReason;
  if (!modelsAgree) return 'AI models disagree on identification';
  if (confidence < 0.5) return 'Low confidence identification';
  if (opusItem.itemType === 'unknown') return 'Item type could not be determined';
  return null;
}

/**
 * Calculate overall confidence for the analysis
 */
function calculateOverallConfidence(items: PhotoAnalysisItem[]): number {
  if (items.length === 0) return 0;

  const sum = items.reduce((acc, item) => acc + item.confidenceScore, 0);
  return Math.round((sum / items.length) * 100) / 100;
}

/**
 * Collect all warnings from analysis
 */
function collectWarnings(
  opusResult: OpusAnalysisResponse,
  mergedItems: PhotoAnalysisItem[]
): string[] {
  const warnings: string[] = [...opusResult.warnings];

  // Add warnings for items needing review
  const reviewCount = mergedItems.filter((i) => i.needsReview).length;
  if (reviewCount > 0) {
    warnings.push(`${reviewCount} item(s) flagged for manual review`);
  }

  // Add warning if models disagreed
  const disagreementCount = mergedItems.filter((i) => !i.modelsAgree).length;
  if (disagreementCount > 0) {
    warnings.push(
      `AI models disagreed on ${disagreementCount} item(s) - please verify`
    );
  }

  return warnings;
}

/**
 * Create empty result when no images provided
 */
function createEmptyResult(
  startTime: number,
  modelsUsed: AIModel[]
): PhotoAnalysisResult {
  return {
    items: [],
    overallNotes: 'No images provided for analysis',
    analysisConfidence: 0,
    warnings: ['No images were provided'],
    sourceDescription: null,
    modelsUsed,
    processingTimeMs: Date.now() - startTime,
  };
}

// ============================================
// Utility Exports
// ============================================

export { isGeminiConfigured };
