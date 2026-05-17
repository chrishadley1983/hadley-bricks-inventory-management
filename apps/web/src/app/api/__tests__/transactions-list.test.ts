/**
 * Tests for /api/transactions GET route.
 *
 * Focuses on the archive filter (default: hide archived rows; opt-in
 * via includeArchived=true) and the search-string sanitisation guard
 * against PostgREST .or() injection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET } from '../transactions/route';

function buildListClient() {
  const eqCalls: Array<[string, unknown]> = [];
  const orCalls: string[] = [];

  // Chainable query builder where every method records, returns this, and
  // can be awaited at the end (resolves to an empty result set).
  const queryBuilder: Record<string, unknown> = {};
  queryBuilder.select = vi.fn(() => queryBuilder);
  queryBuilder.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return queryBuilder;
  });
  queryBuilder.or = vi.fn((expr: string) => {
    orCalls.push(expr);
    return queryBuilder;
  });
  queryBuilder.gte = vi.fn(() => queryBuilder);
  queryBuilder.lte = vi.fn(() => queryBuilder);
  queryBuilder.order = vi.fn(() => queryBuilder);
  queryBuilder.range = vi.fn(() => queryBuilder);
  queryBuilder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], count: 0, error: null }).then(resolve);

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
    from: vi.fn(() => queryBuilder),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };

  return { client, eqCalls, orCalls };
}

function listRequest(query: Record<string, string> = {}) {
  const params = new URLSearchParams(query);
  return new NextRequest(`http://localhost:3000/api/transactions?${params.toString()}`);
}

describe('GET /api/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out archived rows by default', async () => {
    const { client, eqCalls } = buildListClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await GET(listRequest());

    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(['is_archived', false]);
  });

  it('returns archived rows when includeArchived=true', async () => {
    const { client, eqCalls } = buildListClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await GET(listRequest({ includeArchived: 'true' }));

    expect(res.status).toBe(200);
    expect(eqCalls).not.toContainEqual(['is_archived', false]);
  });

  it('strips commas from search so PostgREST cannot parse injected filters', async () => {
    const { client, orCalls } = buildListClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    await GET(listRequest({ search: 'amazon,user_id.eq.attacker' }));

    expect(orCalls).toHaveLength(1);
    // The .or() value must still be exactly 4 comma-separated ilike clauses —
    // the attacker comma was stripped, so the would-be injected filter is now
    // inert text inside the last clause's ILIKE pattern.
    const clauses = orCalls[0].split(',');
    expect(clauses).toHaveLength(4);
    expect(clauses[0]).toMatch(/^description\.ilike\.%.*%$/);
    expect(clauses[1]).toMatch(/^merchant_name\.ilike\.%.*%$/);
    expect(clauses[2]).toMatch(/^user_description\.ilike\.%.*%$/);
    expect(clauses[3]).toMatch(/^user_merchant_name\.ilike\.%.*%$/);
  });

  it('searches across both original and user-override columns', async () => {
    const { client, orCalls } = buildListClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    await GET(listRequest({ search: 'sky' }));

    expect(orCalls[0]).toContain('merchant_name.ilike.%sky%');
    expect(orCalls[0]).toContain('description.ilike.%sky%');
    expect(orCalls[0]).toContain('user_merchant_name.ilike.%sky%');
    expect(orCalls[0]).toContain('user_description.ilike.%sky%');
  });
});
