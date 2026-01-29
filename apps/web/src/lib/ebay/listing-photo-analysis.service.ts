/**
 * Listing Photo Analysis Service
 *
 * Analyzes listing photos to detect presence of box and instructions.
 * Uses Gemini 3 Flash for fast, accurate visual analysis.
 *
 * The user always takes separate photos of box and instructions if present,
 * so we can reliably detect their presence by analyzing the photos.
 */

import {
  analyzeImagesWithGemini,
  isGeminiConfigured,
  type GeminiImageInput,
} from '@/lib/ai/gemini-client';

/**
 * Result of photo analysis for listing
 */
export interface ListingPhotoAnalysisResult {
  /** Whether a LEGO box is visible in the photos */
  hasBox: boolean;
  /** Whether instruction booklets are visible in the photos */
  hasInstructions: boolean;
  /** Confidence score for box detection (0-1) */
  boxConfidence: number;
  /** Confidence score for instructions detection (0-1) */
  instructionsConfidence: number;
  /** Notes about what was detected */
  notes: string;
  /** Time taken for analysis in ms */
  processingTimeMs: number;
}

/**
 * Analyze listing photos to detect box and instructions
 *
 * @param photoUrls - Array of photo URLs to analyze
 * @returns Analysis result with hasBox and hasInstructions flags
 */
export async function analyzeListingPhotos(
  photoUrls: string[]
): Promise<ListingPhotoAnalysisResult> {
  const startTime = Date.now();

  // If Gemini is not configured, return defaults (unknown)
  if (!isGeminiConfigured()) {
    console.log('[ListingPhotoAnalysis] Gemini not configured, skipping photo analysis');
    return {
      hasBox: false,
      hasInstructions: false,
      boxConfidence: 0,
      instructionsConfidence: 0,
      notes: 'Photo analysis skipped - Gemini API not configured',
      processingTimeMs: Date.now() - startTime,
    };
  }

  if (photoUrls.length === 0) {
    return {
      hasBox: false,
      hasInstructions: false,
      boxConfidence: 0,
      instructionsConfidence: 0,
      notes: 'No photos provided',
      processingTimeMs: Date.now() - startTime,
    };
  }

  try {
    // Fetch images and convert to base64 for Gemini
    console.log(`[ListingPhotoAnalysis] Fetching ${photoUrls.length} photos for analysis...`);
    const images = await fetchImagesAsBase64(photoUrls);

    if (images.length === 0) {
      console.error('[ListingPhotoAnalysis] Failed to fetch any images');
      return {
        hasBox: false,
        hasInstructions: false,
        boxConfidence: 0,
        instructionsConfidence: 0,
        notes: 'Failed to fetch images for analysis',
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Analyze images with Gemini
    console.log(`[ListingPhotoAnalysis] Analyzing ${images.length} images with Gemini...`);
    const result = await analyzeForBoxAndInstructions(images);

    console.log(
      `[ListingPhotoAnalysis] Analysis complete: hasBox=${result.hasBox} (${Math.round(result.boxConfidence * 100)}%), hasInstructions=${result.hasInstructions} (${Math.round(result.instructionsConfidence * 100)}%)`
    );

    return {
      ...result,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[ListingPhotoAnalysis] Analysis failed:', error);
    return {
      hasBox: false,
      hasInstructions: false,
      boxConfidence: 0,
      instructionsConfidence: 0,
      notes: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Fetch images from URLs and convert to base64 for Gemini
 */
async function fetchImagesAsBase64(urls: string[]): Promise<GeminiImageInput[]> {
  const images: GeminiImageInput[] = [];

  // Limit to first 10 images to avoid excessive processing
  const urlsToFetch = urls.slice(0, 10);

  await Promise.all(
    urlsToFetch.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[ListingPhotoAnalysis] Failed to fetch image: ${url}`);
          return;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const mimeType = getMimeType(contentType);

        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        images.push({
          base64,
          mimeType,
        });
      } catch (error) {
        console.warn(`[ListingPhotoAnalysis] Error fetching image ${url}:`, error);
      }
    })
  );

  return images;
}

/**
 * Get valid mime type for Gemini
 */
function getMimeType(
  contentType: string
): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  if (contentType.includes('png')) return 'image/png';
  if (contentType.includes('webp')) return 'image/webp';
  if (contentType.includes('gif')) return 'image/gif';
  return 'image/jpeg'; // Default to JPEG
}

/**
 * Analyze images with Gemini to detect box and instructions
 */
async function analyzeForBoxAndInstructions(
  images: GeminiImageInput[]
): Promise<Omit<ListingPhotoAnalysisResult, 'processingTimeMs'>> {
  const prompt = `You are analyzing photos of a LEGO item being sold on eBay.

## Task
Determine if the following are visible in ANY of the photos:
1. A LEGO box (the original product packaging)
2. LEGO instruction booklets/manuals

## What to Look For

### BOX
- Look for a LEGO retail box with the characteristic LEGO branding
- Could be standing upright, lying flat, or stacked
- May show the set image on front, set number, piece count
- The box may be sealed or opened
- Even a damaged or worn box still counts as "has box"

### INSTRUCTIONS
- Look for instruction booklets - these are typically A4-ish sized booklets
- Have step-by-step building diagrams
- Usually have the LEGO logo and set number on the cover
- May be a single booklet or multiple booklets
- Could be stacked, fanned out, or shown individually

## Important
- Look at ALL photos - the seller often takes a separate photo for box and instructions
- If you see even one clear photo of a box, mark hasBox as true
- If you see even one clear photo of instructions, mark hasInstructions as true
- Be generous - if something looks like it could be a box or instructions, mark it as present

## Response Format
Return ONLY valid JSON:
{
  "hasBox": true/false,
  "hasInstructions": true/false,
  "boxConfidence": 0.0-1.0,
  "instructionsConfidence": 0.0-1.0,
  "notes": "Brief description of what you found (e.g., 'Box visible in photo 3, instructions shown in photo 5')"
}`;

  try {
    // Use Flash model for speed - this is a simple detection task
    const rawResponse = await analyzeImagesWithGemini(images, prompt, false);

    // Parse JSON from response
    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      hasBox: boolean;
      hasInstructions: boolean;
      boxConfidence: number;
      instructionsConfidence: number;
      notes: string;
    };

    return {
      hasBox: parsed.hasBox ?? false,
      hasInstructions: parsed.hasInstructions ?? false,
      boxConfidence: parsed.boxConfidence ?? 0,
      instructionsConfidence: parsed.instructionsConfidence ?? 0,
      notes: parsed.notes ?? '',
    };
  } catch (error) {
    console.error('[ListingPhotoAnalysis] Gemini analysis failed:', error);
    return {
      hasBox: false,
      hasInstructions: false,
      boxConfidence: 0,
      instructionsConfidence: 0,
      notes: `Analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
