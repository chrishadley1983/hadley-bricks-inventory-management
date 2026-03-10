/**
 * POST /api/reports/buy-box-gap/reprice
 *
 * Updates the listing price for an ASIN:
 * 1. Updates listing_value on all inventory_items with that ASIN
 * 2. Adds them to amazon_sync_queue for price push to Amazon
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';
import { UK_MARKETPLACE_ID } from '@/lib/amazon/amazon-sync.types';

const RepriceSchema = z.object({
  asin: z.string().min(1),
  newPrice: z.number().positive(),
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

    const body = await request.json();
    const parsed = RepriceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { asin, newPrice } = parsed.data;

    // Step 1: Find all inventory items with this ASIN that are LISTED or BACKLOG
    const { data: inventoryItems, error: fetchError } = await supabase
      .from('inventory_items')
      .select('id, listing_value, status, sku, amazon_asin')
      .eq('amazon_asin', asin)
      .eq('user_id', user.id)
      .in('status', ['LISTED', 'BACKLOG', 'listed', 'backlog']);

    if (fetchError) {
      return NextResponse.json(
        { error: `Failed to find inventory items: ${fetchError.message}` },
        { status: 500 }
      );
    }

    if (!inventoryItems || inventoryItems.length === 0) {
      return NextResponse.json(
        { error: `No inventory items found for ASIN ${asin}` },
        { status: 404 }
      );
    }

    // Step 2: Update listing_value on all matching inventory items
    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({ listing_value: newPrice })
      .eq('amazon_asin', asin)
      .eq('user_id', user.id)
      .in('status', ['LISTED', 'BACKLOG', 'listed', 'backlog']);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update listing price: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Step 3: Pre-fetch Amazon SKU from platform_listings (shared across all items for this ASIN)
    const { data: listing } = await supabase
      .from('platform_listings')
      .select('platform_sku, platform_item_id')
      .eq('user_id', user.id)
      .eq('platform', 'amazon')
      .eq('platform_item_id', asin)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const amazonSku = listing?.platform_sku ?? null;

    // Step 4: Look up the real product type for this ASIN
    const service = new AmazonSyncService(supabase, user.id);
    const productType = await service.getProductTypeForAsin(asin, UK_MARKETPLACE_ID);

    // Step 5: Add items to amazon sync queue
    let queued = 0;
    const errors: string[] = [];

    for (const item of inventoryItems) {
      try {
        const status = item.status?.toUpperCase();
        if (status === 'BACKLOG') {
          // Use standard add-to-queue (it expects BACKLOG status)
          const result = await service.addToQueue(item.id, true);
          if (result.success) {
            queued++;
          } else if (result.error && !result.error.includes('already in the sync queue')) {
            errors.push(`${item.id}: ${result.error}`);
          } else {
            queued++; // already in queue counts as success
          }
        } else if (status === 'LISTED') {
          if (!amazonSku) {
            errors.push(`${item.id}: No Amazon SKU found in platform_listings`);
            continue;
          }

          // Insert directly into queue
          const { error: insertError } = await supabase
            .from('amazon_sync_queue')
            .insert({
              user_id: user.id,
              inventory_item_id: item.id,
              sku: item.sku || asin,
              asin,
              local_price: newPrice,
              local_quantity: 1,
              amazon_sku: amazonSku,
              amazon_price: null,
              amazon_quantity: null,
              product_type: productType,
              is_new_sku: false,
            });

          if (insertError) {
            if (insertError.code === '23505') {
              // Already in queue — update the price instead
              await supabase
                .from('amazon_sync_queue')
                .update({ local_price: newPrice })
                .eq('inventory_item_id', item.id)
                .eq('user_id', user.id);
              queued++;
            } else {
              errors.push(`${item.id}: ${insertError.message}`);
            }
          } else {
            queued++;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.id}: ${msg}`);
      }
    }

    return NextResponse.json({
      data: {
        asin,
        newPrice,
        inventoryItemsUpdated: inventoryItems.length,
        queuedForSync: queued,
        errors,
      },
      message: `Updated ${inventoryItems.length} items to £${newPrice.toFixed(2)}, ${queued} queued for Amazon sync`,
    });
  } catch (error) {
    console.error('[POST /api/reports/buy-box-gap/reprice] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
