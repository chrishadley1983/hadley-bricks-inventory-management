/**
 * Amazon Sync Queue API Routes
 *
 * GET /api/amazon/sync/queue - Get all queue items
 * POST /api/amazon/sync/queue - Add item(s) to queue
 * DELETE /api/amazon/sync/queue - Clear entire queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

// ============================================================================
// SCHEMAS
// ============================================================================

const AddToQueueSchema = z
  .object({
    inventoryItemId: z.string().uuid().optional(),
    inventoryItemIds: z.array(z.string().uuid()).optional(),
    /** Skip price conflict check (use after user confirms price update) */
    skipConflictCheck: z.boolean().optional(),
  })
  .refine(
    (data) => data.inventoryItemId || (data.inventoryItemIds && data.inventoryItemIds.length > 0),
    { message: 'Either inventoryItemId or inventoryItemIds is required' }
  );

// ============================================================================
// GET - Get all queue items
// ============================================================================

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

    const service = new AmazonSyncService(supabase, user.id);
    const items = await service.getQueueItems();
    const aggregated = await service.getAggregatedQueueItems();

    return NextResponse.json({
      data: {
        items,
        aggregated,
        summary: {
          totalItems: items.length,
          uniqueAsins: aggregated.length,
          totalQuantity: aggregated.reduce((sum, a) => sum + a.totalQuantity, 0),
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/amazon/sync/queue] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Add item(s) to queue
// ============================================================================

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

    const body = await request.json();
    const parsed = AddToQueueSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new AmazonSyncService(supabase, user.id);
    const skipConflictCheck = parsed.data.skipConflictCheck ?? false;

    if (parsed.data.inventoryItemId) {
      // Single item add
      const result = await service.addToQueue(parsed.data.inventoryItemId, skipConflictCheck);

      // Check for price conflict - return 200 with conflict info (not error)
      if (result.priceConflict) {
        return NextResponse.json({
          data: { priceConflict: result.priceConflict },
          message: 'Price conflict detected',
        });
      }

      // Check for other errors
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json(
        {
          data: { item: result.item },
          message: 'Item added to sync queue',
        },
        { status: 201 }
      );
    } else if (parsed.data.inventoryItemIds) {
      // Bulk add
      const result = await service.addBulkToQueue(parsed.data.inventoryItemIds, skipConflictCheck);

      // For bulk, include price conflicts in the response
      return NextResponse.json(
        {
          data: {
            added: result.added,
            skipped: result.skipped,
            errors: result.errors,
            priceConflicts: result.priceConflicts,
          },
          message: `Added ${result.added} items to sync queue (${result.skipped} skipped, ${result.errors.length} errors, ${result.priceConflicts.length} price conflicts)`,
        },
        { status: 201 }
      );
    }

    return NextResponse.json({ error: 'No inventory item(s) provided' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/amazon/sync/queue] Error:', error);

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// DELETE - Clear entire queue
// ============================================================================

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new AmazonSyncService(supabase, user.id);
    const deleted = await service.clearQueue();

    return NextResponse.json({
      data: { deleted },
      message: `Cleared ${deleted} items from sync queue`,
    });
  } catch (error) {
    console.error('[DELETE /api/amazon/sync/queue] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
