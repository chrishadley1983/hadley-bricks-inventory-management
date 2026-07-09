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
import { verifyCronAuth } from '@/lib/api/cron-auth';
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

/**
 * End a minifig's eBay listing and VERIFY it is actually down.
 *
 * Withdrawing the offer + deleting the inventory item is best-effort (either may
 * legitimately throw "already gone"), so the authoritative check is a follow-up
 * getOffer: a still-`PUBLISHED` offer means the listing is live (eBay keeps
 * Good-'Til-Cancelled listings renewing under new item ids until they sell — the
 * exact way pha005 double-sold). Throws if the offer is still PUBLISHED or its
 * state cannot be confirmed; resolves if the offer is unpublished or gone (404).
 */
async function withdrawAndVerifyEbay(
  adapter: EbayApiAdapter,
  offerId: string,
  sku: string | undefined
): Promise<void> {
  try {
    await adapter.withdrawOffer(offerId);
  } catch {
    // May already be withdrawn — the getOffer verification below is the source of truth.
  }
  if (sku) {
    try {
      await adapter.deleteInventoryItem(sku);
    } catch {
      // May already be deleted — non-fatal; offer status is what matters.
    }
  }

  // Verify the offer is no longer live.
  let status: string | undefined;
  try {
    const offer = await adapter.getOffer(offerId);
    status = offer.status;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A 404 means the offer no longer exists (deleted with the inventory item) — that's success.
    if (/404|not[\s_]?found/i.test(msg)) return;
    throw new Error(`could not verify eBay offer ${offerId} status: ${msg}`);
  }

  if (status === 'PUBLISHED') {
    throw new Error(`eBay offer ${offerId} still PUBLISHED after withdraw — listing still live`);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronAuth(request);
  if (unauthorized) return unauthorized;

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
    // Shopify-origin rows (remove_from='BRICQER') also need eBay torn down as a
    // safety net for the Shopify sync's inline end, so they require the adapter too.
    const needsEbay = removals.some((r) => r.remove_from === 'EBAY' || r.sold_on === 'SHOPIFY');
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
    const failures: Array<{ name: string; reason: string }> = [];

    for (const removal of removals) {
      const syncItem = removal.minifig_sync_items as Record<string, unknown> | null;
      const itemName = (syncItem?.name as string) || 'Unknown';

      try {
        const now = new Date().toISOString();

        // Execute removal.
        //
        // The row's `remove_from` is the REQUIRED action; we only mark EXECUTED
        // once it is confirmed done. A silently-failed eBay withdraw previously
        // looked identical to success (double-sold pha005 — sold on Bricqer then
        // stayed live on eBay and sold again 10 weeks later). So for eBay we
        // withdraw AND then verify via getOffer that the offer is no longer
        // PUBLISHED before considering it done.
        let teardownOk = true;
        let failureReason = '';

        if (removal.remove_from === 'EBAY') {
          if (!syncItem?.ebay_offer_id) {
            // No offer id => nothing can be live on eBay for this item.
            teardownOk = true;
          } else if (!ebayAdapter) {
            teardownOk = false;
            failureReason = 'eBay adapter unavailable (no access token) — de-list not attempted';
          } else {
            teardownOk = await withdrawAndVerifyEbay(
              ebayAdapter,
              syncItem.ebay_offer_id as string,
              syncItem.ebay_sku as string | undefined
            ).then(
              () => true,
              (err: unknown) => {
                failureReason =
                  err instanceof Error ? err.message : `eBay teardown failed: ${String(err)}`;
                return false;
              }
            );
          }
        } else if (removal.remove_from === 'BRICQER') {
          if (!syncItem?.bricqer_item_id) {
            teardownOk = true;
          } else if (!bricqerClient) {
            teardownOk = false;
            failureReason = 'Bricqer client unavailable — removal not attempted';
          } else {
            try {
              // Idempotent: reduceInventoryQuantity floors at 0, so re-runs are safe.
              await bricqerClient.reduceInventoryQuantity(Number(syncItem.bricqer_item_id), 1);
            } catch (err) {
              teardownOk = false;
              failureReason = `Bricqer reduce failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        }

        // Shopify-origin minifig sales need the eBay listing ended too (it isn't
        // in platform_listings, so no other reconcile covers it). The Shopify
        // order sync ends it inline at sale time; repeat it here as a retried
        // safety net in case that single inline attempt failed. This is a
        // best-effort backstop on top of the required BRICQER removal — the
        // reconciler cron is the ultimate net for any residual live listing.
        if (removal.sold_on === 'SHOPIFY' && syncItem?.ebay_offer_id && ebayAdapter) {
          await withdrawAndVerifyEbay(
            ebayAdapter,
            syncItem.ebay_offer_id as string,
            syncItem.ebay_sku as string | undefined
          ).catch((err: unknown) => {
            console.warn(
              `[process-removals] Shopify eBay safety-net de-list unverified for ${itemName}:`,
              err instanceof Error ? err.message : err
            );
          });
        }

        // Do NOT mark EXECUTED if the required removal was not confirmed — leave
        // the row PENDING so the next run retries, and record why. The sync item
        // keeps its *_PENDING_REMOVAL status so it stays visibly flagged.
        if (!teardownOk) {
          failed++;
          failures.push({ name: itemName, reason: failureReason });
          console.error(`[process-removals] Removal NOT confirmed for ${itemName}: ${failureReason}`);
          await supabase
            .from('minifig_removal_queue')
            .update({ error_message: failureReason, reviewed_at: now })
            .eq('id', removal.id as string)
            .eq('user_id', userId);
          continue;
        }

        // Mark as executed (clear any error from a prior failed attempt)
        await supabase
          .from('minifig_removal_queue')
          .update({ status: 'EXECUTED', executed_at: now, reviewed_at: now, error_message: null })
          .eq('id', removal.id as string)
          .eq('user_id', userId);

        // Update sync item final status
        if (syncItem) {
          const finalStatus =
            removal.sold_on === 'EBAY'
              ? 'SOLD_EBAY'
              : removal.sold_on === 'SHOPIFY'
                ? 'SOLD_SHOPIFY'
                : 'SOLD_BRICQER';
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
    if (approved > 0 || failures.length > 0) {
      const lines = processed.map(
        (p) => `- **${p.name}** (sold on ${p.soldOn}, removed from ${p.removedFrom})`
      );
      const failureLines = failures.map((f) => `- ⚠️ **${f.name}** — NOT removed: ${f.reason}`);
      const messageParts: string[] = [];
      if (approved > 0) {
        messageParts.push(
          `**${approved}** removal${approved === 1 ? '' : 's'} processed automatically.\n` +
            lines.join('\n')
        );
      }
      if (failures.length > 0) {
        messageParts.push(
          `**${failures.length}** removal${failures.length === 1 ? '' : 's'} could NOT be confirmed ` +
            `(left pending, will retry — possible live double-sell risk):\n` +
            failureLines.join('\n')
        );
      }
      await discordService.sendSyncStatus({
        title: `Minifig Removals Auto-Processed`,
        message: messageParts.join('\n\n'),
        success: failures.length === 0,
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
