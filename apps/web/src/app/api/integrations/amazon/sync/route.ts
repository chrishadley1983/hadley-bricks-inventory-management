/**
 * Amazon Sync API
 *
 * POST: Trigger order sync from Amazon
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/services/amazon-sync.service';
import { AmazonInventoryLinkingService } from '@/lib/amazon/amazon-inventory-linking.service';

const SyncOptionsSchema = z.object({
  createdAfter: z.string().datetime().optional(),
  updatedAfter: z.string().datetime().optional(),
  statuses: z
    .array(
      z.enum([
        'Pending',
        'Unshipped',
        'PartiallyShipped',
        'Shipped',
        'Canceled',
        'Unfulfillable',
      ])
    )
    .optional(),
  merchantFulfilledOnly: z.boolean().optional(),
  includeItems: z.boolean().optional(),
  limit: z.number().min(1).max(500).optional(),
});

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

    // Parse optional body
    let options: z.infer<typeof SyncOptionsSchema> = {};
    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = parsed.data;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    const syncService = new AmazonSyncService(supabase);

    // Check if configured
    const isConfigured = await syncService.isConfigured(user.id);
    if (!isConfigured) {
      return NextResponse.json(
        { error: 'Amazon integration not configured' },
        { status: 400 }
      );
    }

    // Convert string dates to Date objects
    const syncOptions = {
      createdAfter: options.createdAfter ? new Date(options.createdAfter) : undefined,
      updatedAfter: options.updatedAfter ? new Date(options.updatedAfter) : undefined,
      statuses: options.statuses,
      merchantFulfilledOnly: options.merchantFulfilledOnly,
      includeItems: options.includeItems ?? true, // Default to including items
      limit: options.limit,
    };

    // Create sync log entry for order sync
    const { data: syncLog } = await supabase
      .from('amazon_sync_log')
      .insert({
        user_id: user.id,
        sync_type: 'ORDERS',
        sync_mode: syncOptions.createdAfter || syncOptions.updatedAfter ? 'INCREMENTAL' : 'FULL',
        status: 'RUNNING',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // Run sync
    console.log('[POST /api/integrations/amazon/sync] Starting sync...');
    const result = await syncService.syncOrders(user.id, syncOptions);

    // Update sync log with results
    if (syncLog?.id) {
      await supabase
        .from('amazon_sync_log')
        .update({
          status: result.success ? 'COMPLETED' : 'FAILED',
          records_processed: result.ordersProcessed,
          records_created: result.ordersCreated,
          records_updated: result.ordersUpdated,
          error_message: result.errors.length > 0 ? result.errors.join('; ') : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLog.id);
    }

    // After syncing, automatically link shipped orders to inventory
    // Always run linking on successful sync - there may be previously synced orders that weren't linked
    let linkingResult = null;
    let autoCompleteResult = null;
    if (result.success) {
      const linkingService = new AmazonInventoryLinkingService(supabase, user.id);

      // Step 1: Link shipped orders to inventory
      try {
        console.log('[POST /api/integrations/amazon/sync] Running inventory linking...');
        linkingResult = await linkingService.processHistoricalOrders({
          mode: 'auto',
          includeSold: true,
        });
        console.log('[POST /api/integrations/amazon/sync] Linking complete:', linkingResult);
      } catch (linkingError) {
        console.error('[POST /api/integrations/amazon/sync] Linking error:', linkingError);
      }

      // Step 2: Auto-complete old orders that are linked but still showing as "Shipped"
      // Orders > 14 days old with inventory linked are assumed delivered
      try {
        console.log('[POST /api/integrations/amazon/sync] Auto-completing old orders...');
        autoCompleteResult = await linkingService.autoCompleteOldOrders(14);
        console.log('[POST /api/integrations/amazon/sync] Auto-complete done:', autoCompleteResult);
      } catch (autoCompleteError) {
        console.error('[POST /api/integrations/amazon/sync] Auto-complete error:', autoCompleteError);
      }
    }

    return NextResponse.json({
      success: result.success,
      ordersProcessed: result.ordersProcessed,
      ordersCreated: result.ordersCreated,
      ordersUpdated: result.ordersUpdated,
      errors: result.errors,
      lastSyncedAt: result.lastSyncedAt.toISOString(),
      linking: linkingResult,
      autoComplete: autoCompleteResult,
    });
  } catch (error) {
    console.error('[POST /api/integrations/amazon/sync] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

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

    const syncService = new AmazonSyncService(supabase);
    const status = await syncService.getSyncStatus(user.id);

    return NextResponse.json(status);
  } catch (error) {
    console.error('[GET /api/integrations/amazon/sync] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
