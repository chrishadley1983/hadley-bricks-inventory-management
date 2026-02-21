import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricqerSyncService } from '@/lib/services';

const SyncOptionsSchema = z.object({
  fullSync: z.boolean().optional().default(false),
  includeItems: z.boolean().optional().default(true),
  limit: z.number().optional(),
});

/**
 * POST /api/integrations/bricqer/sync
 * Trigger a sync of Bricqer orders
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

    // Parse options
    let options: { fullSync: boolean; includeItems: boolean; limit: number | undefined } = {
      fullSync: false,
      includeItems: true,
      limit: undefined,
    };
    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = {
          fullSync: parsed.data.fullSync,
          includeItems: parsed.data.includeItems,
          limit: parsed.data.limit,
        };
      }
    } catch {
      // Use defaults if no body provided
    }

    const syncService = new BricqerSyncService(supabase);

    // Check if configured
    const isConfigured = await syncService.isConfigured(user.id);
    if (!isConfigured) {
      return NextResponse.json({ error: 'Bricqer credentials not configured' }, { status: 400 });
    }

    // Run sync
    const result = await syncService.syncOrders(user.id, options);

    return NextResponse.json({
      success: result.success,
      data: {
        ordersProcessed: result.ordersProcessed,
        ordersCreated: result.ordersCreated,
        ordersUpdated: result.ordersUpdated,
        errors: result.errors,
        lastSyncedAt: result.lastSyncedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/bricqer/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/bricqer/sync
 * Get sync status
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

    const syncService = new BricqerSyncService(supabase);
    const status = await syncService.getSyncStatus(user.id);

    return NextResponse.json({
      data: {
        isConfigured: status.isConfigured,
        totalOrders: status.totalOrders,
        lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/sync] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
