/**
 * BrickLink Upload Service
 *
 * Service for managing BrickLink upload records (inventory batches
 * uploaded to BrickLink/BrickOwl stores).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

// ============================================================================
// Types
// ============================================================================

export interface BrickLinkUpload {
  id: string;
  user_id: string;
  bricqer_batch_id: number | null;
  bricqer_purchase_id: number | null;
  upload_date: string;
  total_quantity: number;
  selling_price: number;
  cost: number | null;
  source: string | null;
  notes: string | null;
  purchase_id: string | null;
  linked_lot: string | null;
  lots: number | null;
  condition: string | null;
  reference: string | null;
  is_activated: boolean | null;
  remaining_quantity: number | null;
  remaining_price: number | null;
  raw_response: unknown | null;
  synced_from_bricqer: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface BrickLinkUploadInsert {
  upload_date: string;
  total_quantity: number;
  selling_price: number;
  cost?: number | null;
  source?: string | null;
  notes?: string | null;
  purchase_id?: string | null;
  linked_lot?: string | null;
  lots?: number | null;
  condition?: string | null;
  reference?: string | null;
}

export interface BrickLinkUploadUpdate {
  upload_date?: string;
  total_quantity?: number;
  selling_price?: number;
  cost?: number | null;
  source?: string | null;
  notes?: string | null;
  purchase_id?: string | null;
  linked_lot?: string | null;
  lots?: number | null;
  condition?: string | null;
  reference?: string | null;
}

export interface BrickLinkUploadFilters {
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  searchTerm?: string;
  syncedFromBricqer?: boolean;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UploadSummary {
  totalUploads: number;
  totalQuantity: number;
  totalSellingPrice: number;
  totalCost: number;
  totalMargin: number;
  recentUploads: BrickLinkUpload[];
}

// ============================================================================
// Service Class
// ============================================================================

export class BrickLinkUploadService {
  private supabase: SupabaseClient<Database>;
  private userId: string;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  /**
   * Get a single upload by ID
   */
  async getById(id: string): Promise<BrickLinkUpload | null> {
    const { data, error } = await this.supabase
      .from('bricklink_uploads')
      .select('*')
      .eq('id', id)
      .eq('user_id', this.userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw error;
    }

    return data as BrickLinkUpload;
  }

  /**
   * Get all uploads with optional filters and pagination
   */
  async getAll(
    filters?: BrickLinkUploadFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<BrickLinkUpload>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    // Build query
    let query = this.supabase
      .from('bricklink_uploads')
      .select('*', { count: 'exact' })
      .eq('user_id', this.userId);

    // Apply filters
    if (filters?.dateFrom) {
      query = query.gte('upload_date', filters.dateFrom);
    }
    if (filters?.dateTo) {
      query = query.lte('upload_date', filters.dateTo);
    }
    if (filters?.source) {
      query = query.eq('source', filters.source);
    }
    if (filters?.syncedFromBricqer !== undefined) {
      query = query.eq('synced_from_bricqer', filters.syncedFromBricqer);
    }
    if (filters?.searchTerm) {
      query = query.or(
        `source.ilike.%${filters.searchTerm}%,notes.ilike.%${filters.searchTerm}%,reference.ilike.%${filters.searchTerm}%`
      );
    }

    // Order by date descending
    query = query.order('upload_date', { ascending: false });

    // Apply pagination
    query = query.range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      throw error;
    }

    return {
      data: (data ?? []) as BrickLinkUpload[],
      page,
      pageSize,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };
  }

  /**
   * Create a new upload
   */
  async create(input: BrickLinkUploadInsert): Promise<BrickLinkUpload> {
    const { data, error } = await this.supabase
      .from('bricklink_uploads')
      .insert({
        user_id: this.userId,
        upload_date: input.upload_date,
        total_quantity: input.total_quantity,
        selling_price: input.selling_price,
        cost: input.cost ?? null,
        source: input.source ?? null,
        notes: input.notes ?? null,
        purchase_id: input.purchase_id ?? null,
        linked_lot: input.linked_lot ?? null,
        lots: input.lots ?? null,
        condition: input.condition ?? null,
        reference: input.reference ?? null,
        synced_from_bricqer: false,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as BrickLinkUpload;
  }

  /**
   * Update an upload
   */
  async update(id: string, input: BrickLinkUploadUpdate): Promise<BrickLinkUpload> {
    const { data, error } = await this.supabase
      .from('bricklink_uploads')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', this.userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as BrickLinkUpload;
  }

  /**
   * Delete an upload
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('bricklink_uploads')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId);

    if (error) {
      throw error;
    }
  }

  /**
   * Get recent uploads
   */
  async getRecent(limit: number = 10): Promise<BrickLinkUpload[]> {
    const { data, error } = await this.supabase
      .from('bricklink_uploads')
      .select('*')
      .eq('user_id', this.userId)
      .order('upload_date', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data ?? []) as BrickLinkUpload[];
  }

  /**
   * Get summary statistics
   */
  async getSummary(): Promise<UploadSummary> {
    // Get all uploads for summary calculations
    // Using pagination to handle large datasets
    const pageSize = 1000;
    let allUploads: BrickLinkUpload[] = [];
    let hasMore = true;
    let page = 0;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('bricklink_uploads')
        .select('*')
        .eq('user_id', this.userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw error;
      }

      allUploads = [...allUploads, ...(data ?? [])];
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    // Calculate totals
    const totalUploads = allUploads.length;
    const totalQuantity = allUploads.reduce((sum, u) => sum + (u.total_quantity ?? 0), 0);
    const totalSellingPrice = allUploads.reduce((sum, u) => sum + (u.selling_price ?? 0), 0);
    const totalCost = allUploads.reduce((sum, u) => sum + (u.cost ?? 0), 0);
    const totalMargin = totalSellingPrice - totalCost;

    // Get recent uploads (sorted)
    const recentUploads = [...allUploads]
      .sort((a, b) => new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime())
      .slice(0, 5) as BrickLinkUpload[];

    return {
      totalUploads,
      totalQuantity,
      totalSellingPrice,
      totalCost,
      totalMargin,
      recentUploads,
    };
  }

  /**
   * Get distinct source values for filter dropdown
   */
  async getDistinctSources(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('bricklink_uploads')
      .select('source')
      .eq('user_id', this.userId)
      .not('source', 'is', null)
      .order('source');

    if (error) {
      throw error;
    }

    // Extract unique non-null sources
    const sources = new Set<string>();
    for (const row of data ?? []) {
      if (row.source) {
        sources.add(row.source);
      }
    }

    return Array.from(sources);
  }
}
