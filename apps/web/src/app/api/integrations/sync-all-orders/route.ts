import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { OrderSyncService } from '@/lib/services';

const SyncOptionsSchema = z.object({
  platforms: z.array(z.enum(['bricklink', 'brickowl', 'bricqer', 'ebay', 'amazon'])).optional(),
  includeArchived: z.boolean().optional().default(false),
  includeItems: z.boolean().optional().default(true),
  fullSync: z.boolean().optional().default(false),
});

/**
 * POST /api/integrations/sync-all-orders
 * Sync orders from all configured platforms
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
    let options = {
      platforms: undefined as string[] | undefined,
      includeArchived: false,
      includeItems: true,
      fullSync: false,
    };

    try {
      const body = await request.json();
      const parsed = SyncOptionsSchema.safeParse(body);
      if (parsed.success) {
        options = parsed.data as typeof options;
      }
    } catch {
      // Use defaults if no body provided
    }

    const syncService = new OrderSyncService(supabase);

    // Check if any platforms are configured
    const configuredPlatforms = await syncService.getConfiguredPlatforms(user.id);
    if (configuredPlatforms.length === 0) {
      return NextResponse.json(
        {
          error:
            'No platforms configured. Please set up at least one platform in Settings > Integrations.',
        },
        { status: 400 }
      );
    }

    // Run sync across all platforms
    const result = await syncService.syncAllPlatforms(user.id, {
      platforms: options.platforms as
        | ('bricklink' | 'brickowl' | 'bricqer' | 'ebay' | 'amazon')[]
        | undefined,
      includeArchived: options.includeArchived,
      includeItems: options.includeItems,
      fullSync: options.fullSync,
    });

    // Convert Map to object for JSON serialization
    const platformResults: Record<string, unknown> = {};
    result.results.forEach((syncResult, platform) => {
      platformResults[platform] = {
        success: syncResult.success,
        ordersProcessed: syncResult.ordersProcessed,
        ordersCreated: syncResult.ordersCreated,
        ordersUpdated: syncResult.ordersUpdated,
        errors: syncResult.errors,
        lastSyncedAt: syncResult.lastSyncedAt.toISOString(),
      };
    });

    return NextResponse.json({
      success: result.success,
      data: {
        platformResults,
        totalOrdersProcessed: result.totalOrdersProcessed,
        totalOrdersCreated: result.totalOrdersCreated,
        totalOrdersUpdated: result.totalOrdersUpdated,
        errors: result.errors,
        syncedAt: result.syncedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[POST /api/integrations/sync-all-orders] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/sync-all-orders
 * Get sync status for all platforms
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

    const syncService = new OrderSyncService(supabase);
    const statuses = await syncService.getAllPlatformStatuses(user.id);

    // Convert Map to object for JSON serialization
    const platformStatuses: Record<string, unknown> = {};
    statuses.forEach((status, platform) => {
      platformStatuses[platform] = {
        isConfigured: status.isConfigured,
        totalOrders: status.totalOrders,
        lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
        connectionStatus: status.connectionStatus,
        errorMessage: status.errorMessage,
      };
    });

    return NextResponse.json({
      data: platformStatuses,
    });
  } catch (error) {
    console.error('[GET /api/integrations/sync-all-orders] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
