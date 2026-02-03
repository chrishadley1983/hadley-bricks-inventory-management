/**
 * Service API: Inventory
 *
 * POST - Create inventory items (bulk)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

const InventoryItemSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  name: z.string().min(1, 'Name is required'),
  condition: z.enum(['New', 'Used']),
  cost: z.number().nonnegative('Cost must be non-negative'),
  purchase_id: z.string().uuid('Invalid purchase ID'),
  listing_platform: z.string().optional(),
  storage_location: z.string().optional(),
  amazon_asin: z.string().optional(),
  list_price: z.number().positive().optional(),
  notes: z.string().optional(),
});

const CreateInventorySchema = z.object({
  items: z.array(InventoryItemSchema).min(1, 'At least one item required'),
});

/**
 * POST /api/service/inventory
 * Create inventory items (supports bulk creation)
 */
export async function POST(request: NextRequest) {
  return withServiceAuth(request, ['write'], async (_keyInfo) => {
    try {
      const body = await request.json();
      const parsed = CreateInventorySchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { items } = parsed.data;
      const supabase = createServiceRoleClient();
      const userId = await getSystemUserId();

      const created: Array<{
        id: string;
        set_number: string;
        item_name: string;
      }> = [];
      const failed: Array<{
        set_number: string;
        error: string;
      }> = [];

      // Create items one by one to handle individual errors
      for (const item of items) {
        try {
          const { data: inventory, error } = await supabase
            .from('inventory_items')
            .insert({
              user_id: userId,
              set_number: item.set_number,
              item_name: item.name,
              condition: item.condition,
              cost: item.cost,
              purchase_id: item.purchase_id,
              listing_platform: item.listing_platform || 'amazon',
              storage_location: item.storage_location || 'TBC',
              amazon_asin: item.amazon_asin,
              list_price: item.list_price,
              notes: item.notes,
              status: 'In Stock',
            })
            .select('id, set_number, item_name')
            .single();

          if (error) {
            failed.push({
              set_number: item.set_number,
              error: error.message,
            });
          } else if (inventory) {
            created.push({
              id: inventory.id,
              set_number: inventory.set_number,
              item_name: inventory.item_name ?? item.name,
            });
          }
        } catch (err) {
          failed.push({
            set_number: item.set_number,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      // If all items failed, return error
      if (created.length === 0 && failed.length > 0) {
        return NextResponse.json(
          {
            error: 'All items failed to create',
            failed,
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          data: {
            created,
            failed: failed.length > 0 ? failed : undefined,
            summary: {
              total: items.length,
              created: created.length,
              failed: failed.length,
            },
          },
        },
        { status: 201 }
      );
    } catch (error) {
      console.error('[POST /api/service/inventory] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
