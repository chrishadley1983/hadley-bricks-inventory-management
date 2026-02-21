/**
 * Image Processing for eBay Listings (F33)
 *
 * Uses Sharp to process images before upload:
 * - Resize to max 1600x1600px maintaining aspect ratio
 * - White background fill for transparent PNGs
 * - Light sharpening (sigma 0.5)
 * - Output as JPEG at quality 85
 */

import sharp from 'sharp';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'jpeg';
}

/**
 * Process a single image for eBay listing upload.
 * Fetches the image from URL, applies processing pipeline.
 */
export async function processImageForEbay(imageUrl: string): Promise<ProcessedImage> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${imageUrl}`);
  }

  const inputBuffer = Buffer.from(await response.arrayBuffer());
  return processBufferForEbay(inputBuffer);
}

/**
 * Process an image buffer through the eBay pipeline.
 */
export async function processBufferForEbay(inputBuffer: Buffer): Promise<ProcessedImage> {
  const processed = await sharp(inputBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 0.5 })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: processed.data,
    width: processed.info.width,
    height: processed.info.height,
    format: 'jpeg',
  };
}

/**
 * Validate an image meets minimum requirements (F31).
 * Returns true if image is at least 800x800px.
 */
export async function validateImageDimensions(
  imageUrl: string
): Promise<{ valid: boolean; width: number; height: number }> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return { valid: false, width: 0, height: 0 };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    return {
      valid: width >= 800 && height >= 800,
      width,
      height,
    };
  } catch {
    return { valid: false, width: 0, height: 0 };
  }
}
