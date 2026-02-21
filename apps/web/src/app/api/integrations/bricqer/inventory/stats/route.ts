import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  BricqerClient,
  normalizeInventoryItems,
  calculateInventoryStats,
  type BricqerCredentials,
} from '@/lib/bricqer';
import { CredentialsRepository } from '@/lib/repositories';

/**
 * GET /api/integrations/bricqer/inventory/stats
 * Get inventory statistics from Bricqer
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

    // Get credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
      user.id,
      'bricqer'
    );

    if (!credentials) {
      return NextResponse.json({ error: 'Bricqer credentials not configured' }, { status: 400 });
    }

    const client = new BricqerClient(credentials);

    // Get basic stats from the API
    const [apiStats, storageLocations, batches] = await Promise.all([
      client.getInventoryStats(),
      client.getStorageLocations(),
      client.getBatches(10),
    ]);

    // Get first page of items for detailed stats
    const items = await client.getInventoryItems({ limit: 100 });
    const normalizedItems = normalizeInventoryItems(items);
    const detailedStats = calculateInventoryStats(normalizedItems);

    return NextResponse.json({
      data: {
        totalLots: apiStats.totalItems,
        totalQuantity: detailedStats.totalQuantity,
        estimatedValue: detailedStats.totalValue,
        storageLocations: storageLocations.length,
        activeBatches: batches.filter((b) => b.activated).length,
        conditionBreakdown: detailedStats.conditionBreakdown,
        typeBreakdown: detailedStats.typeBreakdown,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/inventory/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
