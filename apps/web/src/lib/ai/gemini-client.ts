/**
 * Gemini API Client for Image Analysis
 *
 * Uses Google's Gemini 2.5 Flash model for fast, cost-effective
 * image analysis and text extraction. Used as secondary verification
 * in the photo analysis pipeline.
 */

import { GoogleGenerativeAI, type Part } from '@google/generative-ai';

// ============================================
// Configuration
// ============================================

/**
 * Gemini 2.5 Flash model for cost-effective image analysis
 */
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';

let geminiClient: GoogleGenerativeAI | null = null;

/**
 * Get the Gemini client instance (singleton)
 */
function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY environment variable is not set');
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
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
 * @returns Raw text response from Gemini
 */
export async function analyzeImagesWithGemini(
  images: GeminiImageInput[],
  prompt: string
): Promise<string> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: GEMINI_MODEL });

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

  // Generate response
  const result = await model.generateContent(parts);
  const response = result.response;
  const text = response.text();

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
