/**
 * Supabase Pagination Utilities
 *
 * Supabase has a default limit of 1000 rows per query. These utilities help
 * fetch all records when you need more than 1000, or get accurate counts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

type TableName = keyof Database['public']['Tables'];

// Filter value type that's compatible with Supabase query methods
type FilterValue = string | number | boolean | null;

/**
 * Get accurate count of records in a table with filters.
 * Uses Supabase's count feature which doesn't have the 1000 row limit.
 *
 * @example
 * const count = await getAccurateCount(supabase, 'platform_orders', {
 *   eq: { platform: 'amazon', user_id: userId },
 *   or: 'items_count.eq.0,items_count.is.null'
 * });
 */
export async function getAccurateCount<T extends TableName>(
  supabase: SupabaseClient<Database>,
  table: T,
  filters?: {
    eq?: Partial<Record<string, FilterValue>>;
    neq?: Partial<Record<string, FilterValue>>;
    gt?: Partial<Record<string, number>>;
    gte?: Partial<Record<string, number | string>>;
    lt?: Partial<Record<string, number>>;
    lte?: Partial<Record<string, number | string>>;
    or?: string;
    isNull?: string[];
    isNotNull?: string[];
  }
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase.from(table).select('*', { count: 'exact', head: true }) as any;

  if (filters) {
    // Apply eq filters
    if (filters.eq) {
      for (const [key, value] of Object.entries(filters.eq)) {
        query = query.eq(key, value);
      }
    }

    // Apply neq filters
    if (filters.neq) {
      for (const [key, value] of Object.entries(filters.neq)) {
        query = query.neq(key, value);
      }
    }

    // Apply gt filters
    if (filters.gt) {
      for (const [key, value] of Object.entries(filters.gt)) {
        query = query.gt(key, value);
      }
    }

    // Apply gte filters
    if (filters.gte) {
      for (const [key, value] of Object.entries(filters.gte)) {
        query = query.gte(key, value);
      }
    }

    // Apply lt filters
    if (filters.lt) {
      for (const [key, value] of Object.entries(filters.lt)) {
        query = query.lt(key, value);
      }
    }

    // Apply lte filters
    if (filters.lte) {
      for (const [key, value] of Object.entries(filters.lte)) {
        query = query.lte(key, value);
      }
    }

    // Apply or filter
    if (filters.or) {
      query = query.or(filters.or);
    }

    // Apply isNull filters
    if (filters.isNull) {
      for (const column of filters.isNull) {
        query = query.is(column, null);
      }
    }

    // Apply isNotNull filters
    if (filters.isNotNull) {
      for (const column of filters.isNotNull) {
        query = query.not(column, 'is', null);
      }
    }
  }

  const { count, error } = await query;

  if (error) {
    console.error(`[getAccurateCount] Error counting ${table}:`, error);
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Fetch all records from a table, handling pagination automatically.
 * Use this when you need ALL records, not just the first 1000.
 *
 * WARNING: Use sparingly - fetching all records can be slow and memory-intensive.
 * Prefer paginated queries with limits for UI display.
 *
 * @example
 * const allOrders = await fetchAllRecords(supabase, 'platform_orders', {
 *   select: 'id, platform_order_id, order_date',
 *   eq: { platform: 'amazon', user_id: userId },
 *   orderBy: { column: 'order_date', ascending: false }
 * });
 */
export async function fetchAllRecords<T extends TableName>(
  supabase: SupabaseClient<Database>,
  table: T,
  options?: {
    select?: string;
    eq?: Partial<Record<string, FilterValue>>;
    neq?: Partial<Record<string, FilterValue>>;
    gt?: Partial<Record<string, number>>;
    gte?: Partial<Record<string, number | string>>;
    lt?: Partial<Record<string, number>>;
    lte?: Partial<Record<string, number | string>>;
    or?: string;
    isNull?: string[];
    isNotNull?: string[];
    orderBy?: { column: string; ascending?: boolean };
    pageSize?: number;
  }
): Promise<Database['public']['Tables'][T]['Row'][]> {
  const pageSize = options?.pageSize ?? 1000;
  const allRecords: Database['public']['Tables'][T]['Row'][] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = supabase
      .from(table)
      .select(options?.select ?? '*')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .range(page * pageSize, (page + 1) * pageSize - 1) as any;

    // Apply filters
    if (options?.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        query = query.eq(key, value);
      }
    }

    if (options?.neq) {
      for (const [key, value] of Object.entries(options.neq)) {
        query = query.neq(key, value);
      }
    }

    if (options?.gt) {
      for (const [key, value] of Object.entries(options.gt)) {
        query = query.gt(key, value);
      }
    }

    if (options?.gte) {
      for (const [key, value] of Object.entries(options.gte)) {
        query = query.gte(key, value);
      }
    }

    if (options?.lt) {
      for (const [key, value] of Object.entries(options.lt)) {
        query = query.lt(key, value);
      }
    }

    if (options?.lte) {
      for (const [key, value] of Object.entries(options.lte)) {
        query = query.lte(key, value);
      }
    }

    if (options?.or) {
      query = query.or(options.or);
    }

    if (options?.isNull) {
      for (const column of options.isNull) {
        query = query.is(column, null);
      }
    }

    if (options?.isNotNull) {
      for (const column of options.isNotNull) {
        query = query.not(column, 'is', null);
      }
    }

    if (options?.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? true,
      });
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[fetchAllRecords] Error fetching ${table} page ${page}:`, error);
      throw new Error(`Failed to fetch ${table}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRecords.push(...(data as unknown as Database['public']['Tables'][T]['Row'][]));
      hasMore = data.length === pageSize;
      page++;
    }
  }

  return allRecords;
}

