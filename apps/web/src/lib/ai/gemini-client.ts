/**
 * Gemini API Client for Image Analysis
 *
 * Uses Google's Gemini 3 Pro model for primary analysis (best OCR accuracy)
 * and Gemini 3 Flash for fast verification tasks.
 */

import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';

// ============================================
// Configuration
// ============================================

/**
 * Gemini model IDs
 * - gemini-3-pro-preview: Most intelligent - best for reasoning, agentic tasks, accurate OCR
 * - gemini-3-flash-preview: Fast + Pro-level intelligence for verification
 */
const GEMINI_MODEL_PRIMARY = 'gemini-3-pro-preview';
const GEMINI_MODEL_FAST = 'gemini-3-flash-preview';

let geminiClient: GoogleGenAI | null = null;

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

// ============================================
// Types
// ============================================

export interface GeminiImageInput {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface GeminiSetExtraction {
  setNumber: string;
  confidence: number;
  textSource?: string;
}

export interface GeminiExtractionResult {
  setNumbers: GeminiSetExtraction[];
  otherText: string[];
  rawResponse: string;
}

// ============================================
// Image Analysis Functions
// ============================================

/**
 * Analyze images with Gemini and return raw text response
 *
 * @param images - Array of images to analyze
 * @param prompt - Analysis prompt
 * @param usePrimaryModel - If true, use Pro model; if false, use Flash (default: false for verification)
 * @param thinkingLevel - Thinking depth for Gemini 3 (default: HIGH for Pro, LOW for Flash)
 * @returns Raw text response from Gemini
 */
export async function analyzeImagesWithGemini(
  images: GeminiImageInput[],
  prompt: string,
  usePrimaryModel: boolean = false,
  thinkingLevel?: ThinkingLevel
): Promise<string> {
  const client = getGeminiClient();
  const modelId = usePrimaryModel ? GEMINI_MODEL_PRIMARY : GEMINI_MODEL_FAST;
  const defaultThinking = usePrimaryModel ? ThinkingLevel.HIGH : ThinkingLevel.LOW;

  // Build parts array with images and prompt
  const parts: Part[] = [];

  // Add images
  for (const image of images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64,
      },
    });
  }

  // Add text prompt
  parts.push({ text: prompt });

  // Generate response with thinking config
  const response = await client.models.generateContent({
    model: modelId,
    contents: { parts },
    config: {
      thinkingConfig: {
        thinkingLevel: thinkingLevel ?? defaultThinking,
      },
    },
  });

  // Extract text from response
  const text = response.text ?? '';
  return text;
}

/**
 * Extract LEGO set numbers from images using Gemini
 *
 * Gemini is particularly good at OCR and text extraction,
 * making it useful for reading set numbers from box photos.
 *
 * @param images - Array of images to analyze
 * @returns Extracted set numbers with confidence scores
 */
