import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google/sheets-client';
import { CacheService } from '@/lib/sync/cache.service';

// Map user-facing table names to actual database table names
const TABLE_NAME_MAP: Record<string, string> = {
  inventory: 'inventory_items',
  purchases: 'purchases',
};

// Helper to log sync events to database
async function logSyncEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tableName: string,
  action: 'sync_started' | 'sync_completed' | 'sync_failed',
  request: NextRequest,
  details: {
    recordsAffected?: number;
    errorMessage?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  } = {}
) {
  try {
    await supabase.from('sync_audit_log').insert({
      user_id: userId,
      table_name: tableName,
      action,
      user_agent: request.headers.get('user-agent'),
      referer: request.headers.get('referer'),
      origin: request.headers.get('origin'),
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      records_affected: details.recordsAffected,
      error_message: details.errorMessage,
      duration_ms: details.durationMs,
      metadata: (details.metadata || {}) as Record<string, string | number | boolean | null>,
    });
  } catch (err) {
    console.error('[logSyncEvent] Failed to log sync event:', err);
    // Don't throw - logging failure shouldn't break sync
  }
}

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
    const timestamp = new Date().toISOString();

    // Log detailed request info for debugging sync triggers
    console.log(`[POST /api/sync/${table}] ========== SYNC REQUEST ==========`);
    console.log(`[POST /api/sync/${table}] Timestamp: ${timestamp}`);
    console.log(`[POST /api/sync/${table}] User-Agent: ${request.headers.get('user-agent')}`);
    console.log(`[POST /api/sync/${table}] Referer: ${request.headers.get('referer')}`);
    console.log(`[POST /api/sync/${table}] Origin: ${request.headers.get('origin')}`);
    console.log(
      `[POST /api/sync/${table}] X-Forwarded-For: ${request.headers.get('x-forwarded-for')}`
    );
    console.log(`[POST /api/sync/${table}] Content-Type: ${request.headers.get('content-type')}`);

    // Log stack trace to see what triggered this
    const stack = new Error().stack;
    console.log(`[POST /api/sync/${table}] Call stack:`, stack?.split('\n').slice(1, 5).join('\n'));

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

    // Log sync start to database
    const startTime = Date.now();
    await logSyncEvent(supabase, user.id, table, 'sync_started', request, {
      metadata: {
        userAgent: request.headers.get('user-agent'),
        referer: request.headers.get('referer'),
        timestamp,
      },
    });

    // Get Sheets client
    const sheetsClient = getSheetsClient();
    if (!sheetsClient) {
      console.error(`[POST /api/sync/${table}] Google Sheets not configured`);
      await logSyncEvent(supabase, user.id, table, 'sync_failed', request, {
        errorMessage: 'Google Sheets not configured',
        durationMs: Date.now() - startTime,
      });
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

    const durationMs = Date.now() - startTime;

    if (!result.success) {
      console.error(`[POST /api/sync/${table}] Sync failed:`, result.error);
      await logSyncEvent(supabase, user.id, table, 'sync_failed', request, {
        errorMessage: result.error,
        durationMs,
      });
      return NextResponse.json({ error: result.error || 'Sync failed' }, { status: 500 });
    }

    // Log successful sync
    await logSyncEvent(supabase, user.id, table, 'sync_completed', request, {
      recordsAffected: result.count,
      durationMs,
    });

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
      return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 });
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
