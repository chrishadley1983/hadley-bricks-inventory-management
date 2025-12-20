import { vi } from 'vitest';

interface MockItem {
  id?: string;
  user_id?: string;
  [key: string]: unknown;
}

/**
 * Create a mock Supabase client for testing
 */
export function createMockSupabaseClient() {
  const mockData: Record<string, MockItem[]> = {
    profiles: [],
    inventory_items: [],
    purchases: [],
    platform_orders: [],
    platform_credentials: [],
    financial_transactions: [],
    user_settings: [],
  };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
  };

  const createQueryBuilder = (tableName: string) => {
    const filters: Record<string, unknown> = {};
    let rangeStart = 0;
    let rangeEnd = 49;
    let countMode = false;
    let headOnly = false;
    let limitCount: number | null = null;

    const builder = {
      select: vi.fn((_columns?: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === 'exact') countMode = true;
        if (options?.head) headOnly = true;
        return builder;
      }),
      insert: vi.fn((data: unknown) => {
        const items = Array.isArray(data) ? data : [data];
        const newItems = items.map((item, index) => ({
          id: `test-id-${Date.now()}-${index}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(item as Record<string, unknown>),
        }));
        mockData[tableName].push(...newItems);
        return builder;
      }),
      update: vi.fn((data: unknown) => {
        const id = filters['id'];
        if (id) {
          const index = mockData[tableName].findIndex((item) => item.id === id);
          if (index !== -1) {
            mockData[tableName][index] = {
              ...mockData[tableName][index],
              ...(data as Record<string, unknown>),
            };
          }
        }
        return builder;
      }),
      delete: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      in: vi.fn((column: string, values: unknown[]) => {
        filters[`${column}_in`] = values;
        return builder;
      }),
      or: vi.fn(() => builder),
      gte: vi.fn((column: string, value: unknown) => {
        filters[`${column}_gte`] = value;
        return builder;
      }),
      lte: vi.fn((column: string, value: unknown) => {
        filters[`${column}_lte`] = value;
        return builder;
      }),
      range: vi.fn((start: number, end: number) => {
        rangeStart = start;
        rangeEnd = end;
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn((count: number) => {
        limitCount = count;
        return builder;
      }),
      single: vi.fn(async () => {
        const data = mockData[tableName].filter((item) => {
          if (filters['id'] && item.id !== filters['id']) return false;
          if (filters['user_id'] && item.user_id !== filters['user_id']) return false;
          return true;
        })[0];

        if (!data) {
          return { data: null, error: { code: 'PGRST116', message: 'Not found' } };
        }

        return { data, error: null };
      }),
      then: vi.fn(
        async (
          resolve: (result: { data: unknown; count: number | null; error: unknown }) => void
        ) => {
          let data: MockItem[] = [...mockData[tableName]];

          // Apply filters
          if (filters['id']) {
            data = data.filter((item) => item.id === filters['id']);
          }
          if (filters['user_id']) {
            data = data.filter((item) => item.user_id === filters['user_id']);
          }

          // Apply pagination
          if (limitCount) {
            data = data.slice(0, limitCount);
          } else {
            data = data.slice(rangeStart, rangeEnd + 1);
          }

          const result = {
            data: headOnly ? null : data,
            count: countMode ? mockData[tableName].length : null,
            error: null,
          };

          resolve(result);
          return result;
        }
      ),
    };

    return builder;
  };

  const mockClient = {
    from: vi.fn((tableName: string) => createQueryBuilder(tableName)),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockUser },
        error: null,
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: mockUser, access_token: 'test-token' } },
        error: null,
      })),
      signUp: vi.fn(async () => ({
        data: { user: mockUser, session: null },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: mockUser, session: { access_token: 'test-token' } },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      refreshSession: vi.fn(async () => ({
        data: { session: { user: mockUser, access_token: 'test-token' } },
        error: null,
      })),
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    },
    _mockData: mockData,
    _setMockData: (table: string, data: MockItem[]) => {
      mockData[table] = data;
    },
    _clearMockData: () => {
      Object.keys(mockData).forEach((key) => {
        mockData[key] = [];
      });
    },
  };

  return mockClient;
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;
