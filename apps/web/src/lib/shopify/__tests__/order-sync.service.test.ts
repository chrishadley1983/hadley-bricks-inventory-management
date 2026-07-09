/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  archiveShopifyOnSold: vi.fn(),
  endListingForInventoryItem: vi.fn(),
  endListing: vi.fn(),
  sendSyncStatus: vi.fn(),
}));

vi.mock('../client', () => ({
  ShopifyClient: vi.fn(function () {
    return { getOrders: mocks.getOrders };
  }),
}));
vi.mock('../archive-on-sold', () => ({ archiveShopifyOnSold: mocks.archiveShopifyOnSold }));
vi.mock('@/lib/ebay/ebay-delisting.service', () => ({
  EbayDelistingService: vi.fn(function () {
    return {
      endListingForInventoryItem: mocks.endListingForInventoryItem,
      endListing: mocks.endListing,
    };
  }),
}));
vi.mock('@/lib/notifications', () => ({ discordService: { sendSyncStatus: mocks.sendSyncStatus } }));

import { ShopifyOrderSyncService } from '../order-sync.service';

/** A self-returning thenable that mimics the Supabase query builder. */
function selfThenable(result: any) {
  const t: any = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'order', 'limit', 'not']) {
    t[m] = vi.fn(() => t);
  }
  t.single = vi.fn(() => Promise.resolve(result));
  t.maybeSingle = vi.fn(() => Promise.resolve(result));
  t.then = (onF: any, onR: any) => Promise.resolve(result).then(onF, onR);
  return t;
}

function createSupabase(cfg: Record<string, any>) {
  const captured: { updates: any[]; upserts: any[]; inserts: any[] } = {
    updates: [],
    upserts: [],
    inserts: [],
  };
  const sb: any = {
    from: (table: string) => ({
      select: () => selfThenable(cfg[`${table}:select`] ?? { data: [], error: null }),
      update: (payload: any) => {
        captured.updates.push({ table, payload });
        return selfThenable(cfg[`${table}:update`] ?? { error: null });
      },
      upsert: (payload: any, opts: any) => {
        captured.upserts.push({ table, payload, opts });
        return selfThenable(cfg[`${table}:upsert`] ?? { error: null });
      },
      insert: (payload: any) => {
        captured.inserts.push({ table, payload });
        return selfThenable(cfg[`${table}:insert`] ?? { error: null });
      },
      delete: () => selfThenable(cfg[`${table}:delete`] ?? { error: null }),
    }),
  };
  sb._captured = captured;
  return sb;
}

const CONFIG_ROW = {
  user_id: 'u',
  sync_enabled: true,
  location_id: 'loc1',
  last_order_sync_at: null,
};

