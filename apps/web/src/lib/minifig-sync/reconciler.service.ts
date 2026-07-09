/**
 * Minifig eBay/Bricqer Reconciler
 *
 * Backstop for the cross-platform de-list flows. Independent of the removal
 * queue, it re-derives the truth from the live platforms and flags drift:
 *
 *   Class A — DOUBLE-SELL RISK: the eBay offer is PUBLISHED (live) but Bricqer
 *     stock is 0. The item can be bought on eBay while we no longer physically
 *     have it (exactly how pha005 double-sold). High priority.
 *
 *   Class B — STALE LISTED: our DB says listing_status='PUBLISHED' but the eBay
 *     offer is not PUBLISHED (ended/unpublished). We think it's earning a listing
 *     and it isn't — lost sales visibility, not a double-sell. Lower priority.
 *
 * Authoritative signals (see minifig-delist-silent-failure memory):
 *   - "live on eBay"  == getOffer(offerId).status === 'PUBLISHED'
 *     (NOT the stored ebay_listing_id — GTC renews under new item ids).
 *   - "in stock"      == Bricqer getInventoryItem(id).remainingQuantity >= 1.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayApiAdapter } from '@/lib/ebay/ebay-api.adapter';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { BricqerClient } from '@/lib/bricqer/client';
import type { BricqerCredentials } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { discordService, DiscordColors } from '@/lib/notifications';
import { fetchAllRecords } from '@/lib/supabase/pagination';

export interface ReconcileFlag {
  syncId: string;
  bricklinkId: string | null;
  name: string | null;
  ebaySku: string | null;
  ebayOfferId: string | null;
  liveListingId: string | null;
  bricqerItemId: string | null;
  bricqerQty: number | null;
  dbStatus: string | null;
  detail: string;
}

export interface ReconcileResult {
  checked: number;
  liveOnEbay: number;
  doubleSellRisks: ReconcileFlag[];
  staleListed: ReconcileFlag[];
  errors: Array<{ item: string; error: string }>;
}

interface OfferItem {
  id: string;
  bricklink_id: string | null;
  name: string | null;
  bricqer_item_id: string | null;
  ebay_sku: string | null;
  ebay_offer_id: string | null;
  listing_status: string | null;
}

export class MinifigReconcilerService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      checked: 0,
      liveOnEbay: 0,
      doubleSellRisks: [],
      staleListed: [],
      errors: [],
    };

    // Only items that could conceivably be live on eBay carry an offer id.
    let items: OfferItem[] = [];
    try {
      items = (await fetchAllRecords(this.supabase, 'minifig_sync_items', {
        select: 'id, bricklink_id, name, bricqer_item_id, ebay_sku, ebay_offer_id, listing_status',
        eq: { user_id: this.userId },
        isNotNull: ['ebay_offer_id'],
      })) as unknown as OfferItem[];
    } catch (err) {
      result.errors.push({ item: 'fetch', error: err instanceof Error ? err.message : String(err) });
      return result;
    }

    const ebay = await this.getEbayAdapter();
    if (!ebay) {
      result.errors.push({ item: 'ebay', error: 'eBay adapter unavailable (no access token)' });
      return result;
    }
    const bricqer = await this.getBricqerClient();

    for (const item of items) {
      if (!item.ebay_offer_id) continue;
      result.checked++;

      // 1. Is the eBay offer live?
      let offerStatus: string | undefined;
      let liveListingId: string | null = null;
      try {
        const offer = await ebay.getOffer(item.ebay_offer_id);
        offerStatus = offer.status;
        liveListingId = offer.listing?.listingId ?? null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 => offer gone => definitely not live. Treat as not-published.
        if (/404|not[\s_]?found/i.test(msg)) {
          offerStatus = 'GONE';
        } else {
          result.errors.push({ item: item.bricklink_id || item.id, error: msg });
          continue;
        }
      }

      const liveOnEbay = offerStatus === 'PUBLISHED';

      // Class B — DB thinks it's listed, eBay disagrees.
      if (item.listing_status === 'PUBLISHED' && !liveOnEbay) {
        result.staleListed.push(
          this.flag(item, liveListingId, null, `DB=PUBLISHED but eBay offer=${offerStatus}`)
        );
      }

      if (!liveOnEbay) continue;
      result.liveOnEbay++;

      // 2. Live on eBay — confirm we still have stock on Bricqer.
      if (!bricqer || !item.bricqer_item_id) {
        // Can't confirm stock; a live listing with no Bricqer link is itself suspect.
        result.doubleSellRisks.push(
          this.flag(item, liveListingId, null, 'live on eBay; Bricqer stock UNVERIFIED')
        );
        continue;
      }

      let qty: number | null = null;
      try {
        const bq = await bricqer.getInventoryItem(Number(item.bricqer_item_id));
        qty = bq?.remainingQuantity ?? bq?.quantity ?? 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Item gone from Bricqer while live on eBay is a strong risk signal.
        if (/404|not[\s_]?found/i.test(msg)) {
          result.doubleSellRisks.push(
            this.flag(item, liveListingId, 0, 'live on eBay; Bricqer item MISSING (sold/purged)')
          );
          continue;
        }
        result.errors.push({ item: item.bricklink_id || item.id, error: `bricqer: ${msg}` });
        continue;
      }

      if ((qty ?? 0) <= 0) {
        result.doubleSellRisks.push(
          this.flag(item, liveListingId, qty, 'live on eBay but Bricqer stock = 0')
        );
      }
    }

    await this.alert(result);
    return result;
  }

  private flag(
    item: OfferItem,
    liveListingId: string | null,
    bricqerQty: number | null,
    detail: string
  ): ReconcileFlag {
    return {
      syncId: item.id,
      bricklinkId: item.bricklink_id,
      name: item.name,
      ebaySku: item.ebay_sku,
      ebayOfferId: item.ebay_offer_id,
      liveListingId,
      bricqerItemId: item.bricqer_item_id,
      bricqerQty,
      dbStatus: item.listing_status,
      detail,
    };
  }

  private async alert(result: ReconcileResult): Promise<void> {
    if (result.doubleSellRisks.length === 0 && result.staleListed.length === 0) return;

    const parts: string[] = [];
    if (result.doubleSellRisks.length > 0) {
      const lines = result.doubleSellRisks.map(
        (f) =>
          `- 🚨 **${f.name || f.bricklinkId || f.syncId}** (${f.bricklinkId}) — ${f.detail}. ` +
          `eBay listing ${f.liveListingId ?? '?'} / offer ${f.ebayOfferId}, SKU ${f.ebaySku}`
      );
      parts.push(
        `**${result.doubleSellRisks.length} DOUBLE-SELL RISK${result.doubleSellRisks.length === 1 ? '' : 'S'}** ` +
          `— live on eBay but out of stock on Bricqer. End the eBay listing now:\n` +
          lines.join('\n')
      );
    }
    if (result.staleListed.length > 0) {
      const lines = result.staleListed
        .slice(0, 25)
        .map((f) => `- **${f.name || f.bricklinkId}** (${f.bricklinkId}) — ${f.detail}`);
      parts.push(
        `**${result.staleListed.length} stale-listed** (DB says PUBLISHED, eBay says not — not selling):\n` +
          lines.join('\n') +
          (result.staleListed.length > 25 ? `\n…and ${result.staleListed.length - 25} more` : '')
      );
    }

    await discordService
      .send('alerts', {
        title: '🔁 Minifig Reconciler',
        description: parts.join('\n\n'),
        color: result.doubleSellRisks.length > 0 ? DiscordColors.RED : DiscordColors.ORANGE,
        fields: [
          { name: 'Checked', value: String(result.checked), inline: true },
          { name: 'Live on eBay', value: String(result.liveOnEbay), inline: true },
          { name: 'Errors', value: String(result.errors.length), inline: true },
        ],
      })
      .catch(() => {
        /* non-blocking */
      });
  }

  private async getEbayAdapter(): Promise<EbayApiAdapter | null> {
    const auth = new EbayAuthService(undefined, this.supabase);
    const token = await auth.getAccessToken(this.userId);
    if (!token) return null;
    return new EbayApiAdapter({ accessToken: token, marketplaceId: 'EBAY_GB', userId: this.userId });
  }

  private async getBricqerClient(): Promise<BricqerClient | null> {
    const credentialsRepo = new CredentialsRepository(this.supabase);
    const creds = await credentialsRepo.getCredentials<BricqerCredentials>(this.userId, 'bricqer');
    return creds ? new BricqerClient(creds) : null;
  }
}
