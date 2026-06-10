/**
 * BrickLink Transaction Status API
 *
 * GET /api/integrations/bricklink/status
 * Returns connection status, transaction count, and sync information
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink/bricklink-transaction-sync.service';

export async function GET() {
  try {
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const syncService = createBrickLinkTransactionSyncService();
    const status = await syncService.getConnectionStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/bricklink/status] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