function makeOrder(overrides: any = {}) {
  return {
    id: 5001,
    name: '#1001',
    created_at: '2026-06-10T10:00:00Z',
    updated_at: '2026-06-10T10:00:00Z',
    cancelled_at: null,
    financial_status: 'paid',
    currency: 'GBP',
    total_price: '14.99',
    subtotal_price: '12.00',
    total_shipping_price_set: { shop_money: { amount: '2.99' } },
    email: 'b@example.com',
    customer: { first_name: 'Jo', last_name: 'Bloggs' },
    line_items: [{ id: 1, sku: 'N1', product_id: 1, variant_id: 1, quantity: 1, price: '12.00', title: 'LEGO Thing' }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getOrders.mockReset();
  mocks.archiveShopifyOnSold.mockReset().mockResolvedValue(undefined);
  mocks.endListingForInventoryItem.mockReset().mockResolvedValue({ found: true, ended: true, ebayItemId: 'E1' });
  mocks.endListing.mockReset().mockResolvedValue({ success: true, ebayItemId: 'E1' });
  mocks.sendSyncStatus.mockReset().mockResolvedValue(undefined);
});

describe('ShopifyOrderSyncService.syncOrders', () => {
  it('marks a matched LISTED item sold, archives Shopify, and ends eBay', async () => {
    mocks.getOrders.mockResolvedValue([makeOrder()]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: 'Garage - A' }],
        error: null,
      },
      'shopify_products:select': { data: { id: 'map1' }, error: null },
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();

    expect(res.success).toBe(true);
    expect(res.ordersIngested).toBe(1);
    expect(res.itemsMarkedSold).toBe(1);
    expect(res.ebayListingsEnded).toBe(1);
    expect(res.shopifyProductsArchived).toBe(1);
    expect(res.unmatchedLineItems).toBe(0);

    // archive + delist called for the matched item
    expect(mocks.archiveShopifyOnSold).toHaveBeenCalledWith(supabase, 'u', 'inv1');
    expect(mocks.endListingForInventoryItem).toHaveBeenCalledWith('u', { id: 'inv1', sku: 'N1' });

    // mark-sold payload is correct (price + allocated postage)
    const soldUpdate = supabase._captured.updates.find(
      (u: any) => u.table === 'inventory_items' && u.payload.status === 'SOLD'
    );
    expect(soldUpdate.payload.sold_platform).toBe('shopify');
    expect(soldUpdate.payload.sold_price).toBe(12);
    expect(soldUpdate.payload.sold_postage_received).toBe(2.99);
    expect(soldUpdate.payload.sold_gross_amount).toBe(14.99);
    expect(soldUpdate.payload.sold_order_id).toBe('5001');
    expect(soldUpdate.payload.storage_location).toBeNull();

    // order recorded + cursor advanced
    expect(supabase._captured.upserts.some((u: any) => u.table === 'platform_orders')).toBe(true);
    expect(supabase._captured.updates.some((u: any) => u.table === 'shopify_config')).toBe(true);
  });

  it('records fulfilled orders as Completed, unfulfilled as their financial status', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({ id: 5001, fulfillment_status: 'fulfilled' }),
      makeOrder({ id: 5002, fulfillment_status: null }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': { data: [], error: null },
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    await svc.syncOrders();

    const orderUpserts = supabase._captured.upserts.filter(
      (u: any) => u.table === 'platform_orders'
    );
    expect(orderUpserts).toHaveLength(2);
    const byId = Object.fromEntries(orderUpserts.map((u: any) => [u.payload.platform_order_id, u.payload]));
    expect(byId['5001'].status).toBe('Completed');
    expect(byId['5002'].status).toBe('paid');
  });

  it('is idempotent — a line for an already-sold item is unmatched, not re-marked', async () => {
    mocks.getOrders.mockResolvedValue([makeOrder()]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': { data: [], error: null }, // nothing LISTED for the SKU
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();

    expect(res.itemsMarkedSold).toBe(0);
    expect(res.unmatchedLineItems).toBe(1);
    expect(mocks.archiveShopifyOnSold).not.toHaveBeenCalled();
    expect(mocks.endListingForInventoryItem).not.toHaveBeenCalled();
    // order is still recorded
    expect(supabase._captured.upserts.some((u: any) => u.table === 'platform_orders')).toBe(true);
  });

  it('skips cancelled orders', async () => {
    mocks.getOrders.mockResolvedValue([makeOrder({ cancelled_at: '2026-06-11T00:00:00Z' })]);
    const supabase = createSupabase({ 'shopify_config:select': { data: CONFIG_ROW, error: null } });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();
    expect(res.ordersIngested).toBe(0);
    expect(res.itemsMarkedSold).toBe(0);
  });

  it('does nothing when sync is disabled', async () => {
    const supabase = createSupabase({
      'shopify_config:select': { data: { ...CONFIG_ROW, sync_enabled: false }, error: null },
    });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();
    expect(res.success).toBe(true);
    expect(mocks.getOrders).not.toHaveBeenCalled();
  });

  it('nets line discounts off the recorded sold_price', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({
        total_shipping_price_set: { shop_money: { amount: '0.00' } },
        line_items: [
          {
            id: 1,
            sku: 'N1',
            quantity: 1,
            price: '12.00',
            title: 'Discounted',
            discount_allocations: [{ amount: '2.00' }],
          },
        ],
      }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: null }],
        error: null,
      },
      'shopify_products:select': { data: null, error: null },
    });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    await svc.syncOrders();
    const soldUpdate = supabase._captured.updates.find(
      (u: any) => u.table === 'inventory_items' && u.payload.status === 'SOLD'
    );
    expect(soldUpdate.payload.sold_price).toBe(10); // 12.00 - 2.00 discount
  });

  it('skips a fully-refunded line item', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({
        refunds: [{ refund_line_items: [{ line_item_id: 1, quantity: 1 }] }],
      }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: null }],
        error: null,
      },
    });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();
    expect(res.itemsMarkedSold).toBe(0);
    expect(mocks.archiveShopifyOnSold).not.toHaveBeenCalled();
  });

  it('flags an oversell when fewer LISTED units exist than ordered', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({ line_items: [{ id: 1, sku: 'N1', quantity: 3, price: '10.00', title: 'x' }] }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: null }],
        error: null,
      },
      'shopify_products:select': { data: null, error: null },
    });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();
    expect(res.itemsMarkedSold).toBe(1);
    expect(res.oversoldLineItems).toBe(1);
  });

  it('marks multiple units when a line has quantity > 1', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({
        line_items: [{ id: 1, sku: 'N1', quantity: 2, price: '10.00', title: 'Two units' }],
      }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [
          { id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: null },
          { id: 'inv2', sku: 'N1', created_at: '2026-01-02', storage_location: null },
        ],
        error: null,
      },
      'shopify_products:select': { data: null, error: null }, // no mapping
    });
    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();
    expect(res.itemsMarkedSold).toBe(2);
    expect(res.shopifyProductsArchived).toBe(0); // no mapping for either
    expect(mocks.archiveShopifyOnSold).toHaveBeenCalledTimes(2);
  });

  it('ends eBay inline + queues ONE Bricqer removal when a minifig-sync item sells on Shopify', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({
        id: 8261381292298,
        name: '#1003',
        total_shipping_price_set: { shop_money: { amount: '3.99' } },
        line_items: [
          { id: 1, sku: 'HB-MF-24893-U-309-1', quantity: 1, price: '4.49', title: 'LEGO Superman sh0300' },
        ],
      }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv-mf', sku: 'HB-MF-24893-U-309-1', created_at: '2026-01-01', storage_location: 'U-309-1' }],
        error: null,
      },
      'shopify_products:select': { data: null, error: null },
      // It IS a minifig-sync item, with a Bricqer presence + an eBay listing id.
      'minifig_sync_items:select': {
        data: { id: 'sync1', bricqer_item_id: '24893', ebay_listing_id: '177913124242' },
        error: null,
      },
      // No removal already queued for this sale.
      'minifig_removal_queue:select': { data: null, error: null },
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();

    expect(res.itemsMarkedSold).toBe(1);

    // eBay listing ended inline by its item id (it isn't in platform_listings).
    expect(mocks.endListing).toHaveBeenCalledWith('u', '177913124242');

    // Exactly ONE Bricqer removal queued (one row per (sync, order)).
    expect(res.minifigRemovalsQueued).toBe(1);
    const queued = supabase._captured.inserts.filter((i: any) => i.table === 'minifig_removal_queue');
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.sold_on).toBe('SHOPIFY');
    expect(queued[0].payload.remove_from).toBe('BRICQER');
    expect(queued[0].payload.status).toBe('PENDING');
    expect(queued[0].payload.minifig_sync_id).toBe('sync1');
    expect(queued[0].payload.order_id).toBe('8261381292298');

    // sync row marked sold so it isn't re-counted as live before the cron runs
    const syncUpdate = supabase._captured.updates.find(
      (uu: any) => uu.table === 'minifig_sync_items' && uu.payload.listing_status === 'SOLD_SHOPIFY'
    );
    expect(syncUpdate).toBeTruthy();
  });

  it('does not double-queue a Bricqer removal already in the queue (idempotent)', async () => {
    mocks.getOrders.mockResolvedValue([
      makeOrder({
        id: 8261381292298,
        line_items: [
          { id: 1, sku: 'HB-MF-24893-U-309-1', quantity: 1, price: '4.49', title: 'LEGO Superman sh0300' },
        ],
      }),
    ]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv-mf', sku: 'HB-MF-24893-U-309-1', created_at: '2026-01-01', storage_location: 'U-309-1' }],
        error: null,
      },
      'shopify_products:select': { data: null, error: null },
      'minifig_sync_items:select': {
        data: { id: 'sync1', bricqer_item_id: '24893', ebay_listing_id: '177913124242' },
        error: null,
      },
      // A removal row already exists for this (sync, order).
      'minifig_removal_queue:select': { data: { id: 'existing1' }, error: null },
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();

    expect(res.minifigRemovalsQueued).toBe(0);
    expect(supabase._captured.inserts.filter((i: any) => i.table === 'minifig_removal_queue')).toHaveLength(0);
  });

  it('does not queue minifig removals for a normal (non-minifig) set sale', async () => {
    mocks.getOrders.mockResolvedValue([makeOrder()]);
    const supabase = createSupabase({
      'shopify_config:select': { data: CONFIG_ROW, error: null },
      'inventory_items:select': {
        data: [{ id: 'inv1', sku: 'N1', created_at: '2026-01-01', storage_location: 'Garage - A' }],
        error: null,
      },
      'shopify_products:select': { data: { id: 'map1' }, error: null },
      // No minifig_sync_items row matches the SKU.
      'minifig_sync_items:select': { data: null, error: null },
    });

    const svc = new ShopifyOrderSyncService(supabase, 'u');
    const res = await svc.syncOrders();

    expect(res.itemsMarkedSold).toBe(1);
    expect(res.minifigRemovalsQueued).toBe(0);
    expect(supabase._captured.inserts.filter((i: any) => i.table === 'minifig_removal_queue')).toHaveLength(0);
  });
});
