import { describe, it, expect, vi } from 'vitest';
import { fetchAllRecords, fetchPaginated, getAccurateCount } from '../pagination';

/**
 * Builds a minimal chainable Supabase mock backed by `dataset`.
 * - `from()` returns a FRESH query each call (so fetchPaginated's parallel
 *   data + count queries don't share state).
 * - `range(from, to)` slices the dataset (simulating real pagination).
 * - `select('*', { head: true })` marks the query as a count query.
 * - All operator calls are recorded for assertions.
 */
function createMock(dataset: Record<string, unknown>[]) {
  const recorded = {
    eq: [] as [string, unknown][],
    gte: [] as [string, unknown][],
    lte: [] as [string, unknown][],
    in: [] as [string, unknown][],
    not: [] as [string, string, unknown][],
    ranges: [] as [number, number][],
  };

  const makeQ = () => {
    let head = false;
    let range: [number, number] = [0, dataset.length - 1];
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: vi.fn((_sel: string, opts?: { head?: boolean }) => {
        if (opts?.head) head = true;
        return q;
      }),
      eq: vi.fn((k: string, v: unknown) => { recorded.eq.push([k, v]); return q; }),
      neq: vi.fn(() => q),
      gt: vi.fn(() => q),
      lt: vi.fn(() => q),
      gte: vi.fn((k: string, v: unknown) => { recorded.gte.push([k, v]); return q; }),
      lte: vi.fn((k: string, v: unknown) => { recorded.lte.push([k, v]); return q; }),
      in: vi.fn((k: string, v: unknown) => { recorded.in.push([k, v]); return q; }),
      not: vi.fn((k: string, op: string, v: unknown) => { recorded.not.push([k, op, v]); return q; }),
      or: vi.fn(() => q),
      is: vi.fn(() => q),
      order: vi.fn(() => q),
      range: vi.fn((from: number, to: number) => { range = [from, to]; recorded.ranges.push([from, to]); return q; }),
      then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        const res = head
          ? { count: dataset.length, error: null }
          : { data: dataset.slice(range[0], range[1] + 1), error: null };
        return Promise.resolve(res).then(onF, onR);
      },
    });
    return q;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from: vi.fn(() => makeQ()) } as any, recorded };
}

describe('pagination helper', () => {
  describe('fetchAllRecords', () => {
    it('pages through > 1000 rows until a short page', async () => {
      const dataset = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
      const { client, recorded } = createMock(dataset);

      const rows = await fetchAllRecords(client, 'platform_orders');

      expect(rows).toHaveLength(1500);
      // Two pages: [0..999] then [1000..1999]
      expect(recorded.ranges).toEqual([[0, 999], [1000, 1999]]);
    });

    it('returns everything in a single page when under pageSize', async () => {
      const dataset = Array.from({ length: 42 }, (_, i) => ({ id: i }));
      const { client, recorded } = createMock(dataset);

      const rows = await fetchAllRecords(client, 'platform_orders');

      expect(rows).toHaveLength(42);
      expect(recorded.ranges).toEqual([[0, 999]]);
    });

    it('applies in / notIn / eq / gte / lte filters to the query', async () => {
      const dataset = Array.from({ length: 3 }, (_, i) => ({ id: i }));
      const { client, recorded } = createMock(dataset);

      await fetchAllRecords(client, 'platform_orders', {
        select: 'id, status',
        eq: { user_id: 'u1' },
        in: { status: ['Shipped', 'Paid'] },
        notIn: { order_status: ['Cancelled', 'Refunded'] },
        gte: { order_date: '2024-01-01' },
        lte: { order_date: '2024-03-31' },
      });

      expect(recorded.eq).toContainEqual(['user_id', 'u1']);
      expect(recorded.in).toContainEqual(['status', ['Shipped', 'Paid']]);
      // notIn becomes PostgREST raw `not in (a,b)` — must match the original hand-rolled form
      expect(recorded.not).toContainEqual(['order_status', 'in', '(Cancelled,Refunded)']);
      expect(recorded.gte).toContainEqual(['order_date', '2024-01-01']);
      expect(recorded.lte).toContainEqual(['order_date', '2024-03-31']);
    });

    it('throws when the query errors', async () => {
      const client = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          then: (onF: (r: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: 'boom' } }).then(onF),
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      await expect(fetchAllRecords(client, 'platform_orders')).rejects.toThrow(/boom/);
    });
  });

  describe('getAccurateCount', () => {
    it('returns the exact count and applies filters', async () => {
      const dataset = Array.from({ length: 7 }, (_, i) => ({ id: i }));
      const { client, recorded } = createMock(dataset);

      const count = await getAccurateCount(client, 'platform_orders', {
        eq: { user_id: 'u1' },
        in: { status: ['Shipped'] },
        notIn: { order_status: ['Cancelled'] },
      });

      expect(count).toBe(7);
      expect(recorded.in).toContainEqual(['status', ['Shipped']]);
      expect(recorded.not).toContainEqual(['order_status', 'in', '(Cancelled)']);
    });
  });

  describe('fetchPaginated', () => {
    it('returns one page of data plus the accurate total', async () => {
      const dataset = Array.from({ length: 55 }, (_, i) => ({ id: i }));
      const { client, recorded } = createMock(dataset);

      const result = await fetchPaginated(
        client,
        'platform_orders',
        { page: 2, pageSize: 20 },
        { in: { status: ['Shipped'] } }
      );

      expect(result.total).toBe(55);
      expect(result.pageSize).toBe(20);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
      // page 2 of size 20 -> offset 20..39
      expect(recorded.ranges).toContainEqual([20, 39]);
      expect(result.data).toHaveLength(20);
    });
  });
});
