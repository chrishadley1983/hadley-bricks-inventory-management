/**
 * Monzo Status Route
 *
 * Returns the current Monzo sync status.
 * Uses Google Sheets as the data source - always "connected" since we read from sheets.
 * GET /api/integrations/monzo/status
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { monzoSheetsSyncService } from '@/lib/monzo/monzo-sheets-sync.service';

export async function GET() {
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

    // 2. Get sync status from sheets service
    const syncStatus = await monzoSheetsSyncService.getSyncStatus(user.id);

    // 3. Return status
    // Since we're using Google Sheets, we're always "connected"
    return NextResponse.json({
      data: {
        connection: {
          isConnected: true,
          source: 'sheets',
          accountType: 'Google Sheets',
          transactionCount: syncStatus.transactionCount,
          lastSyncAt: syncStatus.lastSync?.completedAt || null,
        },
        sync: {
          isRunning: syncStatus.isRunning,
          lastSync: syncStatus.lastSync,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/monzo/status] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
