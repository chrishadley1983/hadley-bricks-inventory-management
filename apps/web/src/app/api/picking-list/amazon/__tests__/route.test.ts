/**
 * Tests for GET /api/picking-list/amazon
 *
 * Regression coverage for two bugs:
 *  1. Pending Amazon orders (awaiting payment verification) must NOT appear on the pick list.
 *  2. A stale order_items -> inventory link left behind by a Cancelled/Refunded order must NOT
 *     block the relisted stock from matching a new live order (it previously showed the live
 *     order as unmatched with no storage location).
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
const ASIN = 'B08G4M8J87';

type QueryResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Builds a chain-aware Supabase mock. `queues[table]` is consumed FIFO — one entry per
 * `.from(table)` call — so multiple queries against the same table return results in order.
 * Every chained call is recorded for assertions. The builder is both thenable (awaiting the
 * chain) and exposes `.single()`.
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

function liveOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ORDER_LIVE',
    platform_order_id: '202-1976401-1278728',
    buyer_name: 'Buyer',
    order_date: '2026-06-21T20:09:59Z',
    status: 'Paid',
    fulfilled_at: null,
    items: [
      {
        id: 'OI_LIVE',
        item_number: ASIN,
        item_name: 'LEGO City Holiday Camper Van 60283',
        quantity: 1,
        inventory_item_id: null,
      },
    ],
    ...overrides,
  };
}

function listedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'INV1',
    amazon_asin: ASIN,
    set_number: '60283',
    item_name: 'Holiday Camper Van',
    storage_location: 'Loft - S32',
    status: 'LISTED',
    listing_platform: 'amazon',
    created_at: '2026-03-13T11:07:13Z',
    ...overrides,
  };
}

describe('GET /api/picking-list/amazon', () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    vi.mocked(validateAuth).mockResolvedValue({ userId: USER_ID });
    // Snapshot writes go through the service-role client (fire-and-forget); a default mock is fine.
    vi.mocked(createServiceRoleClient).mockReturnValue(
      createSupabaseMock({}, []) as never
    );
  });

  function setupMainClient(queues: Record<string, QueryResult[]>) {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock(queues, calls) as never);
  }

  function statusFilterArgs(): unknown[] | undefined {
    return calls.find(
      (c) => c.table === 'platform_orders' && c.method === 'in' && c.args[0] === 'status'
    )?.args;
  }

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(validateAuth).mockResolvedValue(null);
    const request = new NextRequest('http://localhost:3000/api/picking-list/amazon');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('excludes Pending orders from the status filter (only Paid / Partially Shipped)', async () => {
    setupMainClient({
      platform_orders: [{ data: [], error: null }],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/amazon');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const args = statusFilterArgs();
    expect(args).toBeDefined();
    expect(args![1]).toEqual(['Paid', 'Partially Shipped']);
    expect(args![1]).not.toContain('Pending');

    // And it only ever pulls unfulfilled orders.
    expect(
      calls.some(
        (c) => c.table === 'platform_orders' && c.method === 'is' && c.args[0] === 'fulfilled_at'
      )
    ).toBe(true);
  });

  it('ignores a stale link from a Cancelled/Refunded order so the relisted copy matches', async () => {
    setupMainClient({
      platform_orders: [
        { data: [liveOrder()], error: null }, // unfulfilled orders
        { data: [], error: null }, // active orders holding the candidate: NONE (the linker is cancelled)
      ],
      inventory_items: [{ data: [listedCandidate()], error: null }],
      order_items: [
        // the candidate is linked, but only by a cancelled order
        { data: [{ inventory_item_id: 'INV1', order_id: 'ORDER_CANCELLED' }], error: null },
        { error: null }, // persist update result
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/amazon');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    const item = json.data.items[0];
    expect(item.matchStatus).toBe('matched');
    expect(item.location).toBe('Loft - S32');
    expect(item.setNo).toBe('60283');
    expect(json.data.unmatchedItems).toHaveLength(0);
    expect(json.data.unknownLocationItems).toHaveLength(0);

    // The active-order lookup must filter out cancelled orders and scope to the user.
    expect(
      calls.some(
        (c) =>
          c.table === 'platform_orders' &&
          c.method === 'neq' &&
          c.args[0] === 'status' &&
          c.args[1] === 'Cancelled/Refunded'
      )
    ).toBe(true);
    expect(
      calls.some(
        (c) => c.table === 'platform_orders' && c.method === 'eq' && c.args[0] === 'user_id'
      )
    ).toBe(true);
  });

  it('still excludes a candidate genuinely committed to an active order', async () => {
    setupMainClient({
      platform_orders: [
        { data: [liveOrder()], error: null }, // unfulfilled orders
        { data: [{ id: 'ORDER_ACTIVE' }], error: null }, // an active order holds the candidate
      ],
      inventory_items: [{ data: [listedCandidate()], error: null }],
      order_items: [
        { data: [{ inventory_item_id: 'INV1', order_id: 'ORDER_ACTIVE' }], error: null },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/picking-list/amazon');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    const item = json.data.items[0];
    expect(item.matchStatus).toBe('unmatched');
    expect(item.location).toBeNull();
    expect(json.data.unmatchedItems).toHaveLength(1);
  });
});
