/**
 * eBay Image Upload API Route
 *
 * POST /api/ebay/upload-images - Upload images in batches to Supabase Storage
 *
 * Accepts compressed images and uploads them to storage, returning URLs.
 * Images are uploaded in batches to avoid payload size limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Maximum images per batch to avoid payload limits
 */
const MAX_IMAGES_PER_BATCH = 5;

/**
 * Maximum base64 size per image (after compression, ~500KB should be plenty)
 */
const MAX_IMAGE_SIZE_BYTES = 500 * 1024;

/**
 * Validation schema for image upload request
 */
const ImageUploadSchema = z.object({
  images: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        base64: z.string(),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      })
    )
    .min(1)
    .max(MAX_IMAGES_PER_BATCH),
  inventoryItemId: z.string().uuid(),
});

/**
 * Result for a single image upload
 */
interface ImageUploadResult {
  id: string;
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * POST /api/ebay/upload-images
 *
 * Upload a batch of images to Supabase Storage.
 * Returns URLs for successfully uploaded images.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const parsed = ImageUploadSchema.safeParse(body);

    if (!parsed.success) {
      console.error('[POST /api/ebay/upload-images] Validation errors:', parsed.error.flatten());
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { images, inventoryItemId } = parsed.data;
    console.log(
      `[POST /api/ebay/upload-images] Uploading ${images.length} images for inventory ${inventoryItemId}`
    );

    // 3. Upload images to Supabase Storage
    const results: ImageUploadResult[] = [];

    for (const image of images) {
      try {
        // Validate image size
        const base64Data = image.base64.replace(/^data:image\/\w+;base64,/, '');
        const estimatedSize = Math.round((base64Data.length * 3) / 4);

        if (estimatedSize > MAX_IMAGE_SIZE_BYTES) {
          results.push({
            id: image.id,
            success: false,
            error: `Image too large: ${Math.round(estimatedSize / 1024)}KB (max ${MAX_IMAGE_SIZE_BYTES / 1024}KB)`,
          });
          continue;
        }

        // Convert base64 to buffer
        const binaryData = Buffer.from(base64Data, 'base64');

        // Generate unique filename
        const timestamp = Date.now();
        const extension = image.mimeType.split('/')[1] || 'jpeg';
        const fileName = `ebay-listings/${user.id}/${inventoryItemId}/${timestamp}-${image.id}.${extension}`;

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage.from('images').upload(fileName, binaryData, {
          contentType: image.mimeType,
          cacheControl: '31536000', // 1 year cache
          upsert: false,
        });

        if (error) {
          console.error(`[POST /api/ebay/upload-images] Storage error for ${image.id}:`, error);
          results.push({
            id: image.id,
            success: false,
            error: `Storage upload failed: ${error.message}`,
          });
          continue;
        }

        // Get public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from('images').getPublicUrl(data.path);

        results.push({
          id: image.id,
          success: true,
          url: publicUrl,
        });

        console.log(`[POST /api/ebay/upload-images] Uploaded ${image.id} -> ${publicUrl}`);
      } catch (error) {
        console.error(`[POST /api/ebay/upload-images] Error uploading ${image.id}:`, error);
        results.push({
          id: image.id,
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[POST /api/ebay/upload-images] Complete: ${successCount}/${images.length} successful`
    );

    return NextResponse.json({
      results,
      summary: {
        total: images.length,
        successful: successCount,
        failed: images.length - successCount,
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay/upload-images] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
