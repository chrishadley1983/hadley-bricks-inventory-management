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
  SET_VERIFICATION_SYSTEM_PROMPT,
  createVerificationRequest,
} from '../ai/prompts/evaluate-photo-lot';
import {
  extractSetNumbersWithGemini,
  isGeminiConfigured,
  analyzePhotosWithGemini,
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
import {
  processImagesForChunking,
  isChunkingAvailable,
} from './image-chunking.service';

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
 * Currently unused but kept for future implementation
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DISAGREEMENT_THRESHOLD = 0.3;

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze photos using multi-model AI pipeline
 *
 * Pipeline:
 * 0. (Optional) Smart chunking: Pre-process to detect and isolate items
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
    useImageChunking: true,
  }
): Promise<PhotoAnalysisResult> {
  const startTime = Date.now();
  const primaryModel = options.primaryModel || 'claude';
  const modelsUsed: AIModel[] = [primaryModel === 'gemini' ? 'gemini' : 'opus'];

  if (images.length === 0) {
    return createEmptyResult(startTime, modelsUsed);
  }

  // Step 0: Smart image chunking (if enabled and available)
  let imagesToAnalyze: AnalysisImageInput[] = images;
  let chunkingMetadata: {
    wasChunked: boolean;
    chunkCount: number;
    reason: string;
  } = {
    wasChunked: false,
    chunkCount: images.length,
    reason: 'Chunking disabled or not available',
  };

  const shouldChunk = options.useImageChunking !== false && isChunkingAvailable();

  if (shouldChunk) {
    console.log('[PhotoAnalysis] Running smart image chunking pre-processor...');
    try {
      const chunkingResult = await processImagesForChunking(
        images,
        options.forceChunking || false
      );

      if (chunkingResult.wasChunked) {
        // Use chunked images for analysis
        imagesToAnalyze = chunkingResult.chunkedImages.map((chunk) => chunk.imageData);
        chunkingMetadata = {
          wasChunked: true,
          chunkCount: chunkingResult.chunkedImages.length,
          reason: chunkingResult.reason,
        };
        console.log(
          `[PhotoAnalysis] Chunking applied: ${images.length} images -> ${imagesToAnalyze.length} chunks`
        );
      } else {
        chunkingMetadata = {
          wasChunked: false,
          chunkCount: images.length,
          reason: chunkingResult.reason,
        };
        console.log('[PhotoAnalysis] Chunking not needed:', chunkingResult.reason);
      }
    } catch (error) {
      console.error('[PhotoAnalysis] Chunking failed, using original images:', error);
      chunkingMetadata = {
        wasChunked: false,
        chunkCount: images.length,
        reason: `Chunking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Step 1: Primary analysis (Claude Opus or Gemini based on config)
  let primaryResult: OpusAnalysisResponse;

  if (primaryModel === 'gemini') {
    // Use Gemini as primary
    console.log('[PhotoAnalysis] Starting Gemini primary analysis...');
    if (!isGeminiConfigured()) {
      throw new Error('Gemini is configured as primary model but GOOGLE_AI_API_KEY is not set');
    }
    const geminiPrimary = await runGeminiPrimaryAnalysis(imagesToAnalyze, options.listingDescription);
    primaryResult = geminiPrimary;
  } else {
    // Use Claude Opus as primary (default)
    console.log('[PhotoAnalysis] Starting Claude Opus analysis...');
    primaryResult = await analyzeWithOpus(imagesToAnalyze, options.listingDescription);
  }

  // Step 2: Parallel verification with secondary model and Brickognize
  console.log('[PhotoAnalysis] Running parallel verification...');
  const [secondaryResult, brickognizeResult] = await Promise.all([
    // If Gemini is primary, use Claude for verification (and vice versa)
    primaryModel === 'gemini'
      ? runClaudeVerification(imagesToAnalyze)
      : (options.useGeminiVerification && isGeminiConfigured()
          ? runGeminiVerification(imagesToAnalyze)
          : null),
    options.useBrickognize ? runBrickognizeIdentification(imagesToAnalyze) : null,
  ]);

  // Track which models were used
  if (primaryModel === 'gemini' && secondaryResult) {
    modelsUsed.push('opus'); // Claude was used for verification
  } else if (secondaryResult) {
    modelsUsed.push('gemini');
  }
  if (brickognizeResult) modelsUsed.push('brickognize');

  // Step 3: Merge and reconcile results
  console.log('[PhotoAnalysis] Merging results...');
  const mergedItems = mergeModelResults(primaryResult, secondaryResult, brickognizeResult, primaryModel);

  // Step 4: Verification pass for high-confidence sets
  // This catches misidentifications where the model was confident but wrong
  console.log('[PhotoAnalysis] Running verification pass...');
  const verifiedItems = await runVerificationPass(imagesToAnalyze, mergedItems);

  // Step 5: Calculate final confidence and prepare result
  const processingTimeMs = Date.now() - startTime;

  return {
    items: verifiedItems,
    overallNotes: primaryResult.overallNotes,
    analysisConfidence: calculateOverallConfidence(verifiedItems),
    warnings: collectWarnings(primaryResult, verifiedItems),
    sourceDescription: options.listingDescription || null,
    modelsUsed,
    processingTimeMs,
    // Chunking metadata
    wasChunked: chunkingMetadata.wasChunked,
    chunkCount: chunkingMetadata.chunkCount,
    chunkingReason: chunkingMetadata.reason,
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
 * Run primary analysis with Gemini
 * Converts Gemini's response format to match OpusAnalysisResponse
 */
async function runGeminiPrimaryAnalysis(
  images: AnalysisImageInput[],
  listingDescription?: string
): Promise<OpusAnalysisResponse> {
  const geminiImages: GeminiImageInput[] = images.map((img) => ({
    base64: img.base64,
    mimeType: img.mediaType,
  }));

  const result = await analyzePhotosWithGemini(geminiImages, listingDescription);

  // Convert Gemini response format to match Opus format
  return {
    items: result.items.map((item) => ({
      itemType: item.itemType,
      setNumber: item.setNumber,
      setName: item.setName,
      condition: item.condition,
      boxCondition: item.boxCondition,
      sealStatus: item.sealStatus,
      damageNotes: item.damageNotes,
      confidenceScore: item.confidenceScore,
      needsReview: item.needsReview,
      reviewReason: item.reviewReason,
      rawDescription: item.rawDescription,
      quantity: item.quantity,
      minifigDescription: item.minifigDescription,
      partsEstimate: item.partsEstimate,
    })),
    overallNotes: result.overallNotes,
    analysisConfidence: result.analysisConfidence,
    warnings: result.warnings,
  };
}

/**
 * Run Claude verification when Gemini is primary
 * Returns set numbers that Claude identifies for cross-checking
 */
async function runClaudeVerification(
  images: AnalysisImageInput[]
): Promise<{ setNumbers: { number: string; confidence: number }[] } | null> {
  try {
    const claudeImages = images.map((img) => ({
      base64: img.base64,
      mediaType: img.mediaType,
    }));

    const prompt = `Look at these images and extract ALL LEGO set numbers you can see on boxes.

Return ONLY JSON in this format:
{
  "setNumbers": [
    {"number": "60285", "confidence": 0.95},
    {"number": "66523", "confidence": 0.9}
  ]
}

Read each digit carefully:
- 5 vs 6 vs 8 (5 has flat top, 6 has bottom loop, 8 has two loops)
- 2 vs 3 (2 has flat bottom)
- Only report numbers you can actually see`;

    const response = await sendMessageWithImagesForJSON<{
      setNumbers: { number: string; confidence: number }[];
    }>(
      'You are a LEGO set number reader. Extract visible set numbers from images.',
      prompt,
      claudeImages,
      {
        model: 'claude-opus-4-20250514', // Use Opus for best verification accuracy
        maxTokens: 1024,
        temperature: 0.1,
      }
    );

    return response;
  } catch (error) {
    console.error('[PhotoAnalysis] Claude verification failed:', error);
    return null;
  }
}

/**
 * Verification response type
 */
interface VerificationResponse {
  verifications: Array<{
    providedSetNumber: string;
    isCorrect: boolean;
    actualSetNumber?: string;
    reason: string;
  }>;
}

/**
 * Run verification pass on identified sets
 * This uses a separate Claude call to double-check set identifications
 */
async function runVerificationPass(
  images: AnalysisImageInput[],
  items: PhotoAnalysisItem[]
): Promise<PhotoAnalysisItem[]> {
  // Only verify sets with high confidence that haven't been flagged
  const setsToVerify = items.filter(
    (item) =>
      item.itemType === 'set' &&
      item.setNumber &&
      item.confidenceScore >= 0.7 &&
      !item.needsReview
  );

  if (setsToVerify.length === 0) {
    console.log('[PhotoAnalysis] No sets to verify');
    return items;
  }

  try {
    const claudeImages = images.map((img) => ({
      base64: img.base64,
      mediaType: img.mediaType,
    }));

    const verificationRequest = createVerificationRequest(
      setsToVerify.map((s) => ({
        setNumber: s.setNumber!,
        description: s.rawDescription,
      }))
    );

    console.log(`[PhotoAnalysis] Verifying ${setsToVerify.length} sets...`);

    const response = await sendMessageWithImagesForJSON<VerificationResponse>(
      SET_VERIFICATION_SYSTEM_PROMPT,
      verificationRequest,
      claudeImages,
      {
        model: 'claude-opus-4-20250514', // Use Opus for best verification accuracy
        maxTokens: 2048,
        temperature: 0.1,
      }
    );

    // Apply verification results
    const verificationMap = new Map<string, VerificationResponse['verifications'][0]>();
    for (const v of response.verifications || []) {
      verificationMap.set(v.providedSetNumber, v);
    }

    return items.map((item) => {
      if (item.itemType !== 'set' || !item.setNumber) {
        return item;
      }

      const verification = verificationMap.get(item.setNumber);
      if (!verification) {
        return item;
      }

      if (verification.isCorrect) {
        // Boost confidence if verification passed
        return {
          ...item,
          confidenceScore: Math.min(1.0, item.confidenceScore + 0.05),
        };
      } else {
        // Verification found an issue
        console.log(
          `[PhotoAnalysis] Verification corrected ${item.setNumber} -> ${verification.actualSetNumber}: ${verification.reason}`
        );

        // Add a model identification for the verification
        const verificationIdentification: ModelIdentification = {
          model: 'opus', // Verification uses Claude
          setNumber: verification.actualSetNumber || null,
          setName: null,
          confidence: 0.9,
          rawResponse: verification.reason,
        };

        if (verification.actualSetNumber) {
          // We have a correction - apply it
          return {
            ...item,
            setNumber: verification.actualSetNumber,
            needsReview: true,
            reviewReason: `Auto-corrected from ${item.setNumber}: ${verification.reason}`,
            confidenceScore: 0.8, // Reduce confidence since it needed correction
            modelIdentifications: [
              ...item.modelIdentifications,
              verificationIdentification,
            ],
            modelsAgree: false,
          };
        } else {
          // No correction available, flag for review
          return {
            ...item,
            needsReview: true,
            reviewReason: `Verification uncertain: ${verification.reason}`,
            confidenceScore: Math.max(0.5, item.confidenceScore - 0.2),
            modelIdentifications: [
              ...item.modelIdentifications,
              verificationIdentification,
            ],
          };
        }
      }
    });
  } catch (error) {
    console.error('[PhotoAnalysis] Verification pass failed:', error);
    // If verification fails, return original items
    return items;
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
 *
 * @param primaryResult - Results from the primary model (Claude or Gemini)
 * @param secondaryResult - Results from secondary verification model
 * @param brickognizeItems - Results from Brickognize
 * @param primaryModelType - Which model was used as primary ('claude' or 'gemini')
 */
function mergeModelResults(
  primaryResult: OpusAnalysisResponse,
  secondaryResult: { setNumbers: { number: string; confidence: number }[] } | null,
  brickognizeItems: BrickognizeItem[] | null,
  primaryModelType: 'claude' | 'gemini' = 'claude'
): PhotoAnalysisItem[] {
  const mergedItems: PhotoAnalysisItem[] = [];

  // Determine model names based on which was primary
  const primaryModelName: AIModel = primaryModelType === 'gemini' ? 'gemini' : 'opus';
  const secondaryModelName: AIModel = primaryModelType === 'gemini' ? 'opus' : 'gemini';

  for (const primaryItem of primaryResult.items) {
    const modelIdentifications: ModelIdentification[] = [];

    // Add primary model identification
    modelIdentifications.push({
      model: primaryModelName,
      setNumber: primaryItem.setNumber,
      setName: primaryItem.setName,
      confidence: primaryItem.confidenceScore,
      rawResponse: primaryItem.rawDescription,
    });

    let confidenceBoost = 0;
    let modelsAgree = true;

    // Check secondary model verification (for sets)
    if (secondaryResult && primaryItem.itemType === 'set' && primaryItem.setNumber) {
      const secondaryMatch = secondaryResult.setNumbers.find(
        (s) => normalizeSetNumber(s.number) === normalizeSetNumber(primaryItem.setNumber!)
      );

      if (secondaryMatch) {
        modelIdentifications.push({
          model: secondaryModelName,
          setNumber: secondaryMatch.number,
          setName: null,
          confidence: secondaryMatch.confidence,
        });
        confidenceBoost += CONFIDENCE_BOOST_AGREEMENT;
      } else if (secondaryResult.setNumbers.length > 0) {
        // Secondary model found different numbers - check if any match
        const closestMatch = secondaryResult.setNumbers[0];
        modelIdentifications.push({
          model: secondaryModelName,
          setNumber: closestMatch.number,
          setName: null,
          confidence: closestMatch.confidence,
        });
        modelsAgree = false;
      }
    }

    // Check Brickognize results
    if (brickognizeItems) {
      if (primaryItem.itemType === 'set' && primaryItem.setNumber) {
        const brickognizeMatch = getBestSetMatch(brickognizeItems);
        if (brickognizeMatch) {
          const matchesPrimary =
            brickognizeMatch.id === primaryItem.setNumber ||
            brickognizeMatch.externalIds?.bricklink === primaryItem.setNumber;

          modelIdentifications.push({
            model: 'brickognize',
            setNumber: brickognizeMatch.id,
            setName: brickognizeMatch.name,
            confidence: brickognizeMatch.confidence,
          });

          if (matchesPrimary) {
            confidenceBoost += CONFIDENCE_BOOST_BRICKOGNIZE;
          } else {
            modelsAgree = false;
          }
        }
      }
    }

    // Calculate final confidence
    const finalConfidence = Math.min(
      MAX_CONFIDENCE,
      primaryItem.confidenceScore + confidenceBoost
    );

    // If models disagree significantly, flag for review
    const needsReview =
      primaryItem.needsReview ||
      !modelsAgree ||
      finalConfidence < 0.5;

    const reviewReason = determineReviewReason(
      primaryItem,
      modelsAgree,
      finalConfidence
    );

    // Build merged item
    const mergedItem: PhotoAnalysisItem = {
      id: generatePhotoItemId(),
      itemType: primaryItem.itemType,
      setNumber: primaryItem.setNumber,
      setName: primaryItem.setName,
      condition: primaryItem.condition,
      boxCondition: primaryItem.boxCondition,
      sealStatus: primaryItem.sealStatus,
      damageNotes: primaryItem.damageNotes,
      confidenceScore: finalConfidence,
      needsReview,
      reviewReason,
      rawDescription: primaryItem.rawDescription,
      modelIdentifications,
      modelsAgree,
      minifigId: null,
      minifigDescription: primaryItem.minifigDescription ?? null,
      partIds: null,
      partsEstimate: primaryItem.partsEstimate ?? null,
      quantity: primaryItem.quantity,
    };

    // Enhance with Brickognize data for minifigs
    if (primaryItem.itemType === 'minifig' && brickognizeItems) {
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
    if (primaryItem.itemType === 'parts_lot' && brickognizeItems) {
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
