/**
 * Image Processing Service
 *
 * Client-side canvas-based image processing for the Image Studio.
 * Includes brightness, contrast, saturation, sharpening, and smart cropping.
 */

import type { ImageProcessSettings } from './types';
import { DEFAULT_IMAGE_SETTINGS, EBAY_IMAGE_SPECS } from './constants';

/**
 * Load an image from a source URL or base64
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/**
 * Process an image with the given settings
 */
export async function processImage(
  imageSrc: string,
  settings: ImageProcessSettings = DEFAULT_IMAGE_SETTINGS
): Promise<string> {
  // Load the image
  const img = await loadImage(imageSrc);

  // Create a working canvas
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // Apply CSS filters for brightness, contrast, saturation
  ctx.filter = `brightness(${settings.brightness}) contrast(${settings.contrast}) saturate(${settings.saturation})`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';

  // Apply temperature adjustment (RGB channel manipulation)
  if (settings.temperature !== 0) {
    applyTemperature(ctx, canvas.width, canvas.height, settings.temperature);
  }

  // Apply sharpening
  if (settings.sharpness > 0) {
    applySharpening(ctx, canvas.width, canvas.height, settings.sharpness);
  }

  // Smart crop to detect bounding box
  const bbox = getBoundingBox(ctx, canvas.width, canvas.height);

  // Create final square canvas with padding
  const maxDim = Math.max(bbox.width, bbox.height);
  const paddingPx = Math.round(maxDim * settings.padding);
  const finalSize = maxDim + paddingPx * 2;

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = finalSize;
  finalCanvas.height = finalSize;
  const finalCtx = finalCanvas.getContext('2d');

  if (!finalCtx) {
    throw new Error('Could not get final canvas context');
  }

  // White background
  finalCtx.fillStyle = '#FFFFFF';
  finalCtx.fillRect(0, 0, finalSize, finalSize);

  // Center the cropped image
  const destX = (finalSize - bbox.width) / 2;
  const destY = (finalSize - bbox.height) / 2;
  finalCtx.drawImage(
    canvas,
    bbox.x,
    bbox.y,
    bbox.width,
    bbox.height,
    destX,
    destY,
    bbox.width,
    bbox.height
  );

  // Return as JPEG at 95% quality
  return finalCanvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Process image without smart cropping (preview mode)
 */
export async function processImagePreview(
  imageSrc: string,
  settings: ImageProcessSettings = DEFAULT_IMAGE_SETTINGS
): Promise<string> {
  const img = await loadImage(imageSrc);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // Apply CSS filters
  ctx.filter = `brightness(${settings.brightness}) contrast(${settings.contrast}) saturate(${settings.saturation})`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';

  // Apply temperature
  if (settings.temperature !== 0) {
    applyTemperature(ctx, canvas.width, canvas.height, settings.temperature);
  }

  // Apply sharpening
  if (settings.sharpness > 0) {
    applySharpening(ctx, canvas.width, canvas.height, settings.sharpness);
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Apply temperature adjustment to image data
 * Positive values = warmer (more red, less blue)
 * Negative values = cooler (more blue, less red)
 */
function applyTemperature(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  temperature: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Adjust red channel (increase for warm, decrease for cool)
    data[i] = Math.min(255, Math.max(0, data[i] + temperature));
    // Adjust blue channel (decrease for warm, increase for cool)
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] - temperature));
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply sharpening using a convolution kernel
 */
function applySharpening(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  intensity: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data.length);

  // Sharpening kernel
  const kernel = [
    0, -intensity, 0,
    -intensity, 1 + 4 * intensity, -intensity,
    0, -intensity, 0,
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4 + c;
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            sum += data[idx] * kernel[kernelIdx];
          }
        }
        output[(y * width + x) * 4 + c] = Math.min(255, Math.max(0, sum));
      }
      // Copy alpha channel
      output[(y * width + x) * 4 + 3] = data[(y * width + x) * 4 + 3];
    }
  }

  // Copy output back to imageData
  for (let i = 0; i < data.length; i++) {
    data[i] = output[i] || data[i];
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Get bounding box of non-white pixels
 */
function getBoundingBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  // Threshold for considering a pixel as "white" or background
  const threshold = 250;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // If pixel is not white/near-white
      if (r < threshold || g < threshold || b < threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // If no non-white pixels found, return full image
  if (minX >= maxX || minY >= maxY) {
    return { x: 0, y: 0, width, height };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Generate a unique filename with timestamp
 */
export function generateFilename(baseName: string, index: number): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const paddedIndex = String(index + 1).padStart(2, '0');
  return `${baseName}_${timestamp}_${paddedIndex}.jpg`;
}

/**
 * Download an image to the user's device
 */
export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Convert a File to base64 data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize an image to eBay's recommended dimension (1600px) while maintaining aspect ratio.
 * This ensures the zoom feature works on eBay listings.
 */
export async function resizeImage(
  imageSrc: string,
  maxDimension: number = EBAY_IMAGE_SPECS.recommendedDimension
): Promise<string> {
  const img = await loadImage(imageSrc);

  // Calculate new dimensions
  let newWidth = img.width;
  let newHeight = img.height;

  if (img.width > maxDimension || img.height > maxDimension) {
    if (img.width > img.height) {
      newWidth = maxDimension;
      newHeight = Math.round((img.height / img.width) * maxDimension);
    } else {
      newHeight = maxDimension;
      newWidth = Math.round((img.width / img.height) * maxDimension);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  ctx.drawImage(img, 0, 0, newWidth, newHeight);
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Validate a file against eBay image requirements
 */
export interface ImageValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateImageFile(file: File): ImageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file type
  if (!EBAY_IMAGE_SPECS.supportedFormats.includes(file.type as typeof EBAY_IMAGE_SPECS.supportedFormats[number])) {
    errors.push(`Unsupported format: ${file.type}. Use JPEG, PNG, or WebP.`);
  }

  // Check file size
  if (file.size > EBAY_IMAGE_SPECS.maxFileSizeBytes) {
    errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum is ${EBAY_IMAGE_SPECS.maxFileSizeMB}MB.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate image dimensions after loading
 */
export async function validateImageDimensions(imageSrc: string): Promise<ImageValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const img = await loadImage(imageSrc);

    // Check minimum dimensions
    if (img.width < EBAY_IMAGE_SPECS.minDimension || img.height < EBAY_IMAGE_SPECS.minDimension) {
      errors.push(
        `Image too small: ${img.width}×${img.height}px. Minimum is ${EBAY_IMAGE_SPECS.minDimension}×${EBAY_IMAGE_SPECS.minDimension}px.`
      );
    }

    // Check if below recommended (warning only)
    if (
      img.width < EBAY_IMAGE_SPECS.recommendedDimension &&
      img.height < EBAY_IMAGE_SPECS.recommendedDimension
    ) {
      warnings.push(
        `Image below recommended size (${img.width}×${img.height}px). For best results and zoom feature, use ${EBAY_IMAGE_SPECS.recommendedDimension}×${EBAY_IMAGE_SPECS.recommendedDimension}px or larger.`
      );
    }
  } catch {
    errors.push('Failed to load image for validation');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
