import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  removalId: z.string().uuid(),
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
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Get the removal queue entry
    const { data: removal, error: fetchError } = await supabase
      .from('minifig_removal_queue')
      .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(*)')
      .eq('id', parsed.data.removalId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !removal) {
      return NextResponse.json({ error: 'Removal not found' }, { status: 404 });
    }

    if (removal.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot approve: status is ${removal.status}` },
        { status: 400 },
      );
    }

    // Execute removal based on remove_from
    const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;

    if (removal.remove_from === 'EBAY' && syncItem?.ebay_offer_id) {
      const accessToken = await ebayAuthService.getAccessToken(user.id);
      if (accessToken) {
        const adapter = new EbayApiAdapter({
          accessToken,
          marketplaceId: 'EBAY_GB',
          userId: user.id,
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
      .eq('id', parsed.data.removalId);

    // Update sync item status
    if (syncItem) {
      const finalStatus =
        removal.sold_on === 'EBAY' ? 'SOLD_EBAY' : 'SOLD_BRICQER';
      await supabase
        .from('minifig_sync_items')
        .update({
          listing_status: finalStatus,
          updated_at: now,
        })
        .eq('id', removal.minifig_sync_id);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/removals/approve] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to approve removal',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
