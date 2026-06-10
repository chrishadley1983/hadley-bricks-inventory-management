/**
 * Amazon Sync Queue Item API Routes
 *
 * DELETE /api/amazon/sync/queue/[id] - Remove specific item from queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// DELETE - Remove item from queue
// ============================================================================

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new AmazonSyncService(supabase, user.id);
    await service.removeFromQueue(id);

    return NextResponse.json({
      data: { id },
      message: 'Item removed from sync queue',
    });
  } catch (error) {
    console.error('[DELETE /api/amazon/sync/queue/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
