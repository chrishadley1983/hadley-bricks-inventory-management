/**
 * Image Chunking Service
 *
 * Pre-processes images to detect and isolate individual LEGO items
 * for more accurate identification. Uses Claude for region detection
 * and canvas API for cropping.
 */

import { sendMessageWithImagesForJSON } from '../ai/claude-client';
import type { AnalysisImageInput } from './photo-types';

// ============================================
// Types
// ============================================

/**
 * Bounding box for an item region
 */
export interface ItemRegion {
  /** Left position as percentage (0-100) */
  x: number;
  /** Top position as percentage (0-100) */
  y: number;
  /** Width as percentage (0-100) */
  width: number;
  /** Height as percentage (0-100) */
  height: number;
  /** Description of item for context */
  description: string;
  /** Estimated item type */
  itemType: 'set' | 'minifig' | 'parts' | 'unknown';
}

/**
 * Result of region detection
 */
export interface RegionDetectionResult {
  /** Detected regions */
  regions: ItemRegion[];
  /** Whether chunking is recommended */
  shouldChunk: boolean;
  /** Reason for recommendation */
  reason: string;
  /** Total items detected */
  itemCount: number;
}

/**
 * A chunked image ready for analysis
 */
export interface ChunkedImage {
  /** Original image this was chunked from */
  sourceIndex: number;
  /** Region info */
  region: ItemRegion;
  /** Cropped image data */
  imageData: AnalysisImageInput;
}

// ============================================
// Region Detection Prompt
// ============================================

const REGION_DETECTION_SYSTEM_PROMPT = `You are an expert at analyzing images of LEGO items and identifying distinct item regions.

Your task is to identify separate LEGO items in the image and provide their approximate bounding boxes. This helps pre-process images for more accurate individual analysis.

## Instructions

1. Look at the entire image and identify distinct LEGO items:
   - Individual set boxes (even if stacked)
   - Loose minifigures
   - Piles of loose parts
   - Any other distinct LEGO items

2. For each item, estimate its bounding box as percentages:
   - x: left edge position (0 = left edge of image, 100 = right edge)
   - y: top edge position (0 = top of image, 100 = bottom)
   - width: width of the bounding box as percentage
   - height: height of the bounding box as percentage

3. Provide a brief description of each item and its type.

## Important Guidelines

- Only identify clearly distinct items - don't split a single box into multiple regions
- If items heavily overlap, group them into one region
- Minimum region size: 10% of image in either dimension
- If image shows just one item clearly, report it as a single region
- Be generous with bounding box sizes - better to include extra margin

## Output Format (JSON only)

{
  "regions": [
    {
      "x": 10,
      "y": 5,
      "width": 40,
      "height": 45,
      "description": "Star Wars set box, appears to be X-wing",
      "itemType": "set"
    }
  ],
  "shouldChunk": true,
  "reason": "Multiple distinct items visible - chunking recommended for better accuracy",
  "itemCount": 3
}`;

// ============================================
// Region Detection
// ============================================

/**
 * Detect item regions in an image using Claude
 *
 * @param image - Image to analyze
 * @returns Detected regions with bounding boxes
 */
export async function detectItemRegions(image: AnalysisImageInput): Promise<RegionDetectionResult> {
  try {
    console.log('[ImageChunking] Detecting item regions...');

    const claudeImages = [
      {
        base64: image.base64,
        mediaType: image.mediaType,
      },
    ];

    const response = await sendMessageWithImagesForJSON<RegionDetectionResult>(
      REGION_DETECTION_SYSTEM_PROMPT,
      'Analyze this image and identify all distinct LEGO items with their bounding boxes. Return JSON only.',
      claudeImages,
      {
        model: 'claude-sonnet-4-20250514', // Use Sonnet for speed on this pre-pass
        maxTokens: 2048,
        temperature: 0.2,
      }
    );

    // Validate and normalize response
    const result = validateRegionDetectionResult(response);

    console.log(
      `[ImageChunking] Detected ${result.regions.length} regions, shouldChunk: ${result.shouldChunk}`
    );

    return result;
  } catch (error) {
    console.error('[ImageChunking] Region detection failed:', error);
    // Return single-region fallback
    return {
      regions: [
        {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          description: 'Full image (detection failed)',
          itemType: 'unknown',
        },
      ],
      shouldChunk: false,
      reason: 'Region detection failed - using full image',
      itemCount: 1,
    };
  }
}

