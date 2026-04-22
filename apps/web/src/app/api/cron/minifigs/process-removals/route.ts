/**
 * POST /api/cron/minifigs/process-removals
 *
 * Auto-processes pending minifig removal queue entries.
 * When a minifig sells on eBay, poll-ebay-orders creates a PENDING
 * removal entry. This cron automatically approves it — reducing
 * Bricqer quantity and sending a Discord confirmation.
 *
 * Schedule: Every 30 minutes (same as poll-ebay-orders)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { BricqerClient } from '@/lib/bricqer/client';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { ebayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { BricqerCredentials } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { archiveShopifyOnSold } from '@/lib/shopify/archive-on-sold';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let execution: ExecutionHandle = noopHandle;

  try {
    execution = await jobExecutionService.start('minifig-process-removals', 'cron');
    const supabase = createServiceRoleClient();
    const userId = DEFAULT_USER_ID;

    // Fetch all pending removals
    const { data: removals, error: fetchError } = await supabase
      .from('minifig_removal_queue')
      .select('*, minifig_sync_items!minifig_removal_queue_minifig_sync_id_fkey(*)')
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .limit(50);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!removals || removals.length === 0) {
      await execution.complete({ message: 'No pending removals' }, 200);
      return NextResponse.json({ approved: 0, message: 'No pending removals' });
    }

    // Initialise platform adapters
    let ebayAdapter: EbayApiAdapter | null = null;
    let bricqerClient: BricqerClient | null = null;
    const needsEbay = removals.some((r) => r.remove_from === 'EBAY');
    const needsBricqer = removals.some((r) => r.remove_from === 'BRICQER');

    if (needsEbay) {
      const accessToken = await ebayAuthService.getAccessToken(userId);
      if (accessToken) {
        ebayAdapter = new EbayApiAdapter({
          accessToken,
          marketplaceId: 'EBAY_GB',
          userId,
        });
      }
    }
    if (needsBricqer) {
      const credentialsRepo = new CredentialsRepository(supabase);
      const bricqerCreds = await credentialsRepo.getCredentials<BricqerCredentials>(
        userId,
        'bricqer'
      );
      if (bricqerCreds) {
        bricqerClient = new BricqerClient(bricqerCreds);
      }
    }

    let approved = 0;
    let failed = 0;
    const processed: Array<{ name: string; soldOn: string; removedFrom: string }> = [];

    for (const removal of removals) {
      const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;
      const itemName = (syncItem?.name as string) || 'Unknown';

      try {
        const now = new Date().toISOString();

        // Execute removal
        if (removal.remove_from === 'EBAY' && syncItem?.ebay_offer_id && ebayAdapter) {
          try {
            await ebayAdapter.withdrawOffer(syncItem.ebay_offer_id as string);
          } catch {
            // Already withdrawn
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
          try {
            await bricqerClient.reduceInventoryQuantity(Number(syncItem.bricqer_item_id), 1);
          } catch {
            // Already removed or sold through
          }
        }

        // Mark as executed
        await supabase
          .from('minifig_removal_queue')
          .update({ status: 'EXECUTED', executed_at: now, reviewed_at: now })
          .eq('id', removal.id as string)
          .eq('user_id', userId);

        // Update sync item final status
        if (syncItem) {
          const finalStatus = removal.sold_on === 'EBAY' ? 'SOLD_EBAY' : 'SOLD_BRICQER';
          await supabase
            .from('minifig_sync_items')
            .update({ listing_status: finalStatus, updated_at: now })
            .eq('id', removal.minifig_sync_id as string)
            .eq('user_id', userId);

          // Archive Shopify product (non-blocking).
          // Do not filter by inventory_items.status — that only flips to SOLD when the
          // eBay order reaches FULFILLED (i.e. after shipping), which can lag days behind
          // the sale. The Shopify archive must happen immediately to prevent double-sale.
          const bricklinkId = syncItem.bricklink_id as string | null;
          if (bricklinkId) {
            const { data: invItem } = await supabase
              .from('inventory_items')
              .select('id')
              .eq('user_id', userId)
              .eq('set_number', bricklinkId)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (invItem) {
              archiveShopifyOnSold(supabase, userId, invItem.id);
            }
          }
        }

        approved++;
        processed.push({
          name: itemName,
          soldOn: removal.sold_on as string,
          removedFrom: removal.remove_from as string,
        });
      } catch (err) {
        failed++;
        console.error(`[process-removals] Failed for ${itemName}:`, err);
      }
    }

    // Send Discord notification
    if (approved > 0) {
      const lines = processed.map(
        (p) => `- **${p.name}** (sold on ${p.soldOn}, removed from ${p.removedFrom})`
      );
      await discordService.sendSyncStatus({
        title: `Minifig Removals Auto-Processed`,
        message:
          `**${approved}** removal${approved === 1 ? '' : 's'} processed automatically.\n\n` +
          lines.join('\n'),
        success: failed === 0,
      });
    }

    await execution.complete(
      { approved, failed, items: processed.map((p) => p.name) },
      200,
      approved,
      failed
    );

    return NextResponse.json({ approved, failed, processed });
  } catch (error) {
    console.error('[process-removals] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
