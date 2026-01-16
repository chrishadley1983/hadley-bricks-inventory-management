/**
 * Purchase Images API
 *
 * GET: List images for a purchase
 * POST: Upload images for a purchase
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseImageService } from '@/lib/services/purchase-image.service';

const ImageUploadSchema = z.object({
  images: z.array(
    z.object({
      id: z.string(),
      base64: z.string().min(100),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      filename: z.string(),
    })
  ).min(1).max(10),
});

/**
 * GET /api/purchases/[id]/images
 * Get all images for a purchase
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: purchaseId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify purchase belongs to user
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id')
      .eq('id', purchaseId)
      .eq('user_id', user.id)
      .single();

    if (purchaseError || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const imageService = new PurchaseImageService(supabase, user.id);
    const images = await imageService.getImages(purchaseId);

    return NextResponse.json({ data: images });
  } catch (error) {
    console.error('[GET /api/purchases/[id]/images] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/purchases/[id]/images
 * Upload images for a purchase
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: purchaseId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify purchase belongs to user
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id')
      .eq('id', purchaseId)
      .eq('user_id', user.id)
      .single();

    if (purchaseError || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = ImageUploadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const imageService = new PurchaseImageService(supabase, user.id);
    const results = await imageService.uploadImages(purchaseId, parsed.data.images);

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: successCount > 0,
      message: `${successCount} image(s) uploaded successfully${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
      results,
    }, { status: successCount > 0 ? 201 : 400 });
  } catch (error) {
    console.error('[POST /api/purchases/[id]/images] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
