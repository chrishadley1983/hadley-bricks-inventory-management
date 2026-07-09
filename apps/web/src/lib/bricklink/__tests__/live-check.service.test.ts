import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RateLimitError, type BrickLinkClient } from '../client';
import type { BrickLinkPriceGuide } from '../types';
import type { PriceGuideCacheService } from '../price-guide-cache.service';
import {
  apiPriceGuideToUkCacheFields,
  liveCheckTuple,
  liveCheckBatch,
  LIVE_CHECK_PARSE_VERSION,
  type TupleFetches,
  type LiveCheckTuple,
} from '../live-check.service';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function fakeGuide(overrides: Partial<BrickLinkPriceGuide> = {}): BrickLinkPriceGuide {
  return {
    item: { no: '3001', type: 'PART' },
    new_or_used: 'N',
    currency_code: 'GBP',
    min_price: '0.05',
    max_price: '0.50',
    avg_price: '0.12',
    qty_avg_price: '0.15',
    unit_quantity: 10,
    total_quantity: 25,
    price_detail: [],
    ...overrides,
  };
}

const noFetches: TupleFetches = {
  soldNew: { requested: false },
  soldUsed: { requested: false },
  stockNew: { requested: false },
  stockUsed: { requested: false },
};

/** Minimal supabase mock: `.from(table).upsert()/.insert()` resolve ok and record calls. */
function makeMockSupabase() {
  const calls: Array<{ table: string; op: 'upsert' | 'insert'; payload: unknown; opts?: unknown }> = [];
  const client = {
    from: (table: string) => ({
      upsert: (payload: unknown, opts?: unknown) => {
        calls.push({ table, op: 'upsert', payload, opts });
        return Promise.resolve({ error: null });
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', payload });
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { supabase: client as unknown as SupabaseClient, calls };
}

function makeMockCacheService(): PriceGuideCacheService {
  return { getFresh: vi.fn().mockResolvedValue(new Map()) } as unknown as PriceGuideCacheService;
}

// ---------------------------------------------------------------------------
// apiPriceGuideToUkCacheFields
// ---------------------------------------------------------------------------

describe('apiPriceGuideToUkCacheFields', () => {
  it('maps unit_quantity -> lots and total_quantity -> qty for both conditions', () => {
    const fetches: TupleFetches = {
      soldNew: {
        requested: true,
        ok: true,
        guide: fakeGuide({ new_or_used: 'N', unit_quantity: 10, total_quantity: 25, avg_price: '0.12', qty_avg_price: '0.15' }),
      },
      soldUsed: {
        requested: true,
        ok: true,
        guide: fakeGuide({ new_or_used: 'U', unit_quantity: 4, total_quantity: 9, avg_price: '0.20', qty_avg_price: '0.22' }),
      },
      stockNew: { requested: false },
      stockUsed: { requested: false },
    };
    const tuple: LiveCheckTuple = { itemType: 'P', itemNo: '3001', colourId: 11 };
    const row = apiPriceGuideToUkCacheFields(tuple, fetches, '2026-07-08T00:00:00.000Z');

    expect(row.item_type).toBe('P');
    expect(row.item_no).toBe('3001');
    expect(row.colour_id).toBe(11);
    expect(row.parse_version).toBe(LIVE_CHECK_PARSE_VERSION);
    expect(row.fetched_at).toBe('2026-07-08T00:00:00.000Z');

    // unit_quantity (API "lots") -> uk_sold_lots_*, total_quantity (API "qty") -> uk_sold_qty_*.
    expect(row.uk_sold_lots_new).toBe(10);
    expect(row.uk_sold_qty_new).toBe(25);
    expect(row.uk_sold_avg_new).toBeCloseTo(0.12, 4);
    expect(row.uk_sold_qty_avg_new).toBeCloseTo(0.15, 4);

    expect(row.uk_sold_lots_used).toBe(4);
    expect(row.uk_sold_qty_used).toBe(9);
    expect(row.uk_sold_avg_used).toBeCloseTo(0.2, 4);
    expect(row.uk_sold_qty_avg_used).toBeCloseTo(0.22, 4);

    // stock wasn't requested — no stock columns at all.
    expect('uk_stock_qty_new' in row).toBe(false);
    expect('uk_stock_lots_new' in row).toBe(false);
  });

  it('maps the stock quadrant including min price when requested', () => {
    const fetches: TupleFetches = {
      ...noFetches,
      stockNew: { requested: true, ok: true, guide: fakeGuide({ unit_quantity: 6, total_quantity: 40, min_price: '0.07' }) },
    };
    const row = apiPriceGuideToUkCacheFields({ itemType: 'P', itemNo: '3001', colourId: 5 }, fetches);
    expect(row.uk_stock_lots_new).toBe(6);
    expect(row.uk_stock_qty_new).toBe(40);
    expect(row.uk_stock_min_new).toBeCloseTo(0.07, 4);
  });

  it('omits fields for conditions that were never requested (partial write, not a zero-out)', () => {
    const fetches: TupleFetches = {
      ...noFetches,
      soldNew: { requested: true, ok: true, guide: fakeGuide({ unit_quantity: 2, total_quantity: 3 }) },
    };
    const row = apiPriceGuideToUkCacheFields({ itemType: 'P', itemNo: '3001', colourId: 11 }, fetches);
    expect(row.uk_sold_lots_new).toBe(2);
    expect('uk_sold_avg_used' in row).toBe(false);
    expect('uk_sold_lots_used' in row).toBe(false);
    expect('uk_sold_qty_used' in row).toBe(false);
  });

  it('omits fields for conditions whose fetch failed (distinct from zero-sales)', () => {
    const fetches: TupleFetches = {
      ...noFetches,
      soldNew: { requested: true, ok: true, guide: fakeGuide({ unit_quantity: 2, total_quantity: 3 }) },
      soldUsed: { requested: true, ok: false, error: 'BrickLinkApiError: 404' },
    };
    const row = apiPriceGuideToUkCacheFields({ itemType: 'P', itemNo: '3001', colourId: 11 }, fetches);
    expect(row.uk_sold_lots_new).toBe(2);
    expect('uk_sold_avg_used' in row).toBe(false);
    expect('uk_sold_lots_used' in row).toBe(false);
  });

  it('writes explicit zeros/nulls (not omission) for a genuine zero-sales result', () => {
    const fetches: TupleFetches = {
      ...noFetches,
      soldNew: { requested: true, ok: true, guide: fakeGuide({ unit_quantity: 0, total_quantity: 0, avg_price: '0.0000' }) },
    };
    const row = apiPriceGuideToUkCacheFields({ itemType: 'P', itemNo: '999999', colourId: 0 }, fetches);
    expect(row.uk_sold_lots_new).toBe(0);
    expect(row.uk_sold_qty_new).toBe(0);
    expect(row.uk_sold_avg_new).toBeNull();
    expect(row.uk_sold_qty_avg_new).toBeNull();
  });

  it('zeroes colour_id for non-part items regardless of the input colourId', () => {
    const row = apiPriceGuideToUkCacheFields({ itemType: 'M', itemNo: 'sw1479', colourId: 99 }, noFetches);
    expect(row.colour_id).toBe(0);
    expect(row.item_type).toBe('M');
    expect(row.item_no).toBe('sw1479');
  });
});

// ---------------------------------------------------------------------------
// liveCheckTuple — RateLimitError propagation
// ---------------------------------------------------------------------------

describe('liveCheckTuple', () => {
  it('propagates RateLimitError immediately rather than treating it as a per-call failure', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockRejectedValue(
        new RateLimitError('budget exhausted', { remaining: 0, resetTime: new Date(), dailyLimit: 3500, dailyRemaining: 0 })
      ),
    } as unknown as BrickLinkClient;
    const { supabase } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    await expect(
      liveCheckTuple(client, cacheService, supabase, { itemType: 'P', itemNo: '3001', colourId: 11 }, { callSpacingMs: 0 })
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('writes through to the unified cache only on a successful sold-only check (P/M types)', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockResolvedValue(fakeGuide({ unit_quantity: 3, total_quantity: 8, avg_price: '0.30' })),
    } as unknown as BrickLinkClient;
    const { supabase, calls } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    const result = await liveCheckTuple(
      client,
      cacheService,
      supabase,
      { itemType: 'P', itemNo: '3001', colourId: 11 },
      { callSpacingMs: 0 }
    );

    expect(result.requests).toBe(2); // N + U sold, default conditions
    expect(result.wroteToUkCache).toBe(true);
    expect(calls.some((c) => c.table === 'bricklink_price_guide_cache' && c.op === 'upsert')).toBe(true);
    expect(calls.some((c) => c.table === 'bricklink_part_price_cache')).toBe(false);
  });

  it('writes SET tuples to the unified cache with colour 0', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockResolvedValue(fakeGuide({ unit_quantity: 3, total_quantity: 8, avg_price: '30.00' })),
    } as unknown as BrickLinkClient;
    const { supabase, calls } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    const result = await liveCheckTuple(
      client,
      cacheService,
      supabase,
      { itemType: 'S', itemNo: '45501', colourId: 0 },
      { callSpacingMs: 0 }
    );

    expect(result.wroteToUkCache).toBe(true);
    expect(calls.some((c) => c.table === 'bricklink_part_price_cache')).toBe(false);
    expect(calls.some((c) => c.table === 'bricklink_price_guide_cache')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// liveCheckBatch — budget-exhaustion behaviour
// ---------------------------------------------------------------------------

describe('liveCheckBatch', () => {
  const tuples: LiveCheckTuple[] = [
    { itemType: 'P', itemNo: '3001', colourId: 11 },
    { itemType: 'P', itemNo: '3002', colourId: 11 },
  ];

  it('stops cleanly on RateLimitError and returns partial results with budgetExhausted=true', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockImplementation(async (_type: string, no: string) => {
        if (no === '3002') {
          throw new RateLimitError('budget exhausted', { remaining: 0, resetTime: new Date(), dailyLimit: 3500, dailyRemaining: 0 });
        }
        return fakeGuide({ unit_quantity: 1, total_quantity: 2, avg_price: '0.10' });
      }),
    } as unknown as BrickLinkClient;
    const { supabase, calls } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    const result = await liveCheckBatch(client, cacheService, supabase, tuples, {
      spacingMs: 0,
      callSpacingMs: 0,
    });

    expect(result.budgetExhausted).toBe(true);
    expect(result.tuplesRequested).toBe(2);
    expect(result.tuplesCompleted).toBe(1); // only the first tuple (3001) finished
    expect(result.results).toHaveLength(1);
    expect(result.results[0].tuple.itemNo).toBe('3001');
    // 3001 used 2 calls (N+U sold) before 3002's first call tripped the budget.
    expect(result.requestsTotal).toBe(2);
    expect(result.firstBlockAtRequest).toBe(3);

    // Telemetry row written once, flagged as budget-exhausted.
    const telemetry = calls.filter((c) => c.table === 'bl_pg_lane_telemetry');
    expect(telemetry).toHaveLength(1);
    const payload = telemetry[0].payload as Record<string, unknown>;
    expect(payload.lane).toBe('store_api');
    expect(payload.first_block_at_request).toBe(3);
    expect(payload.notes).toMatch(/BUDGET EXHAUSTED/);
  });

  it('completes all tuples and writes a clean telemetry row when the budget is not hit', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockResolvedValue(fakeGuide({ unit_quantity: 1, total_quantity: 2, avg_price: '0.10' })),
    } as unknown as BrickLinkClient;
    const { supabase, calls } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    const result = await liveCheckBatch(client, cacheService, supabase, tuples, { spacingMs: 0, callSpacingMs: 0 });

    expect(result.budgetExhausted).toBe(false);
    expect(result.firstBlockAtRequest).toBeNull();
    expect(result.tuplesCompleted).toBe(2);
    expect(result.requestsTotal).toBe(4); // 2 tuples x 2 calls (N+U sold)

    const telemetry = calls.filter((c) => c.table === 'bl_pg_lane_telemetry');
    expect(telemetry).toHaveLength(1);
    expect((telemetry[0].payload as Record<string, unknown>).notes).not.toMatch(/BUDGET EXHAUSTED/);
  });

  it('skips the telemetry write when skipTelemetry is set', async () => {
    const client = {
      getPartPriceGuide: vi.fn().mockResolvedValue(fakeGuide({ unit_quantity: 1, total_quantity: 2 })),
    } as unknown as BrickLinkClient;
    const { supabase, calls } = makeMockSupabase();
    const cacheService = makeMockCacheService();

    await liveCheckBatch(client, cacheService, supabase, tuples, { spacingMs: 0, callSpacingMs: 0, skipTelemetry: true });
    expect(calls.some((c) => c.table === 'bl_pg_lane_telemetry')).toBe(false);
  });
});
