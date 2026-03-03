import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import { BricqerClient } from '@/lib/bricqer/client';
import type { BricqerCredentials } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { archiveShopifyOnSold } from '@/lib/shopify/archive-on-sold';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  removalId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Get the removal queue entry
    const { data: removal, error: fetchError } = await supabase
      .from('minifig_removal_queue')
      .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(*)')
      .eq('id', parsed.data.removalId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !removal) {
      return NextResponse.json({ error: 'Removal not found' }, { status: 404 });
    }

    if (removal.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot approve: status is ${removal.status}` },
        { status: 400 }
      );
    }

    // Execute removal based on remove_from
    const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;

    if (removal.remove_from === 'EBAY' && syncItem?.ebay_offer_id) {
      const accessToken = await ebayAuthService.getAccessToken(userId);
      if (accessToken) {
        const adapter = new EbayApiAdapter({
          accessToken,
          marketplaceId: 'EBAY_GB',
          userId: userId,
        });

        try {
          await adapter.withdrawOffer(syncItem.ebay_offer_id as string);
        } catch {
          // Already withdrawn or not found
        }

        if (syncItem.ebay_sku) {
          try {
            await adapter.deleteInventoryItem(syncItem.ebay_sku as string);
          } catch {
            // Already deleted
          }
        }
      }
    } else if (removal.remove_from === 'BRICQER' && syncItem?.bricqer_item_id) {
      // Reduce quantity on Bricqer (or delete if qty reaches 0)
      const credentialsRepo = new CredentialsRepository(supabase);
      const bricqerCreds = await credentialsRepo.getCredentials<BricqerCredentials>(
        userId,
        'bricqer'
      );
      if (bricqerCreds) {
        const bricqerClient = new BricqerClient(bricqerCreds);
        try {
          await bricqerClient.reduceInventoryQuantity(Number(syncItem.bricqer_item_id), 1);
        } catch {
          // Item may already be removed or sold through Bricqer
        }
      }
    }

    // Mark removal as executed
    const now = new Date().toISOString();
    await supabase
      .from('minifig_removal_queue')
      .update({
        status: 'EXECUTED',
        executed_at: now,
        reviewed_at: now,
      })
      .eq('id', parsed.data.removalId)
      .eq('user_id', userId);

    // Update sync item status
    if (syncItem) {
      const finalStatus = removal.sold_on === 'EBAY' ? 'SOLD_EBAY' : 'SOLD_BRICQER';
      await supabase
        .from('minifig_sync_items')
        .update({
          listing_status: finalStatus,
          updated_at: now,
        })
        .eq('id', removal.minifig_sync_id)
        .eq('user_id', userId);

      // Archive matching Shopify product (non-blocking)
      // Use status=SOLD to target the item that was actually sold, not a sibling
      const bricklinkId = syncItem.bricklink_id as string | null;
      if (bricklinkId) {
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('user_id', userId)
          .eq('set_number', bricklinkId)
          .eq('status', 'SOLD')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (invItem) {
          archiveShopifyOnSold(supabase, userId, invItem.id);
        }
      }
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/removals/approve] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to approve removal',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
