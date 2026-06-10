/**
 * Amazon Sync Feed Poll API Route
 *
 * POST /api/amazon/sync/feeds/[id]/poll - Poll Amazon for status update
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// POST - Poll Amazon for feed status
// ============================================================================

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new AmazonSyncService(supabase, user.id);
    const feed = await service.pollFeedStatus(id);

    const isComplete = !['pending', 'submitted', 'processing'].includes(feed.status);

    let message: string;
    switch (feed.status) {
      case 'done':
        message = `Feed complete: ${feed.success_count} successful, ${feed.error_count} errors`;
        break;
      case 'processing':
        message = 'Amazon is processing the feed...';
        break;
      case 'submitted':
        message = 'Waiting for Amazon to start processing...';
        break;
      case 'cancelled':
        message = 'Feed was cancelled by Amazon';
        break;
      case 'fatal':
        message = 'Feed processing failed';
        break;
      default:
        message = `Feed status: ${feed.status}`;
    }

    return NextResponse.json({
      data: {
        feed,
        isComplete,
      },
      message,
    });
  } catch (error) {
    console.error('[POST /api/amazon/sync/feeds/[id]/poll] Error:', error);

    if (error instanceof Error) {
      if (error.message.includes('Feed not found') || error.message.includes('no Amazon feed ID')) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
