/**
 * eBay de-listing service.
 *
 * Ends an active eBay fixed-price listing via the Trading API
 * (`EndFixedPriceItem`). Used when the same physical item sells on another
 * channel (e.g. Shopify) so the eBay listing can't be double-sold.
 *
 * There is no other end-listing path in the codebase — this is the canonical
 * one. It authenticates with the user's OAuth token (the Trading API accepts it
 * as an IAF token) and targets the UK site (SiteID 3 / EBAY_GB).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ebayAuthService } from './ebay-auth.service';

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_SITE_ID_UK = '3';
const EBAY_COMPAT_LEVEL = '1349';

export interface EndListingResult {
  success: boolean;
  ebayItemId: string;
  /** Listing status reported by eBay after the call, when available. */
  listingStatus?: string;
  /** True when the listing was already ended/not found (treated as success). */
  alreadyEnded?: boolean;
  error?: string;
}

export interface DelistForItemResult {
  /** Whether an active eBay listing was found for the item. */
  found: boolean;
  ended: boolean;
  ebayItemId?: string;
  error?: string;
  note?: string;
}

export class EbayDelistingService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * End a single eBay listing by its eBay item ID.
   * Treats "already ended / not found" eBay errors as success (idempotent).
   */
  async endListing(userId: string, ebayItemId: string): Promise<EndListingResult> {
    const token = await ebayAuthService.getAccessToken(userId);
    if (!token) {
      return { success: false, ebayItemId, error: 'No eBay access token for user' };
    }

    const requestXml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
      `<ItemID>${ebayItemId}</ItemID>` +
      '<EndingReason>NotAvailable</EndingReason>' +
      '</EndFixedPriceItemRequest>';

    let response: Response;
    try {
      response = await fetch(EBAY_TRADING_API_URL, {
        method: 'POST',
        headers: {
          'X-EBAY-API-CALL-NAME': 'EndFixedPriceItem',
          'X-EBAY-API-SITEID': EBAY_SITE_ID_UK,
          'X-EBAY-API-COMPATIBILITY-LEVEL': EBAY_COMPAT_LEVEL,
          'X-EBAY-API-IAF-TOKEN': token,
          'Content-Type': 'text/xml',
        },
        body: requestXml,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      return {
        success: false,
        ebayItemId,
        error: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const xml = await response.text();
    const ack = pick(xml, 'Ack');
    const errorCodes = pickAll(xml, 'ErrorCode');
    const shortMsg = pick(xml, 'ShortMessage');

    if (ack === 'Success' || ack === 'Warning') {
      return { success: true, ebayItemId, listingStatus: 'Completed' };
    }

    // eBay codes meaning "already gone" — desired end-state already holds, so
    // treat as idempotent success: 1047 auction already closed, 1048 ended /
    // cannot be ended again, 17 item not found (deleted), 21916750 ended.
    const ALREADY_GONE = new Set(['1047', '1048', '17', '21916750']);
    if (errorCodes.some((c) => ALREADY_GONE.has(c))) {
      return { success: true, ebayItemId, alreadyEnded: true, listingStatus: 'Completed' };
    }

    return {
      success: false,
      ebayItemId,
      error: `eBay Ack=${ack || '?'} ${errorCodes.length ? `(${errorCodes.join(',')}) ` : ''}${shortMsg || xml.slice(0, 200)}`,
    };
  }

  /**
   * Find the active eBay listing for an inventory item (by its SKU, which is
   * mirrored as `platform_sku` on the eBay listing) and end it. Marks the
   * `platform_listings` row Completed on success.
   *
   * @param item  inventory item with at least { id, sku }
   */
  async endListingForInventoryItem(
    userId: string,
    item: { id: string; sku: string | null }
  ): Promise<DelistForItemResult> {
    // SKU-less items list on Shopify/eBay under `id.substring(0,8)`, the same
    // fallback used when creating listings — match on that so they de-list too.
    const effectiveSku = item.sku ?? item.id.slice(0, 8);

    const { data: listings } = await this.supabase
      .from('platform_listings')
      .select('id, platform_item_id, listing_status')
      .eq('user_id', userId)
      .eq('platform', 'ebay')
      .eq('platform_sku', effectiveSku);

    const active = (listings ?? []).filter(
      (l) => l.platform_item_id && String(l.listing_status).toLowerCase() === 'active'
    );

    if (active.length === 0) {
      return { found: false, ended: false, note: 'No active eBay listing for SKU' };
    }

    let ended = false;
    let lastError: string | undefined;
    let endedItemId: string | undefined;

    for (const listing of active) {
      const result = await this.endListing(userId, String(listing.platform_item_id));
      if (result.success) {
        ended = true;
        endedItemId = result.ebayItemId;
        await this.supabase
          .from('platform_listings')
          .update({ listing_status: 'Completed' })
          .eq('id', listing.id);
      } else {
        lastError = result.error;
      }
    }

    return { found: true, ended, ebayItemId: endedItemId, error: ended ? undefined : lastError };
  }
}

/** Extract the first value of a simple (non-nested) XML tag. */
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1] : null;
}

/** Extract all values of a simple (non-nested) XML tag (e.g. multiple Errors). */
function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
