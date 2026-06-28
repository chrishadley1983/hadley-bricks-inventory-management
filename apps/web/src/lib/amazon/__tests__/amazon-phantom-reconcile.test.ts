import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AmazonInventoryLinkingService,
  assignPhantomCandidates,
  type PhantomInStockUnit,
  type PhantomUncoveredOrder,
} from '../amazon-inventory-linking.service';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
const { sendSyncStatus } = vi.hoisted(() => ({ sendSyncStatus: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ discordService: { sendSyncStatus } }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// assignPhantomCandidates (pure detection logic)
// ---------------------------------------------------------------------------

const unit = (id: string, asin: string, listingDate: string | null): PhantomInStockUnit => ({
  id,
  sku: id,
  set_number: '123',
  item_name: 'Test Set',
  amazon_asin: asin,
  listing_date: listingDate,
  listing_value: 9.99,
});

const order = (date: string, short: number): PhantomUncoveredOrder => ({
  platformOrderId: `ord-${date}`,
  orderDate: `${date}T12:00:00Z`,
  short,
  perUnit: 9.99,
});

describe('assignPhantomCandidates', () => {
  it('flags a unit listed before an uncovered sale', () => {
    const inStock = new Map([['A', [unit('u1', 'A', '2026-01-01')]]]);
    const uncovered = new Map([['A', [order('2026-02-01', 1)]]]);
    const out = assignPhantomCandidates(inStock, uncovered);
    expect(out).toHaveLength(1);
    expect(out[0].unit.id).toBe('u1');
  });

  it('does NOT flag a unit listed AFTER the sale (chronology guard)', () => {
    const inStock = new Map([['A', [unit('u1', 'A', '2026-03-01')]]]);
    const uncovered = new Map([['A', [order('2026-02-01', 1)]]]);
    expect(assignPhantomCandidates(inStock, uncovered)).toHaveLength(0);
  });

  it('caps flagged units at the number of uncovered slots (no over-flag)', () => {
    const inStock = new Map([
      [
        'A',
        [unit('u1', 'A', '2026-01-01'), unit('u2', 'A', '2026-01-02'), unit('u3', 'A', '2026-01-03')],
      ],
    ]);
    const uncovered = new Map([['A', [order('2026-02-01', 1)]]]); // only ONE missing
    const out = assignPhantomCandidates(inStock, uncovered);
    expect(out).toHaveLength(1);
    expect(out[0].unit.id).toBe('u1'); // FIFO: oldest-listed
  });

  it('matches qty-N uncovered orders to N units', () => {
    const inStock = new Map([
      ['A', [unit('u1', 'A', '2026-01-01'), unit('u2', 'A', '2026-01-02')]],
    ]);
    const uncovered = new Map([['A', [order('2026-02-01', 2)]]]);
    expect(assignPhantomCandidates(inStock, uncovered)).toHaveLength(2);
  });

  it('returns nothing when the ASIN has no in-stock units', () => {
    const inStock = new Map<string, PhantomInStockUnit[]>();
    const uncovered = new Map([['A', [order('2026-02-01', 1)]]]);
    expect(assignPhantomCandidates(inStock, uncovered)).toHaveLength(0);
  });

  it('only assigns the chronologically-eligible subset', () => {
    // 2 uncovered slots, but only 1 unit listed before the sale → 1 flagged.
    const inStock = new Map([
      ['A', [unit('u1', 'A', '2026-01-01'), unit('u2', 'A', '2026-12-01')]],
    ]);
    const uncovered = new Map([['A', [order('2026-02-01', 2)]]]);
    const out = assignPhantomCandidates(inStock, uncovered);
    expect(out).toHaveLength(1);
    expect(out[0].unit.id).toBe('u1');
  });
});

// ---------------------------------------------------------------------------
// matchOrderItemToInventory — picklist claimability guard (double-link fix)
// ---------------------------------------------------------------------------

describe('matchOrderItemToInventory picklist claimability guard', () => {
  const userId = 'user-1';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mock: Record<string, any>;
  let service: AmazonInventoryLinkingService;

  function chainable(finalValue: unknown = { data: null, error: null }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m: Record<string, any> = {};
    for (const fn of ['select', 'eq', 'neq', 'is', 'not', 'in', 'ilike', 'order', 'limit', 'range']) {
      m[fn] = vi.fn().mockReturnValue(m);
    }
    m.single = vi.fn().mockResolvedValue(finalValue);
    m.then = (resolve: (v: unknown) => void) => {
      resolve(finalValue);
      return Promise.resolve(finalValue);
    };
    return m;
  }

  const orderItem = {
    id: 'oi-1',
    order_id: 'ord-1',
    item_number: 'ASIN1',
    item_name: 'Test',
    quantity: 1,
    total_price: 9.99,
    unit_price: 9.99,
    inventory_item_id: 'unit-1',
    amazon_linked_at: null,
  };
  const order = {
    id: 'po-uuid-1',
    user_id: userId,
    platform: 'amazon',
    platform_order_id: '111-2222222-3333333',
    order_date: '2026-02-01T10:00:00Z',
    status: 'Shipped',
    internal_status: null,
    inventory_link_status: null,
    fulfilled_at: null,
    shipped_at: null,
    total: 9.99,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mock = chainable();
    service = new AmazonInventoryLinkingService(
      { from: vi.fn(() => mock) } as never,
      userId
    );
  });

  it('does NOT auto-accept a pre-link to a unit already SOLD to a different order', async () => {
    mock.single.mockResolvedValueOnce({
      data: { id: 'unit-1', amazon_asin: 'ASIN1', set_number: '123', status: 'SOLD', sold_order_id: '999-8888888-7777777' },
      error: null,
    });
    const result = await service.matchOrderItemToInventory(orderItem, order, 'picklist');
    // Guard rejected the stale pre-link → fell through to ASIN match (none) → not picklist.
    expect(result.method).not.toBe('auto_picklist');
    expect(result.status).toBe('unmatched');
  });

  it('idempotently accepts a pre-link to a unit already SOLD to THIS order', async () => {
    mock.single.mockResolvedValueOnce({
      data: { id: 'unit-1', amazon_asin: 'ASIN1', set_number: '123', status: 'SOLD', sold_order_id: '111-2222222-3333333' },
      error: null,
    });
    const result = await service.matchOrderItemToInventory(orderItem, order, 'picklist');
    expect(result.status).toBe('matched');
    expect(result.method).toBe('auto_picklist');
    expect(result.inventoryIds).toEqual(['unit-1']);
  });

  it('accepts a pre-link to an available LISTED unit (happy path)', async () => {
    mock.single.mockResolvedValueOnce({
      data: { id: 'unit-1', amazon_asin: 'ASIN1', set_number: '123', status: 'LISTED', sold_order_id: null },
      error: null,
    });
    const result = await service.matchOrderItemToInventory(orderItem, order, 'picklist');
    expect(result.status).toBe('matched');
    expect(result.method).toBe('auto_picklist');
  });
});

// ---------------------------------------------------------------------------
// reconcilePhantomStock — self-covering detection (LISTED + own sold_order_id)
// ---------------------------------------------------------------------------

describe('reconcilePhantomStock self-covering detection', () => {
  // A queue-based supabase mock: each awaited query shifts the next response.
  function queueSupabase(responses: Array<{ data: unknown; error: unknown }>) {
    let i = 0;
    const next = () => responses[i++] ?? { data: [], error: null };
    const builder = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: Record<string, any> = {};
      for (const fn of ['select', 'eq', 'neq', 'is', 'not', 'in', 'ilike', 'order', 'limit', 'range', 'gt']) {
        b[fn] = () => b;
      }
      b.single = () => Promise.resolve(next());
      b.then = (res: (v: unknown) => void) => {
        const v = next();
        res(v);
        return Promise.resolve(v);
      };
      return b;
    };
    return { from: () => builder() };
  }

  beforeEach(() => {
    sendSyncStatus.mockReset();
    sendSyncStatus.mockResolvedValue({ ok: true });
  });

  it('flags a LISTED unit that still carries its own sold_order_id, and alerts', async () => {
    const supabase = queueSupabase([
      { data: [], error: null }, // refunded-orders fetch (none)
      { data: [{ id: 'u1', sku: 'N3248', set_number: '76068', item_name: 'X', amazon_asin: 'B01', listing_date: '2026-02-22', listing_value: 37.49, sold_order_id: '203-5271308-6319545' }], error: null }, // self-covering candidates
      { data: [], error: null }, // platform_orders cancelled-check (none cancelled)
      { data: [], error: null }, // in-stock fetch (empty) -> early return
    ]);
    const service = new AmazonInventoryLinkingService(supabase as never, 'u');
    const result = await service.reconcilePhantomStock();
    expect(result.selfCovering).toHaveLength(1);
    expect(result.selfCovering[0].sku).toBe('N3248');
    expect(result.phantoms).toHaveLength(0);
    expect(result.alerted).toBe(true);
    expect(sendSyncStatus).toHaveBeenCalledTimes(1);
  });

  it('does NOT flag a self-covering unit whose order was Cancelled', async () => {
    const supabase = queueSupabase([
      { data: [], error: null }, // refunded-orders fetch (none)
      { data: [{ id: 'u1', sku: 'N9', set_number: '1', item_name: 'X', amazon_asin: 'B01', listing_date: '2026-02-22', listing_value: 9.99, sold_order_id: '111-2222222-3333333' }], error: null },
      { data: [{ platform_order_id: '111-2222222-3333333', internal_status: 'Cancelled' }], error: null }, // order cancelled
      { data: [], error: null }, // in-stock empty
    ]);
    const service = new AmazonInventoryLinkingService(supabase as never, 'u');
    const result = await service.reconcilePhantomStock();
    expect(result.selfCovering).toHaveLength(0);
    expect(result.alerted).toBe(false);
    expect(sendSyncStatus).not.toHaveBeenCalled();
  });

  it('does NOT flag a self-covering unit whose order was Refunded (a return)', async () => {
    const supabase = queueSupabase([
      { data: [{ amazon_order_id: '203-5271308-6319545' }], error: null }, // refunded-orders fetch
      { data: [], error: null }, // platform_orders UUID-map for refunded order (none)
      { data: [{ id: 'u1', sku: 'N3248', set_number: '76068', item_name: 'X', amazon_asin: 'B01', listing_date: '2026-02-22', listing_value: 37.49, sold_order_id: '203-5271308-6319545' }], error: null }, // self-covering candidate — but refunded
      { data: [], error: null }, // cancelled-check
      { data: [], error: null }, // in-stock empty
    ]);
    const service = new AmazonInventoryLinkingService(supabase as never, 'u');
    const result = await service.reconcilePhantomStock();
    expect(result.selfCovering).toHaveLength(0); // refunded order -> legitimate re-list, not a phantom
    expect(result.alerted).toBe(false);
    expect(sendSyncStatus).not.toHaveBeenCalled();
  });
});
