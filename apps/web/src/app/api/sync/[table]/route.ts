import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google/sheets-client';
import { CacheService } from '@/lib/sync/cache.service';

// Map user-facing table names to actual database table names
const TABLE_NAME_MAP: Record<string, string> = {
  inventory: 'inventory_items',
  purchases: 'purchases',
};

/**
 * POST /api/sync/[table]
 * Sync a table from Google Sheets to Supabase cache
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  try {
    const { table } = await params;
    console.log(`[POST /api/sync/${table}] Starting sync...`);

    // Validate table parameter
    if (table !== 'inventory' && table !== 'purchases') {
      return NextResponse.json(
        { error: 'Invalid table. Must be "inventory" or "purchases"' },
        { status: 400 }
      );
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error(`[POST /api/sync/${table}] Auth error:`, authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log(`[POST /api/sync/${table}] User authenticated: ${user.id}`);

    // Get Sheets client
    const sheetsClient = getSheetsClient();
    if (!sheetsClient) {
      console.error(`[POST /api/sync/${table}] Google Sheets not configured`);
      return NextResponse.json(
        { error: 'Google Sheets not configured. Check environment variables.' },
        { status: 503 }
      );
    }
    console.log(`[POST /api/sync/${table}] Sheets client ready`);

    // Create cache service
    const cacheService = new CacheService(supabase, sheetsClient, user.id);

    // Perform sync
    console.log(`[POST /api/sync/${table}] Starting cache service sync...`);
    let result: { success: boolean; count: number; error?: string };
    if (table === 'inventory') {
      result = await cacheService.syncInventory();
    } else {
      result = await cacheService.syncPurchases();
    }
    console.log(`[POST /api/sync/${table}] Sync result:`, result);

    if (!result.success) {
      console.error(`[POST /api/sync/${table}] Sync failed:`, result.error);
      return NextResponse.json(
        { error: result.error || 'Sync failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        count: result.count,
        table,
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[POST /api/sync] Unhandled error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/sync/[table]
 * Get sync status for a table
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  try {
    const { table } = await params;

    // Validate table parameter
    if (table !== 'inventory' && table !== 'purchases') {
      return NextResponse.json(
        { error: 'Invalid table. Must be "inventory" or "purchases"' },
        { status: 400 }
      );
    }

    // Map to actual table name for internal use
    const actualTableName = TABLE_NAME_MAP[table];

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Sheets client
    const sheetsClient = getSheetsClient();
    if (!sheetsClient) {
      return NextResponse.json(
        { error: 'Google Sheets not configured' },
        { status: 503 }
      );
    }

    // Create cache service
    const cacheService = new CacheService(supabase, sheetsClient, user.id);

    // Get sync status using actual table name
    const status = await cacheService.getSyncStatus(actualTableName);

    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('[GET /api/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
