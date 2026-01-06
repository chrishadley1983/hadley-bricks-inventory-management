/**
 * Amazon Sync API
 *
 * POST: Trigger order sync from Amazon
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/services/amazon-sync.service';

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

    // Run sync
    console.log('[POST /api/integrations/amazon/sync] Starting sync...');
    const result = await syncService.syncOrders(user.id, syncOptions);

    return NextResponse.json({
      success: result.success,
      ordersProcessed: result.ordersProcessed,
      ordersCreated: result.ordersCreated,
      ordersUpdated: result.ordersUpdated,
      errors: result.errors,
      lastSyncedAt: result.lastSyncedAt.toISOString(),
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
