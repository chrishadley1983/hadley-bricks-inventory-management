/**
 * Client-side Image Compression Utility
 *
 * Compresses and resizes images before upload to reduce payload size.
 * Uses HTML5 Canvas API for processing.
 */

/**
 * Options for image compression
 */
export interface CompressionOptions {
  /** Maximum width or height in pixels (default: 1600) */
  maxDimension?: number;
  /** JPEG quality 0-1 (default: 0.8) */
  quality?: number;
  /** Output MIME type (default: 'image/jpeg') */
  outputType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Result of image compression
 */
export interface CompressedImage {
  /** Compressed image as base64 data URL */
  base64: string;
  /** Output MIME type */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Original file size in bytes */
  originalSize: number;
  /** Compressed size in bytes (estimated from base64) */
  compressedSize: number;
  /** Compression ratio (e.g., 0.1 = 90% reduction) */
  compressionRatio: number;
  /** Final width */
  width: number;
  /** Final height */
  height: number;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxDimension: 1600,
  quality: 0.8,
  outputType: 'image/jpeg',
};

/**
 * Compress and resize an image file
 *
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Compressed image data
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;

      if (width > opts.maxDimension || height > opts.maxDimension) {
        if (width > height) {
          height = Math.round((height * opts.maxDimension) / width);
          width = opts.maxDimension;
        } else {
          width = Math.round((width * opts.maxDimension) / height);
          height = opts.maxDimension;
        }
      }

      // Set canvas size
      canvas.width = width;
      canvas.height = height;

      // Draw with white background (for transparency in PNGs converting to JPEG)
      if (opts.outputType === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }

      // Draw image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to base64
      const base64 = canvas.toDataURL(opts.outputType, opts.quality);

      // Estimate compressed size (base64 is ~33% larger than binary)
      const base64Data = base64.split(',')[1] || '';
      const compressedSize = Math.round((base64Data.length * 3) / 4);

      resolve({
        base64,
        mimeType: opts.outputType,
        originalSize: file.size,
        compressedSize,
        compressionRatio: compressedSize / file.size,
        width,
        height,
      });

      // Clean up
      URL.revokeObjectURL(img.src);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    // Load image from file
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Compress multiple images with progress callback
 *
 * @param files - Array of image files
 * @param options - Compression options
 * @param onProgress - Progress callback (0-100)
 * @returns Array of compressed images
 */
export async function compressImages(
  files: File[],
  options: CompressionOptions = {},
  onProgress?: (percent: number) => void
): Promise<CompressedImage[]> {
  const results: CompressedImage[] = [];

  for (let i = 0; i < files.length; i++) {
    const compressed = await compressImage(files[i], options);
    results.push(compressed);

    if (onProgress) {
      onProgress(Math.round(((i + 1) / files.length) * 100));
    }
  }

  return results;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
