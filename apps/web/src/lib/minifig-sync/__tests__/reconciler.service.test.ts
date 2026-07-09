/**
 * Tests for MinifigReconcilerService classification logic:
 *   - DOUBLE-SELL RISK: eBay offer PUBLISHED + Bricqer qty 0 (or item missing)
 *   - STALE LISTED:     DB listing_status PUBLISHED + offer not PUBLISHED
 *   - clean:            offer PUBLISHED + Bricqer qty >= 1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOffer, getInventoryItem, send, fetchAllRecords } = vi.hoisted(() => ({
  getOffer: vi.fn(),
  getInventoryItem: vi.fn(),
  send: vi.fn(),
  fetchAllRecords: vi.fn(),
}));

vi.mock('../../ebay/ebay-auth.service', () => ({
  EbayAuthService: class {
    getAccessToken = vi.fn().mockResolvedValue('test-token');
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

describe('MinifigReconcilerService', () => {
  let service: MinifigReconcilerService;

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ success: true });
    service = new MinifigReconcilerService({} as never, 'user-1');
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
});
