import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all pending removals
    const { data: removals, error: fetchError } = await supabase
      .from('minifig_removal_queue')
      .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(*)')
      .eq('user_id', user.id)
      .eq('status', 'PENDING');

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    let approved = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const removal of removals ?? []) {
      try {
        const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;
        const now = new Date().toISOString();

        // Execute removal based on remove_from
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
              // Already withdrawn or not found (E9)
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
        await supabase
          .from('minifig_removal_queue')
          .update({
            status: 'EXECUTED',
            executed_at: now,
            reviewed_at: now,
          })
          .eq('id', removal.id);

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

        approved++;
      } catch (err) {
        failed++;
        errors.push({
          id: removal.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ data: { approved, failed, errors } });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/removals/bulk-approve] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to bulk approve',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
