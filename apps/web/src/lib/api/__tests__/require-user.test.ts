import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireUser } from '../require-user';

const mockGetUser = vi.fn();
const mockClient = { auth: { getUser: mockGetUser } };

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockClient)),
}));

describe('requireUser', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it('returns the user and client when authenticated', async () => {
    const user = { id: 'user-123', email: 'test@example.com' };
    mockGetUser.mockResolvedValue({ data: { user }, error: null });

    const result = await requireUser();

    expect(result.unauthorized).toBeNull();
    expect(result.user).toEqual(user);
    expect(result.supabase).toBe(mockClient);
  });

  it('returns a standard 401 when there is no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireUser();

    expect(result.user).toBeNull();
    expect(result.unauthorized).not.toBeNull();
    expect(result.unauthorized!.status).toBe(401);
    expect(await result.unauthorized!.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns a standard 401 on auth error (matches `authError || !user` semantics)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: { message: 'JWT expired' },
    });

    const result = await requireUser();

    expect(result.user).toBeNull();
    expect(result.unauthorized!.status).toBe(401);
  });

  it('still exposes the supabase client on the unauthorized path', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireUser();

    expect(result.supabase).toBe(mockClient);
  });
});
