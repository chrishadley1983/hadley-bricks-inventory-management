/**
 * Brickognize API Client
 *
 * Brickognize is a specialized AI service for identifying LEGO parts,
 * sets, minifigures, and stickers from images. It uses a model trained
 * specifically on LEGO products with knowledge of 80,000+ items.
 *
 * API Documentation: https://api.brickognize.com/docs
 * OpenAPI Spec: https://api.brickognize.com/openapi.json
 *
 * Note: Brickognize API is currently free and requires no authentication.
 */

import type {
  BrickognizeItem,
  BrickognizeResponse,
  // BrickognizeSearchResult is defined for future use
} from '../purchase-evaluator/photo-types';

// ============================================
// Configuration
// ============================================

const BRICKOGNIZE_API_BASE = 'https://api.brickognize.com';

/**
 * API endpoints
 * Note: These are marked as "legacy" in the API but still functional
 */
const ENDPOINTS = {
  predict: '/predict/',
  predictParts: '/predict/parts/',
  predictSets: '/predict/sets/',
  predictFigs: '/predict/figs/',
  health: '/health/',
} as const;

// ============================================
// Types
// ============================================

export interface BrickognizeImageInput {
  /** Base64-encoded image data */
  base64: string;
  /** Original filename (optional) */
  filename?: string;
}

