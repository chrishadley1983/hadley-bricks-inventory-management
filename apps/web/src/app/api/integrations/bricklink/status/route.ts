/**
 * BrickLink Transaction Status API
 *
 * GET /api/integrations/bricklink/status
 * Returns connection status, transaction count, and sync information
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink/bricklink-transaction-sync.service';

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

    const syncService = createBrickLinkTransactionSyncService();
    const status = await syncService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/bricklink/status] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