/**
 * Fetch records with proper pagination for UI display.
 * Returns both data and accurate total count.
 *
 * @example
 * const { data, total, page, pageSize, totalPages } = await fetchPaginated(
 *   supabase,
 *   'platform_orders',
 *   { page: 1, pageSize: 20 },
 *   {
 *     eq: { platform: 'amazon' },
 *     orderBy: { column: 'order_date', ascending: false }
 *   }
 * );
 */
export async function fetchPaginated<T extends TableName>(
  supabase: SupabaseClient<Database>,
  table: T,
  pagination: { page: number; pageSize: number },
  options?: {
    select?: string;
    eq?: Partial<Record<string, FilterValue>>;
    neq?: Partial<Record<string, FilterValue>>;
    gt?: Partial<Record<string, number>>;
    gte?: Partial<Record<string, number | string>>;
    lt?: Partial<Record<string, number>>;
    lte?: Partial<Record<string, number | string>>;
    or?: string;
    isNull?: string[];
    isNotNull?: string[];
    orderBy?: { column: string; ascending?: boolean };
  }
): Promise<{
  data: Database['public']['Tables'][T]['Row'][];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { page, pageSize } = pagination;
  const offset = (page - 1) * pageSize;

  // Build data query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dataQuery = supabase
    .from(table)
    .select(options?.select ?? '*')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .range(offset, offset + pageSize - 1) as any;

  // Build count query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countQuery = supabase.from(table).select('*', { count: 'exact', head: true }) as any;

  // Apply filters to both queries
  if (options?.eq) {
    for (const [key, value] of Object.entries(options.eq)) {
      dataQuery = dataQuery.eq(key, value);
      countQuery = countQuery.eq(key, value);
    }
  }
  if (options?.neq) {
    for (const [key, value] of Object.entries(options.neq)) {
      dataQuery = dataQuery.neq(key, value);
      countQuery = countQuery.neq(key, value);
    }
  }
  if (options?.gt) {
    for (const [key, value] of Object.entries(options.gt)) {
      dataQuery = dataQuery.gt(key, value);
      countQuery = countQuery.gt(key, value);
    }
  }
  if (options?.gte) {
    for (const [key, value] of Object.entries(options.gte)) {
      dataQuery = dataQuery.gte(key, value);
      countQuery = countQuery.gte(key, value);
    }
  }
  if (options?.lt) {
    for (const [key, value] of Object.entries(options.lt)) {
      dataQuery = dataQuery.lt(key, value);
      countQuery = countQuery.lt(key, value);
    }
  }
  if (options?.lte) {
    for (const [key, value] of Object.entries(options.lte)) {
      dataQuery = dataQuery.lte(key, value);
      countQuery = countQuery.lte(key, value);
    }
  }
  if (options?.or) {
    dataQuery = dataQuery.or(options.or);
    countQuery = countQuery.or(options.or);
  }
  if (options?.isNull) {
    for (const column of options.isNull) {
      dataQuery = dataQuery.is(column, null);
      countQuery = countQuery.is(column, null);
    }
  }
  if (options?.isNotNull) {
    for (const column of options.isNotNull) {
      dataQuery = dataQuery.not(column, 'is', null);
      countQuery = countQuery.not(column, 'is', null);
    }
  }

  // Apply ordering to data query only
  if (options?.orderBy) {
    dataQuery = dataQuery.order(options.orderBy.column, {
      ascending: options.orderBy.ascending ?? true,
    });
  }

  // Execute both queries in parallel
  const [dataResult, countResult] = await Promise.all([dataQuery, countQuery]);

  if (dataResult.error) {
    throw new Error(`Failed to fetch ${table}: ${dataResult.error.message}`);
  }

  if (countResult.error) {
    throw new Error(`Failed to count ${table}: ${countResult.error.message}`);
  }

  const total = countResult.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return {
    data: (dataResult.data ?? []) as unknown as Database['public']['Tables'][T]['Row'][],
    total,
    page,
    pageSize,
    totalPages,
  };
}