export async function extractSetNumbersWithGemini(
  images: GeminiImageInput[]
): Promise<GeminiExtractionResult> {
  const prompt = `You are analyzing photos of LEGO products to extract set numbers.

TASK: Find and extract ALL visible LEGO set numbers from these images.

LEGO set numbers are typically:
- 4 to 6 digit numbers (e.g., 75192, 10294, 42100)
- Found on LEGO box packaging (usually top-right of front, or on sides)
- May be preceded by theme name or followed by piece count

For each set number found:
1. Extract the numeric set number only
2. Note where you found it (e.g., "box front", "side panel", "listing text")
3. Assign a confidence score (0.0 to 1.0):
   - 0.95-1.00: Number clearly visible and readable
   - 0.80-0.94: Number partially obscured but identifiable
   - 0.60-0.79: Number inferred from context/partial visibility
   - Below 0.60: Uncertain, best guess

Also extract any other relevant text you see (set names, themes, piece counts).

IMPORTANT: Only report numbers you can actually see. Do not guess or make up numbers.

Respond in JSON format only:
{
  "setNumbers": [
    {
      "setNumber": "75192",
      "confidence": 0.95,
      "textSource": "box front, top right corner"
    }
  ],
  "otherText": ["Star Wars", "Ultimate Collector Series", "7541 pieces"]
}`;

  try {
    const rawResponse = await analyzeImagesWithGemini(images, prompt);

    // Parse JSON from response
    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      setNumbers: GeminiSetExtraction[];
      otherText?: string[];
    };

    return {
      setNumbers: parsed.setNumbers || [],
      otherText: parsed.otherText || [],
      rawResponse,
    };
  } catch (error) {
    console.error('[Gemini] Failed to extract set numbers:', error);
    return {
      setNumbers: [],
      otherText: [],
      rawResponse: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify a specific set number against images using Gemini
 *
 * Used to cross-check identifications from other models.
 *
 * @param images - Array of images to check
 * @param setNumber - Set number to verify
 * @returns Verification result with confidence
 */
export async function verifySetNumberWithGemini(
  images: GeminiImageInput[],
  setNumber: string
): Promise<{ verified: boolean; confidence: number; notes: string }> {
  const prompt = `I need to verify if LEGO set number ${setNumber} is visible in these images.

Look carefully at:
1. Any visible set numbers on boxes
2. Box art that matches known set ${setNumber}
3. Any text mentioning this set number

Respond in JSON format:
{
  "verified": true/false,
  "confidence": 0.0-1.0,
  "notes": "Explanation of what you found"
}`;

  try {
    const rawResponse = await analyzeImagesWithGemini(images, prompt);

    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      verified: boolean;
      confidence: number;
      notes: string;
    };

    return parsed;
  } catch (error) {
    console.error('[Gemini] Failed to verify set number:', error);
    return {
      verified: false,
      confidence: 0,
      notes: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Check if Gemini API is configured and available
 */
export function isGeminiConfigured(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

// ============================================
// Full Photo Analysis with Gemini (Primary Mode)
// ============================================

/**
 * Response type for full Gemini analysis
 */
export interface GeminiFullAnalysisItem {
  itemType: 'set' | 'minifig' | 'parts_lot' | 'non_lego' | 'unknown';
  setNumber: string | null;
  setName: string | null;
  condition: 'New' | 'Used';
  boxCondition: 'Mint' | 'Excellent' | 'Good' | 'Fair' | 'Poor' | null;
  sealStatus: 'Factory Sealed' | 'Resealed' | 'Open Box' | 'Unknown';
  damageNotes: string[];
  confidenceScore: number;
  needsReview: boolean;
  reviewReason: string | null;
  rawDescription: string;
  quantity: number;
  minifigDescription: string | null;
  partsEstimate: string | null;
}

export interface GeminiFullAnalysisResult {
  items: GeminiFullAnalysisItem[];
  overallNotes: string;
  analysisConfidence: number;
  warnings: string[];
}

/**
 * Run full photo analysis using Gemini as primary model
 *
 * This provides the same structured output as Claude Opus but uses Gemini.
 * Particularly effective for accurate set number reading.
 */
export async function analyzePhotosWithGemini(
  images: GeminiImageInput[],
  listingDescription?: string
): Promise<GeminiFullAnalysisResult> {
  const imageCountText = images.length === 1
    ? 'this photo'
    : `these ${images.length} photos`;

  const descriptionContext = listingDescription
    ? `\n\nThe seller provided this description:\n"${listingDescription}"\n\nUse this to help identify items, but verify against what you see.`
    : '';

  const prompt = `You are an expert LEGO appraiser analyzing ${imageCountText} of a LEGO lot.${descriptionContext}

## Your Task
Identify ALL LEGO items visible and assess their condition. Accuracy is critical for purchase evaluation.

## Set Number Reading - CRITICAL
When reading set numbers from boxes:
1. Look at the TOP-RIGHT corner of the box front, or side panels
2. Read EACH DIGIT carefully, one by one, left to right
3. Common digit confusions to avoid:
   - 5 vs 6 vs 8 (5 has flat top, 6 has bottom loop, 8 has two loops)
   - 2 vs 3 (2 has flat bottom, 3 is open left)
   - 0 vs 6 vs 9 (0 is symmetric)
4. Standard set number patterns:
   - City sets: 5 digits starting with 60 (60285, 60389)
   - Bundle packs: 5 digits starting with 66 (66523, 66546)
   - Star Wars: 5 digits starting with 75 (75192)
   - Creator: 5 digits starting with 10, 31, 40 (10281)
   - Technic: 5 digits starting with 42 (42115)

## Condition Grading
**Box Condition:**
- Mint: Factory perfect, no wear
- Excellent: Near-mint, minor shelf wear only
- Good: Visible wear, minor creases OK
- Fair: Significant wear, multiple creases
- Poor: Major damage, tears, crushing

**Seal Status:**
- Factory Sealed: Original LEGO seals intact
- Resealed: Evidence of re-taping
- Open Box: Clearly opened
- Unknown: Cannot determine

## Output Format
Return ONLY valid JSON:
{
  "items": [
    {
      "itemType": "set",
      "setNumber": "60285",
      "setName": "Sports Car",
      "condition": "New",
      "boxCondition": "Excellent",
      "sealStatus": "Factory Sealed",
      "damageNotes": ["Minor shelf wear"],
      "confidenceScore": 0.95,
      "needsReview": false,
      "reviewReason": null,
      "rawDescription": "LEGO City blue sports car box, set number 60285 clearly visible top right",
      "quantity": 1,
      "minifigDescription": null,
      "partsEstimate": null
    }
  ],
  "overallNotes": "Lot contains 5 sealed City sets in good to excellent condition",
  "analysisConfidence": 0.92,
  "warnings": []
}`;

  try {
    console.log('[Gemini] Running full photo analysis with Gemini 3 Pro (thinking: HIGH)...');
    // Use Pro model with high thinking for primary analysis - best accuracy
    const rawResponse = await analyzeImagesWithGemini(images, prompt, true, ThinkingLevel.HIGH);

    // Parse JSON from response
    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as GeminiFullAnalysisResult;

    console.log(`[Gemini] Analysis complete: ${parsed.items.length} items found`);
    return parsed;
  } catch (error) {
    console.error('[Gemini] Full analysis failed:', error);
    throw new Error(
      `Gemini analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
