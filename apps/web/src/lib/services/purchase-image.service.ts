/**
 * Purchase Image Service
 *
 * Handles uploading, storing, and deleting photos/receipts for purchases.
 * Used for tracking and tax purposes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/**
 * Image data for upload
 */
export interface PurchaseImageUploadData {
  /** Unique identifier for the image */
  id: string;
  /** Base64-encoded image data */
  base64: string;
  /** MIME type */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Original filename */
  filename: string;
}

/**
 * Result of an image upload
 */
export interface PurchaseImageUploadResult {
  /** Whether upload was successful */
  success: boolean;
  /** Original image ID */
  imageId: string;
  /** Public URL (if successful) */
  url?: string;
  /** Storage path (if successful) */
  storagePath?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Purchase image record from database
 */
export interface PurchaseImage {
  id: string;
  user_id: string;
  purchase_id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string;
  file_size: number | null;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

/**
 * Service for managing purchase images
 */
export class PurchaseImageService {
  private supabase: SupabaseClient<Database>;
  private userId: string;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  /**
   * Upload images for a purchase and create database records
   */
  async uploadImages(
    purchaseId: string,
    images: PurchaseImageUploadData[]
  ): Promise<PurchaseImageUploadResult[]> {
    console.log(`[PurchaseImageService] Uploading ${images.length} images for purchase ${purchaseId}`);

    const results: PurchaseImageUploadResult[] = [];

    // Get current max sort order for this purchase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingImages } = await (this.supabase as any)
      .from('purchase_images')
      .select('sort_order')
      .eq('purchase_id', purchaseId)
      .order('sort_order', { ascending: false })
      .limit(1);

    let sortOrder = (existingImages?.[0]?.sort_order as number) ?? -1;

    for (const image of images) {
      sortOrder++;

      try {
        // Validate image
        const validation = this.validateImage(image);
        if (!validation.valid) {
          results.push({
            success: false,
            imageId: image.id,
            error: validation.errors.join(', '),
          });
          continue;
        }

        // Upload to storage
        const uploadResult = await this.uploadToStorage(image);
        if (!uploadResult.success) {
          results.push(uploadResult);
          continue;
        }

        // Calculate file size from base64
        const base64Data = image.base64.replace(/^data:image\/\w+;base64,/, '');
        const fileSize = Math.round((base64Data.length * 3) / 4);

        // Create database record
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: dbError } = await (this.supabase as any).from('purchase_images').insert({
          user_id: this.userId,
          purchase_id: purchaseId,
          storage_path: uploadResult.storagePath!,
          public_url: uploadResult.url!,
          filename: image.filename,
          mime_type: image.mimeType,
          file_size: fileSize,
          sort_order: sortOrder,
        });

        if (dbError) {
          // Cleanup uploaded file on DB error
          await this.deleteFromStorage(uploadResult.storagePath!);
          results.push({
            success: false,
            imageId: image.id,
            error: `Database error: ${dbError.message}`,
          });
          continue;
        }

        results.push(uploadResult);
      } catch (error) {
        console.error(`[PurchaseImageService] Failed to upload image ${image.id}:`, error);
        results.push({
          success: false,
          imageId: image.id,
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[PurchaseImageService] Upload complete: ${successCount}/${images.length} successful`
    );

    return results;
  }

  /**
   * Get all images for a purchase
   */
  async getImages(purchaseId: string): Promise<PurchaseImage[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.supabase as any)
      .from('purchase_images')
      .select('*')
      .eq('purchase_id', purchaseId)
      .eq('user_id', this.userId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error(`[PurchaseImageService] Failed to get images:`, error);
      throw new Error(`Failed to get images: ${error.message}`);
    }

    return (data || []) as PurchaseImage[];
  }

  /**
   * Delete a single image
   */
  async deleteImage(imageId: string): Promise<{ success: boolean; error?: string }> {
    // Get image record first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: image, error: fetchError } = await (this.supabase as any)
      .from('purchase_images')
      .select('*')
      .eq('id', imageId)
      .eq('user_id', this.userId)
      .single();

    if (fetchError || !image) {
      return { success: false, error: 'Image not found' };
    }

    // Delete from storage
    await this.deleteFromStorage(image.storage_path);

    // Delete database record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (this.supabase as any)
      .from('purchase_images')
      .delete()
      .eq('id', imageId)
      .eq('user_id', this.userId);

    if (deleteError) {
      return { success: false, error: `Failed to delete: ${deleteError.message}` };
    }

    console.log(`[PurchaseImageService] Deleted image ${imageId}`);
    return { success: true };
  }

  /**
   * Delete all images for a purchase (used when deleting a purchase)
   */
  async deleteAllForPurchase(purchaseId: string): Promise<void> {
    // Get all images
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: images } = await (this.supabase as any)
      .from('purchase_images')
      .select('storage_path')
      .eq('purchase_id', purchaseId)
      .eq('user_id', this.userId);

    if (images && images.length > 0) {
      // Delete from storage
      const paths = images.map((img: { storage_path: string }) => img.storage_path);
      await this.supabase.storage.from('images').remove(paths);

      // Delete database records
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.supabase as any)
        .from('purchase_images')
        .delete()
        .eq('purchase_id', purchaseId)
        .eq('user_id', this.userId);

      console.log(`[PurchaseImageService] Deleted ${images.length} images for purchase ${purchaseId}`);
    }
  }

  /**
   * Update image caption
   */
  async updateCaption(imageId: string, caption: string): Promise<{ success: boolean; error?: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (this.supabase as any)
      .from('purchase_images')
      .update({ caption })
      .eq('id', imageId)
      .eq('user_id', this.userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  /**
   * Reorder images
   */
  async reorderImages(
    purchaseId: string,
    imageIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    // Update sort_order for each image
    for (let i = 0; i < imageIds.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (this.supabase as any)
        .from('purchase_images')
        .update({ sort_order: i })
        .eq('id', imageIds[i])
        .eq('purchase_id', purchaseId)
        .eq('user_id', this.userId);

      if (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  }

  /**
   * Upload to Supabase storage
   */
  private async uploadToStorage(image: PurchaseImageUploadData): Promise<PurchaseImageUploadResult> {
    try {
      // Convert base64 to binary
      const base64Data = image.base64.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Buffer.from(base64Data, 'base64');

      // Generate unique filename with user/purchase directory
      const timestamp = Date.now();
      const extension = image.mimeType.split('/')[1] || 'jpeg';
      const fileName = `purchases/${this.userId}/${timestamp}-${image.id}.${extension}`;

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
        storagePath: data.path,
      };
    } catch (error) {
      console.error(`[PurchaseImageService] Storage upload error:`, error);
      return {
        success: false,
        imageId: image.id,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * Delete from storage
   */
  private async deleteFromStorage(storagePath: string): Promise<void> {
    try {
      await this.supabase.storage.from('images').remove([storagePath]);
    } catch (error) {
      console.error(`[PurchaseImageService] Failed to delete from storage: ${storagePath}`, error);
    }
  }

  /**
   * Validate image meets requirements
   */
  validateImage(image: PurchaseImageUploadData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check MIME type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(image.mimeType)) {
      errors.push(`Invalid image type: ${image.mimeType}. Use JPEG, PNG, WebP, or GIF.`);
    }

    // Check base64 data exists
    if (!image.base64 || image.base64.length < 100) {
      errors.push('Image data is empty or too small');
    }

    // Estimate file size from base64 (base64 is ~33% larger than binary)
    const estimatedSize = (image.base64.length * 3) / 4;
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (estimatedSize > maxSize) {
      errors.push(`Image too large: ~${(estimatedSize / 1024 / 1024).toFixed(1)}MB. Maximum is 10MB.`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
