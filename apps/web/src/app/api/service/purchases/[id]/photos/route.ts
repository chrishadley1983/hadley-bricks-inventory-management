/**
 * Service API: Purchase Photos
 *
 * POST - Upload photos for a purchase
 */

import { NextRequest, NextResponse } from 'next/server';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * POST /api/service/purchases/[id]/photos
 * Upload photos for a purchase
 *
 * Content-Type: multipart/form-data
 * Body: photos (File[])
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withServiceAuth(request, ['write'], async (_keyInfo) => {
    try {
      const { id: purchaseId } = await params;

      if (!purchaseId) {
        return NextResponse.json(
          { error: 'Purchase ID is required' },
          { status: 400 }
        );
      }

      const supabase = createServiceRoleClient();
      const userId = await getSystemUserId();

      // Verify purchase exists
      const { data: purchase, error: purchaseError } = await supabase
        .from('purchases')
        .select('id')
        .eq('id', purchaseId)
        .single();

      if (purchaseError || !purchase) {
        return NextResponse.json(
          { error: 'Purchase not found' },
          { status: 404 }
        );
      }

      // Parse multipart form data
      const formData = await request.formData();
      const files = formData.getAll('photos') as File[];

      if (files.length === 0) {
        return NextResponse.json(
          { error: 'No photos provided' },
          { status: 400 }
        );
      }

      const uploadedUrls: string[] = [];
      const failed: Array<{ filename: string; error: string }> = [];

      for (const file of files) {
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const timestamp = Date.now();
          const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const filename = `${purchaseId}/${timestamp}-${safeName}`;

          const { data, error } = await supabase.storage
            .from('purchase-photos')
            .upload(filename, buffer, {
              contentType: file.type,
              upsert: false,
            });

          if (error) {
            failed.push({ filename: file.name, error: error.message });
            continue;
          }

          const { data: urlData } = supabase.storage
            .from('purchase-photos')
            .getPublicUrl(data.path);

          uploadedUrls.push(urlData.publicUrl);

          // Link photo to purchase in database
          await supabase
            .from('purchase_images')
            .insert({
              user_id: userId,
              purchase_id: purchaseId,
              storage_path: data.path,
              public_url: urlData.publicUrl,
              filename: file.name,
              mime_type: file.type,
              file_size: buffer.length,
            });
        } catch (err) {
          failed.push({
            filename: file.name,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      if (uploadedUrls.length === 0 && failed.length > 0) {
        return NextResponse.json(
          { error: 'All uploads failed', failed },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          data: {
            urls: uploadedUrls,
            failed: failed.length > 0 ? failed : undefined,
            summary: {
              total: files.length,
              uploaded: uploadedUrls.length,
              failed: failed.length,
            },
          },
        },
        { status: 201 }
      );
    } catch (error) {
      console.error('[POST /api/service/purchases/[id]/photos] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
