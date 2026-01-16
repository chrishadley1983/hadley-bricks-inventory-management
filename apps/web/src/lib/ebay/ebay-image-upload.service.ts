/**
 * eBay Image Upload Service
 *
 * Handles uploading images to eBay for use in listings.
 * Uses the eBay Picture Service to upload and host images.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayAuthService } from './ebay-auth.service';

/**
 * Image data for upload
 */
export interface ImageUploadData {
  /** Unique identifier for the image */
  id: string;
  /** Base64-encoded image data */
  base64: string;
  /** MIME type */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Original filename */
  filename: string;
}

/**
 * Result of an image upload
 */
export interface ImageUploadResult {
  /** Whether upload was successful */
  success: boolean;
  /** Original image ID */
  imageId: string;
  /** eBay-hosted URL (if successful) */
  url?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Service for uploading images to eBay
 */
export class EbayImageUploadService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private authService: EbayAuthService;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
    this.authService = new EbayAuthService();
  }

  /**
   * Upload multiple images to eBay
   *
   * @param images - Array of images to upload
   * @returns Array of upload results with eBay-hosted URLs
   */
  async uploadImages(images: ImageUploadData[]): Promise<ImageUploadResult[]> {
    console.log(`[EbayImageUploadService] Uploading ${images.length} images to eBay`);

    const results: ImageUploadResult[] = [];

    // Get access token
    const accessToken = await this.authService.getAccessToken(this.userId);
    if (!accessToken) {
      return images.map((img) => ({
        success: false,
        imageId: img.id,
        error: 'No valid eBay access token',
      }));
    }

    // Upload images sequentially (eBay has rate limits)
    for (const image of images) {
      try {
        const result = await this.uploadSingleImage(image, accessToken);
        results.push(result);

        // Small delay between uploads to avoid rate limiting
        if (images.indexOf(image) < images.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[EbayImageUploadService] Failed to upload image ${image.id}:`, error);
        results.push({
          success: false,
          imageId: image.id,
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[EbayImageUploadService] Upload complete: ${successCount}/${images.length} successful`
    );

    return results;
  }

  /**
   * Upload a single image to eBay using the Inventory API
   *
   * Note: eBay's Inventory API accepts image URLs, not direct uploads.
   * For listings created via Inventory API, images should be hosted externally
   * (e.g., on Supabase Storage) and URLs provided to the API.
   *
   * This method converts base64 to a Supabase-hosted URL.
   */
  private async uploadSingleImage(
    image: ImageUploadData,
    _accessToken: string
  ): Promise<ImageUploadResult> {
    // For Inventory API listings, we need to host images on our own storage
    // and provide URLs. eBay will fetch and cache them.
    try {
      // Convert base64 to blob for upload
      const base64Data = image.base64.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Buffer.from(base64Data, 'base64');

      // Generate unique filename
      const timestamp = Date.now();
      const extension = image.mimeType.split('/')[1] || 'jpeg';
      const fileName = `ebay-listings/${this.userId}/${timestamp}-${image.id}.${extension}`;

      // Upload to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from('images')
        .upload(fileName, binaryData, {
          contentType: image.mimeType,
          cacheControl: '31536000', // 1 year cache
          upsert: false,
        });

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = this.supabase.storage.from('images').getPublicUrl(data.path);

      return {
        success: true,
        imageId: image.id,
        url: publicUrl,
      };
    } catch (error) {
      console.error(`[EbayImageUploadService] Upload error:`, error);
      return {
        success: false,
        imageId: image.id,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * Validate image meets eBay requirements
   */
  validateImage(image: ImageUploadData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check MIME type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(image.mimeType)) {
      errors.push(`Invalid image type: ${image.mimeType}. Use JPEG, PNG, or WebP.`);
    }

    // Check base64 data exists
    if (!image.base64 || image.base64.length < 100) {
      errors.push('Image data is empty or too small');
    }

    // Estimate file size from base64 (base64 is ~33% larger than binary)
    const estimatedSize = (image.base64.length * 3) / 4;
    const maxSize = 12 * 1024 * 1024; // 12MB
    if (estimatedSize > maxSize) {
      errors.push(`Image too large: ~${(estimatedSize / 1024 / 1024).toFixed(1)}MB. Maximum is 12MB.`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Delete uploaded images (cleanup on error)
   */
  async deleteImages(imageUrls: string[]): Promise<void> {
    for (const url of imageUrls) {
      try {
        // Extract path from URL
        const pathMatch = url.match(/\/images\/(.+)$/);
        if (pathMatch) {
          await this.supabase.storage.from('images').remove([pathMatch[1]]);
        }
      } catch (error) {
        console.error(`[EbayImageUploadService] Failed to delete image: ${url}`, error);
      }
    }
  }
}
