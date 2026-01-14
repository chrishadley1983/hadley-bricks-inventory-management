/**
 * /api/ebay/listing-refresh/[id]
 *
 * GET - Get a single refresh job with items
 * DELETE - Cancel a refresh job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';

/**
 * GET /api/ebay/listing-refresh/[id]
 * Get a single refresh job with items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch job
    const service = new EbayListingRefreshService(supabase, user.id);
    const job = await service.getRefreshJob(id);

    if (!job) {
      return NextResponse.json({ error: 'Refresh job not found' }, { status: 404 });
    }

    return NextResponse.json({ data: job });
  } catch (error) {
    console.error('[GET /api/ebay/listing-refresh/[id]] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/ebay/listing-refresh/[id]
 * Cancel a refresh job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Cancel job
    const service = new EbayListingRefreshService(supabase, user.id);
    await service.cancelRefresh(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/ebay/listing-refresh/[id]] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';

    // Return 404 if job not found
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
