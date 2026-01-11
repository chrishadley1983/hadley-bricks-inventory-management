/**
 * Amazon Sync Queue Item API Routes
 *
 * DELETE /api/amazon/sync/queue/[id] - Remove specific item from queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new AmazonSyncService(supabase, user.id);
    await service.removeFromQueue(id);

    return NextResponse.json({
      data: { id },
      message: 'Item removed from sync queue',
    });
  } catch (error) {
    console.error('[DELETE /api/amazon/sync/queue/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
