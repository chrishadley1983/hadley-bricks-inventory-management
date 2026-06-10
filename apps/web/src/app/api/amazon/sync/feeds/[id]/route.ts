/**
 * Amazon Sync Feed Detail API Route
 *
 * GET /api/amazon/sync/feeds/[id] - Get feed detail with items
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// GET - Get feed detail with items
// ============================================================================

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new AmazonSyncService(supabase, user.id);
    const feed = await service.getFeedWithDetails(id);

    if (!feed) {
      return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { feed } });
  } catch (error) {
    console.error('[GET /api/amazon/sync/feeds/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
