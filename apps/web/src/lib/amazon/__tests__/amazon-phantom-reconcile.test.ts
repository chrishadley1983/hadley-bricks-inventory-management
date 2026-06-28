import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AmazonInventoryLinkingService,
  assignPhantomCandidates,
  type PhantomInStockUnit,
  type PhantomUncoveredOrder,
} from '../amazon-inventory-linking.service';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
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
