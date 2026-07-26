/**
 * Tests for MinifigReconcilerService classification logic:
 *   - DOUBLE-SELL RISK: eBay offer PUBLISHED + Bricqer qty 0 (or item missing)
 *   - STALE LISTED:     DB listing_status PUBLISHED + offer not PUBLISHED
 *   - clean:            offer PUBLISHED + Bricqer qty >= 1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOffer, getInventoryItem, send, fetchAllRecords, getAccessToken } = vi.hoisted(() => ({
  getOffer: vi.fn(),
  getInventoryItem: vi.fn(),
  send: vi.fn(),
  fetchAllRecords: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('../../ebay/ebay-auth.service', () => ({
  EbayAuthService: class {
    getAccessToken = getAccessToken;
  },
}));
vi.mock('../../ebay/ebay-api.adapter', () => ({
  EbayApiAdapter: class {
    getOffer = getOffer;
  },
}));
vi.mock('../../bricqer/client', () => ({
  BricqerClient: class {
    getInventoryItem = getInventoryItem;
  },
}));
vi.mock('../../repositories/credentials.repository', () => ({
  CredentialsRepository: class {
    getCredentials = vi.fn().mockResolvedValue({ apiKey: 'k', tenantUrl: 'https://t' });
  },
}));
vi.mock('../../notifications', () => ({
  discordService: { send },
  DiscordColors: { RED: 1, ORANGE: 2 },
}));
vi.mock('../../supabase/pagination', () => ({
  fetchAllRecords: (...args: unknown[]) => fetchAllRecords(...args),
}));

import { MinifigReconcilerService } from '../reconciler.service';

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sync-1',
    bricklink_id: 'pha005',
    name: 'Flying Mummy',
    bricqer_item_id: '7449',
    ebay_sku: 'HB-MF-7449-U-307-1',
    ebay_offer_id: 'offer-1',
    listing_status: 'PUBLISHED',
    ...overrides,
  };
}

/**
 * Supabase stub for the Class C (Shopify) pass.
 * `inventoryRows` maps minifigs to inventory items; `productRows` are the
 * NON-archived Shopify products. Empty by default so the eBay-only tests see
 * no Shopify candidates.
 */
function supabaseStub(
  inventoryRows: Array<{ id: string; set_number: string }> = [],
  productRows: Array<{ inventory_item_id: string; shopify_product_id: string }> = []
) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({
            data: table === 'inventory_items' ? inventoryRows : productRows,
            error: null,
          }),
          neq: () => ({
            in: async () => ({ data: productRows, error: null }),
          }),
        }),
      }),
    }),
  } as never;
}

