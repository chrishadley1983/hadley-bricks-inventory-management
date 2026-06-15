/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// dedupeBySku pulls tracked mappings via fetchAllRecords — mock it.
vi.mock('@/lib/supabase/pagination', () => ({
  fetchAllRecords: vi.fn(),
}));

import { fetchAllRecords } from '@/lib/supabase/pagination';
import { ShopifySyncService } from '../sync.service';

const USER_ID = 'user-1';

/** Minimal chainable Supabase mock: select().eq().in() resolves to {data}; upsert() captured. */
function makeSupabase(candidateMaps: any[]) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn(() => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => Promise.resolve({ data: candidateMaps, error: null })),
      upsert,
    };
    return builder;
  });
  return { supabase: { from } as any, upsert };
}

const BUILT = {
  title: 'T',
  description: 'D',
  tags: 't',
  price: 9.99,
  compareAt: null as number | null,
  imageSource: 'ebay',
  imageUrls: [] as string[],
};

describe('ShopifySyncService.adoptExistingBySku', () => {
  it('refuses to adopt a product mapped to a DIFFERENT inventory item (no false-merge)', async () => {
    const { supabase } = makeSupabase([{ shopify_product_id: 'P1', inventory_item_id: 'OTHER_ITEM' }]);
    const client: any = {
      findProductsBySku: vi
        .fn()
        .mockResolvedValue([
          { productId: 'P1', status: 'ACTIVE', variantId: 'V1', inventoryItemId: 'INV1', inventoryQuantity: 1 },
        ]),
      updateProduct: vi.fn().mockResolvedValue({}),
      updateVariant: vi.fn().mockResolvedValue({}),
      setInventoryLevel: vi.fn().mockResolvedValue({}),
    };
    const svc = new ShopifySyncService(supabase, USER_ID);
    const result = await (svc as any).adoptExistingBySku(
      client,
      { location_id: 'LOC' },
      ['ITEM_A'],
      'SKU1',
      1,
      BUILT
    );
    expect(result).toBeNull(); // falls through to create
    expect(client.updateProduct).not.toHaveBeenCalled();
  });

  it('adopts a genuinely ORPHANED product and CLEARS a stale compare_at_price', async () => {
    const { supabase, upsert } = makeSupabase([]); // no mapping → orphan
    const client: any = {
      findProductsBySku: vi
        .fn()
        .mockResolvedValue([
          { productId: 'P2', status: 'ARCHIVED', variantId: 'V2', inventoryItemId: 'INV2', inventoryQuantity: 0 },
        ]),
      updateProduct: vi.fn().mockResolvedValue({}),
      updateVariant: vi.fn().mockResolvedValue({}),
      setInventoryLevel: vi.fn().mockResolvedValue({}),
    };
    const svc = new ShopifySyncService(supabase, USER_ID);
    const result = await (svc as any).adoptExistingBySku(
      client,
      { location_id: 'LOC' },
      ['ITEM_A'],
      'SKU2',
      1,
      { ...BUILT, compareAt: null }
    );

    expect(result).toMatchObject({ success: true, adopted: true, shopifyProductId: 'P2' });
    expect(client.updateProduct).toHaveBeenCalledWith('P2', expect.objectContaining({ status: 'active' }));
    // null compareAt must be sent as '' to actively clear any stale strike-through
    expect(client.updateVariant).toHaveBeenCalledWith('V2', expect.objectContaining({ compare_at_price: '' }));
    expect(client.setInventoryLevel).toHaveBeenCalledWith('INV2', 'LOC', 1);
    expect(upsert).toHaveBeenCalled();
  });

  it('adopts a product already mapped to ONE OF the pushed items (re-LISTED same item)', async () => {
    const { supabase } = makeSupabase([{ shopify_product_id: 'P3', inventory_item_id: 'ITEM_A' }]);
    const client: any = {
      findProductsBySku: vi
        .fn()
        .mockResolvedValue([
          { productId: 'P3', status: 'ARCHIVED', variantId: 'V3', inventoryItemId: 'INV3', inventoryQuantity: 0 },
        ]),
      updateProduct: vi.fn().mockResolvedValue({}),
      updateVariant: vi.fn().mockResolvedValue({}),
      setInventoryLevel: vi.fn().mockResolvedValue({}),
    };
    const svc = new ShopifySyncService(supabase, USER_ID);
    const result = await (svc as any).adoptExistingBySku(
      client,
      { location_id: 'LOC' },
      ['ITEM_A'],
      'SKU3',
      1,
      BUILT
    );
    expect(result).toMatchObject({ success: true, adopted: true, shopifyProductId: 'P3' });
  });
});

describe('ShopifySyncService.dedupeBySku', () => {
  beforeEach(() => vi.clearAllMocks());

  function svcWithProducts(products: any[], trackedIds: string[]) {
    (fetchAllRecords as any).mockResolvedValue(trackedIds.map((id) => ({ shopify_product_id: id })));
    const client: any = {
      getProducts: vi.fn().mockResolvedValue(products),
      archiveProduct: vi.fn().mockResolvedValue({}),
    };
    const svc = new ShopifySyncService({} as any, USER_ID);
    (svc as any).client = client; // getClient() returns the cached client, skips config load
    return { svc, client };
  }

  it('archives the untracked orphan and keeps the tracked product', async () => {
    const { svc, client } = svcWithProducts(
      [
        { id: 'TRACKED', status: 'active', variants: [{ sku: 'S1', inventory_quantity: 1 }] },
        { id: 'ORPHAN', status: 'active', variants: [{ sku: 'S1', inventory_quantity: 0 }] },
      ],
      ['TRACKED']
    );
    const summary = await svc.dedupeBySku();
    expect(summary.duplicate_skus).toBe(1);
    expect(summary.archived).toBe(1);
    expect(client.archiveProduct).toHaveBeenCalledTimes(1);
    expect(client.archiveProduct).toHaveBeenCalledWith('ORPHAN');
  });

  it('keeps a tracked-but-archived product and archives the untracked active orphan (inverted case)', async () => {
    const { svc, client } = svcWithProducts(
      [
        { id: 'TRACKED', status: 'archived', variants: [{ sku: 'S2', inventory_quantity: 1 }] },
        { id: 'ORPHAN', status: 'active', variants: [{ sku: 'S2', inventory_quantity: 0 }] },
      ],
      ['TRACKED']
    );
    const summary = await svc.dedupeBySku();
    expect(summary.archived).toBe(1);
    expect(client.archiveProduct).toHaveBeenCalledWith('ORPHAN');
    expect(client.archiveProduct).not.toHaveBeenCalledWith('TRACKED');
  });

  it('never archives a tracked product even when both in the group are tracked', async () => {
    const { svc, client } = svcWithProducts(
      [
        { id: 'T1', status: 'active', variants: [{ sku: 'S3', inventory_quantity: 1 }] },
        { id: 'T2', status: 'active', variants: [{ sku: 'S3', inventory_quantity: 1 }] },
      ],
      ['T1', 'T2']
    );
    const summary = await svc.dedupeBySku();
    expect(summary.archived).toBe(0);
    expect(client.archiveProduct).not.toHaveBeenCalled();
  });
});
