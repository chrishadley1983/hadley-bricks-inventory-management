import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

/**
 * Paginated result type
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type TableName = keyof Database['public']['Tables'];

/**
 * Helper to get a typed table reference from Supabase.
 * Uses 'any' to bypass complex generic inference issues with dynamic table names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any>;

/**
 * Base repository class providing common CRUD operations.
 * All repositories extend this class and work with Supabase.
 */
export abstract class BaseRepository<TRow, TInsert, TUpdate> {
  protected readonly tableName: TableName;
  protected readonly supabase: AnySupabaseClient;

  constructor(supabase: SupabaseClient<Database>, tableName: TableName) {
    this.supabase = supabase as AnySupabaseClient;
    this.tableName = tableName;
  }

  /**
   * Find a single record by ID
   */
  async findById(id: string): Promise<TRow | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to find ${String(this.tableName)} by id: ${error.message}`);
    }

    return data as TRow;
  }

  /**
   * Find all records with optional pagination
   */
  async findAll(options?: PaginationOptions): Promise<PaginatedResult<TRow>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Get count first
    const { count, error: countError } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Failed to count ${String(this.tableName)}: ${countError.message}`);
    }

    // Get paginated data
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to find all ${String(this.tableName)}: ${error.message}`);
    }

    const total = count ?? 0;

    return {
      data: (data ?? []) as TRow[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Create a new record
   */
  async create(input: TInsert): Promise<TRow> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert(input)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create ${String(this.tableName)}: ${error.message}`);
    }

    return data as TRow;
  }

  /**
   * Update an existing record
   */
  async update(id: string, input: TUpdate): Promise<TRow> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(input)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update ${String(this.tableName)}: ${error.message}`);
    }

    return data as TRow;
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      throw new Error(`Failed to delete ${String(this.tableName)}: ${error.message}`);
    }
  }

  /**
   * Check if a record exists
   */
  async exists(id: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to check existence in ${String(this.tableName)}: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }
}