describe('MinifigReconcilerService', () => {
  let service: MinifigReconcilerService;

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ success: true });
    getAccessToken.mockResolvedValue('test-token');
    service = new MinifigReconcilerService(supabaseStub(), 'user-1');
  });

  it('flags DOUBLE-SELL RISK when offer PUBLISHED but Bricqer qty 0', async () => {
    fetchAllRecords.mockResolvedValue([item()]);
    getOffer.mockResolvedValue({ status: 'PUBLISHED', listing: { listingId: '178159116313' } });
    getInventoryItem.mockResolvedValue({ remainingQuantity: 0 });

    const r = await service.reconcile();

    expect(r.doubleSellRisks).toHaveLength(1);
    expect(r.doubleSellRisks[0].bricklinkId).toBe('pha005');
    expect(r.doubleSellRisks[0].liveListingId).toBe('178159116313');
    expect(r.staleListed).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flags DOUBLE-SELL RISK when offer PUBLISHED but Bricqer item is gone (404)', async () => {
    fetchAllRecords.mockResolvedValue([item()]);
    getOffer.mockResolvedValue({ status: 'PUBLISHED', listing: { listingId: '999' } });
    getInventoryItem.mockRejectedValue(new Error('404 Not Found'));

    const r = await service.reconcile();

    expect(r.doubleSellRisks).toHaveLength(1);
    expect(r.doubleSellRisks[0].detail).toMatch(/MISSING/);
  });

  it('does NOT flag when offer PUBLISHED and Bricqer qty >= 1', async () => {
    fetchAllRecords.mockResolvedValue([item()]);
    getOffer.mockResolvedValue({ status: 'PUBLISHED', listing: { listingId: '1' } });
    getInventoryItem.mockResolvedValue({ remainingQuantity: 1 });

    const r = await service.reconcile();

    expect(r.doubleSellRisks).toHaveLength(0);
    expect(r.staleListed).toHaveLength(0);
    expect(r.liveOnEbay).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('flags STALE LISTED when DB says PUBLISHED but offer is UNPUBLISHED', async () => {
    fetchAllRecords.mockResolvedValue([item({ listing_status: 'PUBLISHED' })]);
    getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });

    const r = await service.reconcile();

    expect(r.staleListed).toHaveLength(1);
    expect(r.doubleSellRisks).toHaveLength(0);
    // Bricqer never consulted for a down listing.
    expect(getInventoryItem).not.toHaveBeenCalled();
  });

  it('treats a 404 offer as not-live (no double-sell) and flags stale if DB PUBLISHED', async () => {
    fetchAllRecords.mockResolvedValue([item({ listing_status: 'PUBLISHED' })]);
    getOffer.mockRejectedValue(new Error('404 not found'));

    const r = await service.reconcile();

    expect(r.doubleSellRisks).toHaveLength(0);
    expect(r.staleListed).toHaveLength(1);
    expect(r.liveOnEbay).toBe(0);
  });

  it('does not flag a sold item that is correctly down on both platforms', async () => {
    fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
    getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });

    const r = await service.reconcile();

    expect(r.doubleSellRisks).toHaveLength(0);
    expect(r.staleListed).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('records an error (not a risk) when the offer status cannot be fetched', async () => {
    fetchAllRecords.mockResolvedValue([item()]);
    getOffer.mockRejectedValue(new Error('500 server error'));

    const r = await service.reconcile();

    expect(r.errors).toHaveLength(1);
    expect(r.doubleSellRisks).toHaveLength(0);
    expect(r.staleListed).toHaveLength(0);
  });

  /**
   * Class C — the gap that let 12 sold-out minifigs stay buyable on Shopify for
   * ~3 months. Note every assertion here keys on Bricqer stock, never on
   * listing_status or inventory_items.status.
   */
  describe('Class C — unbacked on Shopify', () => {
    const INV = [{ id: 'inv-1', set_number: 'pha005' }];
    const PROD = [{ inventory_item_id: 'inv-1', shopify_product_id: '10429134045450' }];

    function withShopify() {
      return new MinifigReconcilerService(supabaseStub(INV, PROD), 'user-1');
    }

    it('flags a minifig live on Shopify with Bricqer stock 0', async () => {
      fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
      getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });
      getInventoryItem.mockResolvedValue({ remainingQuantity: 0 });

      const r = await withShopify().reconcile();

      expect(r.unbackedOnShopify).toHaveLength(1);
      expect(r.unbackedOnShopify[0].bricklinkId).toBe('pha005');
      expect(r.unbackedOnShopify[0].shopifyProductId).toBe('10429134045450');
      expect(r.shopifyChecked).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does NOT flag when Bricqer still holds stock, even if the DB says SOLD', async () => {
      // The phantom-sale case: listing_status lies, stock is the truth.
      fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
      getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });
      getInventoryItem.mockResolvedValue({ remainingQuantity: 1 });

      const r = await withShopify().reconcile();

      expect(r.unbackedOnShopify).toHaveLength(0);
      expect(r.shopifyChecked).toBe(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('flags when the Bricqer item is gone (404)', async () => {
      fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
      getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });
      getInventoryItem.mockRejectedValue(new Error('404 Not Found'));

      const r = await withShopify().reconcile();

      expect(r.unbackedOnShopify).toHaveLength(1);
      expect(r.unbackedOnShopify[0].detail).toMatch(/MISSING/);
    });

    it('ignores minifigs with no live Shopify product', async () => {
      fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
      getOffer.mockResolvedValue({ status: 'UNPUBLISHED', listing: { listingId: '1' } });
      // INV present but no product row => nothing on Shopify to worry about.
      const svc = new MinifigReconcilerService(supabaseStub(INV, []), 'user-1');

      const r = await svc.reconcile();

      expect(r.unbackedOnShopify).toHaveLength(0);
      expect(r.shopifyChecked).toBe(0);
    });

    it('still runs the Shopify pass when the eBay adapter is unavailable', async () => {
      // An eBay token failure must not blind the Shopify arm too.
      getAccessToken.mockResolvedValue(null);
      fetchAllRecords.mockResolvedValue([item({ listing_status: 'SOLD_BRICQER' })]);
      getInventoryItem.mockResolvedValue({ remainingQuantity: 0 });

      const r = await withShopify().reconcile();

      expect(r.errors.some((e) => e.item === 'ebay')).toBe(true);
      expect(r.unbackedOnShopify).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reads each Bricqer item once across both passes', async () => {
      fetchAllRecords.mockResolvedValue([item()]);
      getOffer.mockResolvedValue({ status: 'PUBLISHED', listing: { listingId: '1' } });
      getInventoryItem.mockResolvedValue({ remainingQuantity: 0 });

      const r = await withShopify().reconcile();

      expect(r.doubleSellRisks).toHaveLength(1);
      expect(r.unbackedOnShopify).toHaveLength(1);
      expect(getInventoryItem).toHaveBeenCalledTimes(1);
    });
  });
});
