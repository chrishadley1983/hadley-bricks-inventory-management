/**
 * Tests for POST /api/cron/minifigs/process-removals — the inventory write.
 *
 * A Bricqer sale has no inventory writer of its own (eBay/Amazon/Shopify sales
 * reach order-fulfilment; BrickLink/Brick Owl have no inventory-linking service),
 * so the fig's inventory_items row stayed 'LISTED'. LISTED is what makes an item
 * Shopify-eligible, so the adopt-by-sku path re-published sold figs on every
 * full-sync — 11 archived products came back within 75 minutes on 2026-07-26.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/cron-auth', () => ({ verifyCronAuth: () => null }));

const inventoryUpdate = vi.fn();
/** eq() filters belonging ONLY to the chain on which update() was called —
 *  the same table is also read further down for the Shopify archive lookup. */
let updateEqs: Array<[string, unknown]> = [];

const removalRow = {
  id: 'removal-1',
  minifig_sync_id: 'sync-1',
  sold_on: 'BRICQER',
  remove_from: 'EBAY',
  sale_date: '2026-07-24T21:07:39Z',
  minifig_sync_items: {
    name: 'Gollum - Narrow Eyes',
    bricklink_id: 'lor031',
    bricqer_item_id: '8652',
    ebay_sku: 'HB-MF-8652-U-FIG-8',
    ebay_offer_id: null, // no offer => eBay teardown trivially satisfied
  },
};

let removals = [removalRow];

function chainFor(table: string) {
  if (table === 'inventory_items') {
    const chain: Record<string, unknown> = {};
    const eqs: Array<[string, unknown]> = [];
    let isUpdate = false;
    chain.update = (patch: unknown) => {
      isUpdate = true;
      inventoryUpdate(patch);
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      eqs.push([col, val]);
      if (isUpdate) updateEqs = eqs;
      return chain;
    };
    // terminal await
    (chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ error: null });
    chain.select = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => ({ data: null });
    return chain;
  }

  const generic: Record<string, unknown> = {};
  generic.select = () => generic;
  generic.update = () => generic;
  generic.eq = () => generic;
  generic.limit = async () => ({ data: removals, error: null });
  (generic as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: null, error: null });
  return generic;
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({ from: (t: string) => chainFor(t) }),
}));

vi.mock('@/lib/ebay/ebay-auth.service', () => ({
  EbayAuthService: class {
    getAccessToken = vi.fn().mockResolvedValue('token');
  },
}));
vi.mock('@/lib/ebay/ebay-api.adapter', () => ({ EbayApiAdapter: class {} }));
vi.mock('@/lib/bricqer/client', () => ({ BricqerClient: class {} }));
vi.mock('@/lib/repositories/credentials.repository', () => ({
  CredentialsRepository: class {
    getCredentials = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock('@/lib/shopify/archive-on-sold', () => ({ archiveShopifyOnSold: vi.fn() }));
vi.mock('@/lib/notifications', () => ({
  discordService: { sendSyncStatus: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/services/job-execution.service', () => ({
  noopHandle: { complete: vi.fn(), fail: vi.fn() },
  jobExecutionService: {
    start: vi.fn().mockResolvedValue({ complete: vi.fn(), fail: vi.fn() }),
  },
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST } from '../cron/minifigs/process-removals/route';

const req = () => new NextRequest('http://localhost/api/cron/minifigs/process-removals', { method: 'POST' });

describe('process-removals — inventory status write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateEqs = [];
    removals = [{ ...removalRow }];
  });

  it('marks the inventory row SOLD when a minifig sells on Bricqer', async () => {
    await POST(req());

    expect(inventoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SOLD', sold_date: '2026-07-24T21:07:39Z' })
    );
    // Matched on the unique per-unit SKU, never on set_number.
    expect(updateEqs).toContainEqual(['sku', 'HB-MF-8652-U-FIG-8']);
    expect(updateEqs.some(([c]) => c === 'set_number')).toBe(false);
    // Only flips a row that is still LISTED.
    expect(updateEqs).toContainEqual(['status', 'LISTED']);
  });

  it('never sets sold_platform (bricqer is not a valid channel)', async () => {
    await POST(req());
    const patch = inventoryUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('sold_platform');
  });

  it('does NOT touch inventory for an eBay sale — order-fulfilment owns that', async () => {
    removals = [{ ...removalRow, sold_on: 'EBAY', remove_from: 'BRICQER' }];
    await POST(req());
    expect(inventoryUpdate).not.toHaveBeenCalled();
  });

  it('does NOT touch inventory for a Shopify sale — the order sync owns that', async () => {
    removals = [{ ...removalRow, sold_on: 'SHOPIFY', remove_from: 'BRICQER' }];
    await POST(req());
    expect(inventoryUpdate).not.toHaveBeenCalled();
  });

  it('skips the write when the sync item has no SKU to match on', async () => {
    removals = [
      {
        ...removalRow,
        minifig_sync_items: { ...removalRow.minifig_sync_items, ebay_sku: null },
      } as never,
    ];
    await POST(req());
    expect(inventoryUpdate).not.toHaveBeenCalled();
  });
});