/**
 * Detect regions for multiple images
 *
 * @param images - Images to analyze
 * @returns Array of region detection results
 */
export async function detectAllRegions(
  images: AnalysisImageInput[]
): Promise<RegionDetectionResult[]> {
  console.log(`[ImageChunking] Detecting regions for ${images.length} images...`);

  // Process images in parallel
  const results = await Promise.all(images.map(detectItemRegions));

  return results;
}

// ============================================
// Image Cropping
// ============================================

/**
 * Crop an image to a specific region
 *
 * This runs in the browser using canvas API.
 *
 * @param imageBase64 - Original image data
 * @param region - Region to crop
 * @param mediaType - Image media type
 * @returns Cropped image data
 */
export async function cropImageToRegion(
  imageBase64: string,
  region: ItemRegion,
  mediaType: AnalysisImageInput['mediaType']
): Promise<AnalysisImageInput> {
  // This needs to run client-side - we'll create a utility function
  // that can be called from the browser

  return new Promise((resolve, reject) => {
    try {
      // Create image element
      const img = new Image();
      img.onload = () => {
        try {
          // Calculate pixel coordinates from percentages
          const x = Math.floor((region.x / 100) * img.width);
          const y = Math.floor((region.y / 100) * img.height);
          const width = Math.floor((region.width / 100) * img.width);
          const height = Math.floor((region.height / 100) * img.height);

          // Create canvas for cropping
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to get canvas context');
          }

          // Draw cropped region
          ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

          // Convert to base64
          const croppedBase64 = canvas.toDataURL(mediaType).replace(/^data:image\/\w+;base64,/, '');

          resolve({
            base64: croppedBase64,
            mediaType,
            filename: `cropped-${region.description.substring(0, 20)}.jpg`,
          });
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load image for cropping'));
      };

      // Load image from base64
      img.src = `data:${mediaType};base64,${imageBase64}`;
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Crop multiple regions from an image
 *
 * @param image - Source image
 * @param regions - Regions to crop
 * @returns Cropped image chunks
 */
export async function cropImageToChunks(
  image: AnalysisImageInput,
  regions: ItemRegion[]
): Promise<ChunkedImage[]> {
  console.log(`[ImageChunking] Cropping image into ${regions.length} chunks...`);

  const chunks: ChunkedImage[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];

    try {
      const croppedImage = await cropImageToRegion(image.base64, region, image.mediaType);

      chunks.push({
        sourceIndex: 0, // Will be set by caller
        region,
        imageData: croppedImage,
      });
    } catch (error) {
      console.error(`[ImageChunking] Failed to crop region ${i}:`, error);
      // Continue with other regions
    }
  }

  return chunks;
}

// ============================================
// Full Chunking Pipeline
// ============================================

export interface ChunkingResult {
  /** Original images (if chunking not needed) */
  originalImages: AnalysisImageInput[];
  /** Chunked images (if chunking was applied) */
  chunkedImages: ChunkedImage[];
  /** Whether chunking was applied */
  wasChunked: boolean;
  /** Total item count across all images */
  totalItemCount: number;
  /** Reason for chunking decision */
  reason: string;
}

/**
 * Process images through the chunking pipeline
 *
 * Decides whether to chunk based on detected item count and
 * image complexity.
 *
 * @param images - Images to process
 * @param forceChunking - Force chunking regardless of detection
 * @returns Processed images ready for analysis
 */
export async function processImagesForChunking(
  images: AnalysisImageInput[],
  forceChunking: boolean = false
): Promise<ChunkingResult> {
  console.log('[ImageChunking] Starting chunking pipeline...');

  // Step 1: Detect regions in all images
  const detectionResults = await detectAllRegions(images);

  // Step 2: Decide if chunking is worthwhile
  const totalRegions = detectionResults.reduce((sum, r) => sum + r.regions.length, 0);
  const totalItems = detectionResults.reduce((sum, r) => sum + r.itemCount, 0);
  const anyRecommendChunking = detectionResults.some((r) => r.shouldChunk);

  // Chunking decision criteria:
  // - Force chunking is enabled
  // - OR multiple items detected AND at least one detection recommends it
  // - OR more regions than images (meaning detection found multiple items per image)
  const shouldChunk =
    forceChunking ||
    (totalItems > images.length && anyRecommendChunking) ||
    totalRegions > images.length;

  console.log(
    `[ImageChunking] Decision: shouldChunk=${shouldChunk}, totalRegions=${totalRegions}, totalItems=${totalItems}`
  );

  if (!shouldChunk) {
    return {
      originalImages: images,
      chunkedImages: [],
      wasChunked: false,
      totalItemCount: totalItems,
      reason: 'Chunking not needed - single or few items per image',
    };
  }

  // Step 3: Chunk images with multiple items
  const allChunks: ChunkedImage[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const detection = detectionResults[i];

    // If this image has multiple regions, chunk it
    if (detection.regions.length > 1 && detection.shouldChunk) {
      const chunks = await cropImageToChunks(image, detection.regions);
      // Set source index
      chunks.forEach((chunk) => (chunk.sourceIndex = i));
      allChunks.push(...chunks);
    } else {
      // Use full image as single chunk
      allChunks.push({
        sourceIndex: i,
        region: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          description: detection.regions[0]?.description || 'Full image',
          itemType: detection.regions[0]?.itemType || 'unknown',
        },
        imageData: image,
      });
    }
  }

  console.log(`[ImageChunking] Created ${allChunks.length} chunks from ${images.length} images`);

  return {
    originalImages: images,
    chunkedImages: allChunks,
    wasChunked: true,
    totalItemCount: totalItems,
    reason: `Chunked ${images.length} images into ${allChunks.length} regions for individual analysis`,
  };
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate and normalize region detection result
 */
function validateRegionDetectionResult(response: unknown): RegionDetectionResult {
  const result = response as RegionDetectionResult;

  // Ensure regions array exists
  if (!result.regions || !Array.isArray(result.regions)) {
    return {
      regions: [],
      shouldChunk: false,
      reason: 'Invalid response - no regions found',
      itemCount: 0,
    };
  }

  // Validate each region
  const validRegions = result.regions.filter((r) => {
    return (
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.width === 'number' &&
      typeof r.height === 'number' &&
      r.x >= 0 &&
      r.x <= 100 &&
      r.y >= 0 &&
      r.y <= 100 &&
      r.width > 0 &&
      r.width <= 100 &&
      r.height > 0 &&
      r.height <= 100
    );
  });

  // Normalize region values
  const normalizedRegions = validRegions.map((r) => ({
    x: Math.max(0, Math.min(100, r.x)),
    y: Math.max(0, Math.min(100, r.y)),
    width: Math.max(5, Math.min(100 - r.x, r.width)),
    height: Math.max(5, Math.min(100 - r.y, r.height)),
    description: r.description || 'Unknown item',
    itemType: r.itemType || 'unknown',
  }));

  return {
    regions: normalizedRegions,
    shouldChunk: result.shouldChunk ?? normalizedRegions.length > 1,
    reason: result.reason || 'Auto-detected',
    itemCount: result.itemCount ?? normalizedRegions.length,
  };
}

/**
 * Utility to check if chunking is available (browser-only)
 */
export function isChunkingAvailable(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
