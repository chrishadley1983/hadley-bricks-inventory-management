/**
 * Tests for /api/transactions/[id] PATCH route.
 *
 * Focuses on the user-override + archive fields added so that a Monzo sync
 * cannot clobber the user's edits. The route does Supabase calls directly
 * (no service layer), so we mock the supabase-js chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { PATCH } from '../transactions/[id]/route';

interface PatchMocks {
  client: unknown;
  update: ReturnType<typeof vi.fn>;
}

function buildPatchClient({
  userId = 'user-123',
  existingRow = { id: 'tx-1' } as Record<string, unknown> | null,
  updatedRow = { id: 'tx-1' } as Record<string, unknown>,
}: {
  userId?: string | null;
  existingRow?: Record<string, unknown> | null;
  updatedRow?: Record<string, unknown>;
} = {}): PatchMocks {
  const update = vi.fn();

  const fromMock = vi.fn(() => {
    let opCount = 0;
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn(() => {
              // First call: existence check. Second call (after update().select()): updated row.
              opCount += 1;
              if (opCount === 1) {
                return Promise.resolve({
                  data: existingRow,
                  error: existingRow ? null : { code: 'PGRST116' },
                });
              }
              return Promise.resolve({ data: updatedRow, error: null });
            }),
          }),
        }),
      }),
      update: update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn(() =>
                Promise.resolve({ data: updatedRow, error: null })
              ),
            }),
          }),
        }),
      }),
    };
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: 'Not authenticated' },
      }),
    },
    from: fromMock,
  };

  return { client, update };
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/transactions/tx-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/transactions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const { client } = buildPatchClient({ userId: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await PATCH(patchRequest({ user_notes: 'x' }), {
      params: Promise.resolve({ id: 'tx-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when transaction not found', async () => {
    const { client } = buildPatchClient({ existingRow: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await PATCH(patchRequest({ user_notes: 'x' }), {
      params: Promise.resolve({ id: 'tx-missing' }),
    });

    expect(res.status).toBe(404);
  });

  it('persists user_merchant_name and user_description overrides', async () => {
    const { client, update } = buildPatchClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await PATCH(
      patchRequest({
        user_merchant_name: 'Sky TV',
        user_description: 'Monthly streaming',
      }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      user_merchant_name: 'Sky TV',
      user_description: 'Monthly streaming',
    });
  });

  it('coerces empty-string overrides to null so the display fallback works', async () => {
    const { client, update } = buildPatchClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    await PATCH(
      patchRequest({
        user_merchant_name: '',
        user_description: '',
      }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );

    expect(update).toHaveBeenCalledWith({
      user_merchant_name: null,
      user_description: null,
    });
  });

  it('persists is_archived toggle', async () => {
    const { client, update } = buildPatchClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    await PATCH(patchRequest({ is_archived: true }), {
      params: Promise.resolve({ id: 'tx-1' }),
    });

    expect(update).toHaveBeenCalledWith({ is_archived: true });
  });

  it('rejects non-boolean is_archived with 400', async () => {
    const { client } = buildPatchClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await PATCH(patchRequest({ is_archived: 'yes' }), {
      params: Promise.resolve({ id: 'tx-1' }),
    });

    expect(res.status).toBe(400);
  });

  it('only writes the fields that were provided (does not clobber others)', async () => {
    const { client, update } = buildPatchClient();
    vi.mocked(createClient).mockResolvedValue(client as never);

    await PATCH(patchRequest({ user_notes: 'just a note' }), {
      params: Promise.resolve({ id: 'tx-1' }),
    });

    expect(update).toHaveBeenCalledWith({ user_notes: 'just a note' });
    const call = update.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('user_merchant_name');
    expect(call).not.toHaveProperty('user_description');
    expect(call).not.toHaveProperty('is_archived');
  });
});