export interface BrickognizeIdentifyResult {
  success: boolean;
  items: BrickognizeItem[];
  rawResponse: BrickognizeResponse | null;
  error?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Convert base64 string to Blob for form data
 */
function base64ToBlob(base64: string, mimeType: string = 'image/jpeg'): Blob {
  // Remove data URL prefix if present
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Make a request to the Brickognize API
 */
async function makeBrickognizeRequest(
  endpoint: string,
  imageBase64: string,
  filename: string = 'image.jpg'
): Promise<BrickognizeResponse> {
  const blob = base64ToBlob(imageBase64);
  const formData = new FormData();
  formData.append('query_image', blob, filename);

  const response = await fetch(`${BRICKOGNIZE_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Brickognize API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as BrickognizeResponse;
}

/**
 * Extract BrickognizeItems from API response
 */
function extractItemsFromResponse(response: BrickognizeResponse): BrickognizeItem[] {
  const items: BrickognizeItem[] = [];

  if (!response.results || !Array.isArray(response.results)) {
    return items;
  }

  for (const result of response.results) {
    if (result.items && Array.isArray(result.items)) {
      for (const item of result.items) {
        // Map API response to our BrickognizeItem type
        items.push({
          id: item.id || '',
          name: item.name || '',
          type: mapItemType(item.type),
          confidence: item.confidence || 0,
          thumbnail: item.thumbnail || null,
          externalIds: {
            bricklink: item.externalIds?.bricklink,
            rebrickable: item.externalIds?.rebrickable,
            brickset: item.externalIds?.brickset,
          },
        });
      }
    }
  }

  return items;
}

/**
 * Map API item type to our type
 */
function mapItemType(apiType: string | undefined): 'part' | 'set' | 'minifig' | 'sticker' {
  switch (apiType?.toLowerCase()) {
    case 'part':
      return 'part';
    case 'set':
      return 'set';
    case 'minifig':
    case 'fig':
    case 'minifigure':
      return 'minifig';
    case 'sticker':
      return 'sticker';
    default:
      return 'part'; // Default to part
  }
}

// ============================================
// Public API Functions
// ============================================

/**
 * General identification - identifies any LEGO item (part, set, minifig, sticker)
 *
 * @param image - Image to analyze
 * @returns Identification result with all matching items
 */
export async function identifyWithBrickognize(
  image: BrickognizeImageInput
): Promise<BrickognizeIdentifyResult> {
  try {
    const response = await makeBrickognizeRequest(ENDPOINTS.predict, image.base64, image.filename);

    const items = extractItemsFromResponse(response);

    return {
      success: true,
      items,
      rawResponse: response,
    };
  } catch (error) {
    console.error('[Brickognize] Identification failed:', error);
    return {
      success: false,
      items: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Identify LEGO parts specifically
 *
 * @param image - Image to analyze
 * @returns Identification result with matching parts
 */
export async function identifyParts(
  image: BrickognizeImageInput
): Promise<BrickognizeIdentifyResult> {
  try {
    const response = await makeBrickognizeRequest(
      ENDPOINTS.predictParts,
      image.base64,
      image.filename
    );

    const items = extractItemsFromResponse(response);

    return {
      success: true,
      items: items.filter((i) => i.type === 'part'),
      rawResponse: response,
    };
  } catch (error) {
    console.error('[Brickognize] Parts identification failed:', error);
    return {
      success: false,
      items: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Identify LEGO sets specifically
 *
 * @param image - Image to analyze
 * @returns Identification result with matching sets
 */
export async function identifySets(
  image: BrickognizeImageInput
): Promise<BrickognizeIdentifyResult> {
  try {
    const response = await makeBrickognizeRequest(
      ENDPOINTS.predictSets,
      image.base64,
      image.filename
    );

    const items = extractItemsFromResponse(response);

    return {
      success: true,
      items: items.filter((i) => i.type === 'set'),
      rawResponse: response,
    };
  } catch (error) {
    console.error('[Brickognize] Sets identification failed:', error);
    return {
      success: false,
      items: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Identify LEGO minifigures specifically
 *
 * @param image - Image to analyze
 * @returns Identification result with matching minifigures
 */
export async function identifyMinifigs(
  image: BrickognizeImageInput
): Promise<BrickognizeIdentifyResult> {
  try {
    const response = await makeBrickognizeRequest(
      ENDPOINTS.predictFigs,
      image.base64,
      image.filename
    );

    const items = extractItemsFromResponse(response);

    return {
      success: true,
      items: items.filter((i) => i.type === 'minifig'),
      rawResponse: response,
    };
  } catch (error) {
    console.error('[Brickognize] Minifigs identification failed:', error);
    return {
      success: false,
      items: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Identify all items in multiple images
 *
 * Processes multiple images in parallel and combines results.
 *
 * @param images - Array of images to analyze
 * @returns Combined identification results
 */
export async function identifyAllItemsFromImages(
  images: BrickognizeImageInput[]
): Promise<BrickognizeIdentifyResult> {
  if (images.length === 0) {
    return {
      success: true,
      items: [],
      rawResponse: null,
    };
  }

  try {
    // Process all images in parallel
    const results = await Promise.all(images.map((image) => identifyWithBrickognize(image)));

    // Combine all items
    const allItems: BrickognizeItem[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.success) {
        allItems.push(...result.items);
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    // Deduplicate items by ID
    const uniqueItems = deduplicateItems(allItems);

    return {
      success: errors.length === 0,
      items: uniqueItems,
      rawResponse: null, // Multiple responses, not returning raw
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  } catch (error) {
    console.error('[Brickognize] Multi-image identification failed:', error);
    return {
      success: false,
      items: [],
      rawResponse: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Deduplicate items by ID, keeping the highest confidence match
 */
function deduplicateItems(items: BrickognizeItem[]): BrickognizeItem[] {
  const itemMap = new Map<string, BrickognizeItem>();

  for (const item of items) {
    const key = `${item.type}-${item.id}`;
    const existing = itemMap.get(key);

    if (!existing || item.confidence > existing.confidence) {
      itemMap.set(key, item);
    }
  }

  return Array.from(itemMap.values());
}

/**
 * Check if Brickognize API is available
 */
export async function checkBrickognizeHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BRICKOGNIZE_API_BASE}${ENDPOINTS.health}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the best set number match from Brickognize results
 */
export function getBestSetMatch(items: BrickognizeItem[]): BrickognizeItem | null {
  const sets = items.filter((i) => i.type === 'set');
  if (sets.length === 0) return null;

  // Sort by confidence descending
  sets.sort((a, b) => b.confidence - a.confidence);
  return sets[0];
}

/**
 * Get all minifig matches from Brickognize results
 */
export function getMinifigMatches(items: BrickognizeItem[]): BrickognizeItem[] {
  return items.filter((i) => i.type === 'minifig').sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get all part matches from Brickognize results
 */
export function getPartMatches(items: BrickognizeItem[]): BrickognizeItem[] {
  return items.filter((i) => i.type === 'part').sort((a, b) => b.confidence - a.confidence);
}
