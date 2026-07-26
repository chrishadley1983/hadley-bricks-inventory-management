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
 *   Class C — UNBACKED ON SHOPIFY: the Shopify product is live but Bricqer stock
 *     is 0. Same buy-what-we-haven't-got exposure as Class A, on the other
 *     channel. Nothing watched this: the full-sync alignment report and
 *     reconcileArchiveDrift both decide "sold" from `inventory_items.status`,
 *     which a minifig sale NEVER writes (only `minifig_sync_items.listing_status`
 *     moves), so 12 sold-out minifigs stayed buyable on Shopify for ~3 months.
 *
 * Authoritative signals (see minifig-delist-silent-failure memory):
 *   - "live on eBay"  == getOffer(offerId).status === 'PUBLISHED'
 *     (NOT the stored ebay_listing_id — GTC renews under new item ids).
 *   - "in stock"      == Bricqer getInventoryItem(id).remainingQuantity >= 1.
 *   - Class C keys on live Bricqer stock, NOT on listing_status: that column is
 *     partly fiction (an order-line/inventory-item id collision invented 5 of 18
 *     "sales" — see minifig-phantom-bricqer-sales memory).
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
  /** Set only on Class C (unbacked-on-Shopify) flags. */
  shopifyProductId?: string | null;
}

export interface ReconcileResult {
  checked: number;
  liveOnEbay: number;
  doubleSellRisks: ReconcileFlag[];
  staleListed: ReconcileFlag[];
  /** Class C — live on Shopify with zero Bricqer stock. */
  unbackedOnShopify: ReconcileFlag[];
  /** How many live Shopify products were checked (Class C denominator). */
  shopifyChecked: number;
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
      unbackedOnShopify: [],
      shopifyChecked: 0,
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

    const bricqer = await this.getBricqerClient();
    // Bricqer stock is read by both passes — fetch each item at most once.
    const qtyCache = new Map<string, number | null>();

    const ebay = await this.getEbayAdapter();
    if (!ebay) {
      // Do NOT bail: an eBay token problem must not also blind the Shopify arm
      // (that combination is exactly what let the 12 unbacked products sit).
      result.errors.push({ item: 'ebay', error: 'eBay adapter unavailable (no access token)' });
      await this.reconcileShopify(result, bricqer, qtyCache);
      await this.alert(result);
      return result;
    }

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

