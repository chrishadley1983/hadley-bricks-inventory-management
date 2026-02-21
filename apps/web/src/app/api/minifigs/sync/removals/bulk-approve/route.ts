import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import { BricqerClient } from '@/lib/bricqer/client';
import type { BricqerCredentials } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';

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

    // Get all pending removals — paginated (M2)
    const removals: Array<Record<string, unknown>> = [];
    {
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error: fetchError } = await supabase
          .from('minifig_removal_queue')
          .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(*)')
          .eq('user_id', user.id)
          .eq('status', 'PENDING')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (fetchError) {
          throw new Error(fetchError.message);
        }

        removals.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === pageSize;
        page++;
      }
    }

    let approved = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    // Share adapters across all removals (M3)
    let ebayAdapter: EbayApiAdapter | null = null;
    let bricqerClient: BricqerClient | null = null;
    const needsEbay = removals.some((r) => r.remove_from === 'EBAY');
    const needsBricqer = removals.some((r) => r.remove_from === 'BRICQER');

    if (needsEbay) {
      const accessToken = await ebayAuthService.getAccessToken(user.id);
      if (accessToken) {
        ebayAdapter = new EbayApiAdapter({
          accessToken,
          marketplaceId: 'EBAY_GB',
          userId: user.id,
        });
      }
    }
    if (needsBricqer) {
      const credentialsRepo = new CredentialsRepository(supabase);
      const bricqerCreds = await credentialsRepo.getCredentials<BricqerCredentials>(
        user.id,
        'bricqer'
      );
      if (bricqerCreds) {
        bricqerClient = new BricqerClient(bricqerCreds);
      }
    }

    for (const removal of removals) {
      try {
        const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;
        const now = new Date().toISOString();

        // Execute removal based on remove_from
        if (removal.remove_from === 'EBAY' && syncItem?.ebay_offer_id && ebayAdapter) {
          try {
            await ebayAdapter.withdrawOffer(syncItem.ebay_offer_id as string);
          } catch {
            // Already withdrawn or not found (E9)
          }

          if (syncItem.ebay_sku) {
            try {
              await ebayAdapter.deleteInventoryItem(syncItem.ebay_sku as string);
            } catch {
              // Already deleted
            }
          }
        } else if (
          removal.remove_from === 'BRICQER' &&
          syncItem?.bricqer_item_id &&
          bricqerClient
        ) {
          // Remove from Bricqer inventory (C1)
          try {
            await bricqerClient.deleteInventoryItem(Number(syncItem.bricqer_item_id));
          } catch {
            // Item may already be removed or sold through Bricqer
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
          .eq('id', removal.id as string)
          .eq('user_id', user.id);

        // Update sync item status
        if (syncItem) {
          const finalStatus = removal.sold_on === 'EBAY' ? 'SOLD_EBAY' : 'SOLD_BRICQER';
          await supabase
            .from('minifig_sync_items')
            .update({
              listing_status: finalStatus,
              updated_at: now,
            })
            .eq('id', removal.minifig_sync_id as string)
            .eq('user_id', user.id);
        }

        approved++;
      } catch (err) {
        failed++;
        errors.push({
          id: removal.id as string,
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
