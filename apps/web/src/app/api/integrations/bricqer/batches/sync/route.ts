import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricqerBatchSyncService } from '@/lib/bricqer/bricqer-batch-sync.service';

const SyncOptionsSchema = z.object({
  fullSync: z.boolean().optional(),
  activatedOnly: z.boolean().optional(),
});

/**
 * GET /api/integrations/bricqer/batches/sync
 * Get sync status and connection info
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const syncService = new BricqerBatchSyncService();
    const status = await syncService.getConnectionStatus(user.id);

    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/batches/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/bricqer/batches/sync
 * Trigger a batch sync from Bricqer
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse options from body (optional)
    let options = {};
    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = parsed.data;
      }
    } catch {
      // Body might be empty, which is fine
    }

    const syncService = new BricqerBatchSyncService();
    const result = await syncService.syncBatches(user.id, options);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? 'Sync failed', data: result },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/integrations/bricqer/batches/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