      let qty: number | null;
      try {
        qty = await this.bricqerQty(bricqer, item.bricqer_item_id, qtyCache);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ item: item.bricklink_id || item.id, error: `bricqer: ${msg}` });
        continue;
      }

      if (qty === null) {
        // 404 — item gone from Bricqer while live on eBay is a strong risk signal.
        result.doubleSellRisks.push(
          this.flag(item, liveListingId, 0, 'live on eBay; Bricqer item MISSING (sold/purged)')
        );
        continue;
      }

      if (qty <= 0) {
        result.doubleSellRisks.push(
          this.flag(item, liveListingId, qty, 'live on eBay but Bricqer stock = 0')
        );
      }
    }

    await this.reconcileShopify(result, bricqer, qtyCache);
    await this.alert(result);
    return result;
  }

  /**
   * Class C — minifigs whose Shopify product is live while Bricqer holds none.
   *
   * Deliberately keyed on live Bricqer stock rather than `listing_status` or
   * `inventory_items.status`: the former is partly fiction (phantom sales), and
   * the latter is never written by a minifig sale, which is precisely why the
   * existing Shopify watchers cannot see this class.
   */
  private async reconcileShopify(
    result: ReconcileResult,
    bricqer: BricqerClient | null,
    qtyCache: Map<string, number | null>
  ): Promise<void> {
    let syncItems: Array<{
      id: string;
      bricklink_id: string | null;
      name: string | null;
      bricqer_item_id: string | null;
      ebay_sku: string | null;
      ebay_offer_id: string | null;
      listing_status: string | null;
    }>;
    try {
      syncItems = (await fetchAllRecords(this.supabase, 'minifig_sync_items', {
        select: 'id, bricklink_id, name, bricqer_item_id, ebay_sku, ebay_offer_id, listing_status',
        eq: { user_id: this.userId },
        isNotNull: ['bricklink_id'],
      })) as never;
    } catch (err) {
      result.errors.push({
        item: 'shopify-fetch',
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (syncItems.length === 0) return;

    // minifig -> inventory item (minifigs are keyed by bricklink_id as set_number)
    const blIds = [...new Set(syncItems.map((s) => s.bricklink_id).filter(Boolean))] as string[];
    const invBySet = new Map<string, string>();
    for (let i = 0; i < blIds.length; i += 300) {
      const { data, error } = await this.supabase
        .from('inventory_items')
        .select('id, set_number')
        .eq('user_id', this.userId)
        .in('set_number', blIds.slice(i, i + 300));
      if (error) {
        result.errors.push({ item: 'shopify-inventory', error: error.message });
        return;
      }
      for (const r of data ?? []) if (r.set_number) invBySet.set(r.set_number, r.id);
    }

    // inventory item -> live (non-archived) Shopify product
    const invIds = [...new Set(invBySet.values())];
    const productByInv = new Map<string, string>();
    for (let i = 0; i < invIds.length; i += 300) {
      const { data, error } = await this.supabase
        .from('shopify_products')
        .select('inventory_item_id, shopify_product_id, shopify_status')
        .eq('user_id', this.userId)
        .neq('shopify_status', 'archived')
        .in('inventory_item_id', invIds.slice(i, i + 300));
      if (error) {
        result.errors.push({ item: 'shopify-products', error: error.message });
        return;
      }
      for (const r of data ?? []) {
        if (r.inventory_item_id && r.shopify_product_id) {
          productByInv.set(r.inventory_item_id, r.shopify_product_id);
        }
      }
    }

    // Group by Shopify PRODUCT, not by sync item. We own duplicates of some
    // figs — several sync items (each its own Bricqer inventory item) resolve to
    // ONE product. Stock must be summed across every unit behind a product or a
    // sold duplicate looks unbacked: hp155 has units [0, 1], so the product is
    // still backed by the second Dementor and must not be flagged.
    const groups = new Map<string, { units: typeof syncItems; sample: (typeof syncItems)[number] }>();
    for (const s of syncItems) {
      const invId = s.bricklink_id ? invBySet.get(s.bricklink_id) : undefined;
      const productId = invId ? productByInv.get(invId) : undefined;
      if (!productId) continue;
      const g = groups.get(productId);
      if (g) g.units.push(s);
      else groups.set(productId, { units: [s], sample: s });
    }

    for (const [productId, { units, sample }] of groups) {
      result.shopifyChecked++;

      const unlinked = units.filter((u) => !u.bricqer_item_id);
      if (!bricqer || unlinked.length === units.length) {
        result.unbackedOnShopify.push(
          this.flag(sample, null, null, 'live on Shopify; Bricqer stock UNVERIFIED', productId)
        );
        continue;
      }

      let total = 0;
      let missing = 0;
      let failed = false;
      for (const u of units) {
        if (!u.bricqer_item_id) continue;
        let qty: number | null;
        try {
          qty = await this.bricqerQty(bricqer, u.bricqer_item_id, qtyCache);
        } catch (err) {
          result.errors.push({
            item: u.bricklink_id || u.id,
            error: `bricqer (shopify pass): ${err instanceof Error ? err.message : String(err)}`,
          });
          failed = true;
          break;
        }
        if (qty === null) missing++;
        else total += qty;
      }
      // A read failure means we cannot prove the product is unbacked — say
      // nothing rather than risk telling Chris to de-list stock he owns.
      if (failed) continue;

      if (total > 0) continue;

      const detail =
        missing === units.length
          ? 'live on Shopify; Bricqer item MISSING (sold/purged)'
          : `live on Shopify but Bricqer stock = 0 across ${units.length} unit(s)`;
      result.unbackedOnShopify.push(this.flag(sample, null, 0, detail, productId));
    }
  }

  /**
   * Bricqer stock for an item, memoised across both passes.
   * Returns null when the item 404s (gone), throws on any other error.
   */
  private async bricqerQty(
    bricqer: BricqerClient,
    bricqerItemId: string,
    cache: Map<string, number | null>
  ): Promise<number | null> {
    if (cache.has(bricqerItemId)) return cache.get(bricqerItemId)!;
    try {
      const bq = await bricqer.getInventoryItem(Number(bricqerItemId));
      const qty = bq?.remainingQuantity ?? bq?.quantity ?? 0;
      cache.set(bricqerItemId, qty);
      return qty;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/404|not[\s_]?found/i.test(msg)) {
        cache.set(bricqerItemId, null);
        return null;
      }
      throw err;
    }
  }

  private flag(
    item: OfferItem,
    liveListingId: string | null,
    bricqerQty: number | null,
    detail: string,
    shopifyProductId?: string | null
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
      ...(shopifyProductId !== undefined ? { shopifyProductId } : {}),
    };
  }

  private async alert(result: ReconcileResult): Promise<void> {
    if (
      result.doubleSellRisks.length === 0 &&
      result.staleListed.length === 0 &&
      result.unbackedOnShopify.length === 0
    ) {
      return;
    }

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
    if (result.unbackedOnShopify.length > 0) {
      const lines = result.unbackedOnShopify.map(
        (f) =>
          `- 🚨 **${f.name || f.bricklinkId || f.syncId}** (${f.bricklinkId}) — ${f.detail}. ` +
          `Shopify product ${f.shopifyProductId ?? '?'}`
      );
      parts.push(
        `**${result.unbackedOnShopify.length} UNBACKED ON SHOPIFY** ` +
          `— buyable on Shopify with no Bricqer stock. Archive the product:\n` +
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
        color:
          result.doubleSellRisks.length > 0 || result.unbackedOnShopify.length > 0
            ? DiscordColors.RED
            : DiscordColors.ORANGE,
        fields: [
          { name: 'Checked', value: String(result.checked), inline: true },
          { name: 'Live on eBay', value: String(result.liveOnEbay), inline: true },
          { name: 'Live on Shopify', value: String(result.shopifyChecked), inline: true },
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
