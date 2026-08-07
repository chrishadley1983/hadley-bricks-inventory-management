/**
 * Tests for GET /api/picking-list/shopify
 *
 * Shopify orders have no order_items rows (line items live in raw_data) and the
 * order sync marks matched stock SOLD at ingestion, moving the storage location
 * into archive_location. The route recovers pick locations through three tiers:
 *  1. Inventory the sync resolved for the order (location parsed from archive_location)
 *  2. LISTED inventory matched by base SKU (for lines the sync missed)
 *  3. The location hint embedded in a composite "SKU | location" variant SKU
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock('@/lib/api/validate-auth', () => ({
  validateAuth: vi.fn(),
}));

// Suppress console noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { GET } from '../route';

const USER_ID = 'test-user-id';

type QueryResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Builds a chain-aware Supabase mock. `queues[table]` is consumed FIFO — one entry per
 * `.from(table)` call — so multiple queries against the same table return results in order.
 */
function createSupabaseMock(queues: Record<string, QueryResult[]>, calls: RecordedCall[]) {
  const chainMethods = [
    'select', 'eq', 'in', 'is', 'ilike', 'neq', 'not', 'order',
    'update', 'insert', 'delete', 'lt', 'gte', 'lte', 'gt',
  ];

  return {
    from: vi.fn((table: string) => {
      const queue = queues[table] || [];
      const result: QueryResult = queue.length ? queue.shift()! : { data: [], error: null };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const m of chainMethods) {
        builder[m] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return builder;
        });
      }
      builder.single = vi.fn(() => Promise.resolve(result));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return builder;
    }),
  };
}

function shopifyOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PO_1',
    platform_order_id: '8373317501194',
    buyer_name: 'Jo Bloggs',
    order_date: '2026-08-05T12:29:56Z',
    status: 'paid',
    raw_data: {
      id: 8373317501194,
      name: '#1011',
      line_items: [
        {
          id: 1,
          sku: 'N3159',
          title: 'LEGO Advent Calendar 43273',
          quantity: 1,
          price: '30.00',
        },
      ],
    },
    ...overrides,
  };
}

describe('GET /api/picking-list/shopify', () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    vi.mocked(validateAuth).mockResolvedValue({ userId: USER_ID });
    // Snapshot writes go through the service-role client (fire-and-forget).
    vi.mocked(createServiceRoleClient).mockReturnValue(createSupabaseMock({}, []) as never);
  });

  function setupMainClient(queues: Record<string, QueryResult[]>) {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock(queues, calls) as never);
  }

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(validateAuth).mockResolvedValue(null);
    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('excludes Completed orders in the query and refunded orders client-side', async () => {
    setupMainClient({
      platform_orders: [
        {
          data: [
            shopifyOrderRow(),
            shopifyOrderRow({ id: 'PO_2', platform_order_id: '2', status: 'refunded' }),
          ],
          error: null,
        },
      ],
      inventory_items: [
        { data: [], error: null }, // sold items
        { data: [], error: null }, // listed fallback
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(200);

    // Query filters out Completed at source
    expect(
      calls.some(
        (c) =>
          c.table === 'platform_orders' &&
          c.method === 'neq' &&
          c.args[0] === 'status' &&
          c.args[1] === 'Completed'
      )
    ).toBe(true);

    // The refunded order is dropped: only PO_1 counted
    const json = await response.json();
    expect(json.data.totalOrders).toBe(1);
  });

  it('tier 1: recovers the pick location from archive_location of the sync-resolved item', async () => {
    setupMainClient({
      platform_orders: [{ data: [shopifyOrderRow()], error: null }],
      inventory_items: [
        {
          data: [
            {
              id: 'INV1',
              sku: 'N3159',
              set_number: '43273',
              item_name: 'Advent Calendar',
              storage_location: null,
              archive_location: 'SOLD-20260805-Loft - S72 (shopify #1011)',
              sold_order_id: '8373317501194',
            },
          ],
          error: null,
        },
        { data: [], error: null }, // listed fallback
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data.items).toHaveLength(1);
    const item = json.data.items[0];
    expect(item.matchStatus).toBe('matched');
    expect(item.location).toBe('Loft - S72');
    expect(item.setNo).toBe('43273');
    expect(item.orderName).toBe('#1011');
    expect(json.data.unmatchedItems).toHaveLength(0);
    expect(json.data.unknownLocationItems).toHaveLength(0);
  });

  it('tier 2: matches a composite "SKU | location" line to LISTED stock by base SKU', async () => {
    setupMainClient({
      platform_orders: [
        {
          data: [
            shopifyOrderRow({
              raw_data: {
                id: 8373317501194,
                name: '#1011',
                line_items: [
                  {
                    id: 1,
                    sku: 'N3159 | Loft - S72 + Loft - S75',
                    title: 'LEGO Advent Calendar 43273',
                    quantity: 1,
                    price: '30.00',
                  },
                ],
              },
            }),
          ],
          error: null,
        },
      ],
      inventory_items: [
        { data: [], error: null }, // sync resolved nothing (composite SKU defeated it)
        {
          data: [
            {
              id: 'INV1',
              sku: 'N3159',
              set_number: '43273',
              item_name: 'Advent Calendar',
              storage_location: 'Loft - S72',
              archive_location: null,
              sold_order_id: null,
            },
          ],
          error: null,
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data.items).toHaveLength(1);
    const item = json.data.items[0];
    expect(item.matchStatus).toBe('matched');
    expect(item.location).toBe('Loft - S72');
    expect(item.setNo).toBe('43273');
    expect(item.sku).toBe('N3159');
    expect(json.data.unmatchedItems).toHaveLength(0);

    // The LISTED fallback query must use the base SKU
    expect(
      calls.some(
        (c) =>
          c.table === 'inventory_items' &&
          c.method === 'in' &&
          c.args[0] === 'sku' &&
          Array.isArray(c.args[1]) &&
          (c.args[1] as string[]).includes('N3159')
      )
    ).toBe(true);
  });

  it('tier 3: falls back to the SKU-embedded location hint when nothing matches', async () => {
    setupMainClient({
      platform_orders: [
        {
          data: [
            shopifyOrderRow({
              raw_data: {
                id: 8373317501194,
                name: '#1011',
                line_items: [
                  {
                    id: 1,
                    sku: 'N3159 | Loft - S72 + Loft - S75',
                    title: 'LEGO Advent Calendar 43273',
                    quantity: 1,
                    price: '30.00',
                  },
                ],
              },
            }),
          ],
          error: null,
        },
      ],
      inventory_items: [
        { data: [], error: null }, // no sold items
        { data: [], error: null }, // no listed stock either
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data.items).toHaveLength(1);
    const item = json.data.items[0];
    expect(item.matchStatus).toBe('unmatched');
    expect(item.location).toBe('Loft - S72 + Loft - S75');
    expect(json.data.unmatchedItems).toHaveLength(1);
  });

  it('nets refunded units off a line and skips fully-refunded lines', async () => {
    setupMainClient({
      platform_orders: [
        {
          data: [
            shopifyOrderRow({
              raw_data: {
                id: 8373317501194,
                name: '#1011',
                line_items: [
                  { id: 1, sku: 'N3159', title: 'Refunded item', quantity: 1, price: '30.00' },
                  { id: 2, sku: 'N9999', title: 'Live item', quantity: 1, price: '10.00' },
                ],
                refunds: [{ refund_line_items: [{ line_item_id: 1, quantity: 1 }] }],
              },
            }),
          ],
          error: null,
        },
      ],
      inventory_items: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/shopify');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.items[0].itemName).toBe('Live item');
  });
});
