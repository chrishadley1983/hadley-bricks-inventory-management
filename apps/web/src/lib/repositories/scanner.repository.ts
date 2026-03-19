/**
 * Scanner Repository
 *
 * Data access layer for scanner_sessions and scanner_pieces tables.
 *
 * scanner_pieces DB columns are mapped to UI-friendly names:
 *   brickognize_item_id  → part_id
 *   item_name            → part_name
 *   item_category        → category
 *   confidence           → confidence_score
 *   frame_sharpness      → sharpness_score
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type {
  ScannerSession,
  ScannerPiece,
  ScannerSessionFilters,
  ScannerPieceFilters,
  ScannerSessionsResponse,
} from '@/types/scanner';

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

// ─── DB row types (raw from Supabase) ────────────────────────────────────────

interface DbScannerSessionRow {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  confidence_threshold: number;
  camera_config_json: unknown;
  summary_json: unknown;
  created_at: string;
}

interface DbScannerPieceRow {
  id: string;
  session_id: string;
  brickognize_item_id: string | null;
  brickognize_listing_id: string | null;
  item_name: string | null;
  item_category: string | null;
  confidence: number | null;
  status: string;
  top_results_json: unknown;
  image_path: string | null;
  frame_sharpness: number | null;
  reviewed_at: string | null;
  reviewed_item_id: string | null;
  created_at: string;
  // bounding_box_json is present in DB but not exposed in domain type
  bounding_box_json?: unknown;
  // Migration-added columns
  inventory_item_id?: string | null;
  color_id?: number | null;
  color_name?: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapSession(row: DbScannerSessionRow): ScannerSession {
  return {
    id: row.id,
    user_id: row.user_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status as ScannerSession['status'],
    confidence_threshold: row.confidence_threshold,
    camera_config_json: (row.camera_config_json as Record<string, unknown>) ?? null,
    summary_json: (row.summary_json as ScannerSession['summary_json']) ?? null,
    created_at: row.created_at,
  };
}

function mapPiece(row: DbScannerPieceRow): ScannerPiece {
  return {
    id: row.id,
    session_id: row.session_id,
    part_id: row.brickognize_item_id,
    brickognize_listing_id: row.brickognize_listing_id,
    part_name: row.item_name,
    category: row.item_category,
    confidence_score: row.confidence,
    status: row.status as ScannerPiece['status'],
    top_results_json: (row.top_results_json as ScannerPiece['top_results_json']) ?? null,
    image_path: row.image_path,
    sharpness_score: row.frame_sharpness,
    reviewed_at: row.reviewed_at,
    reviewed_item_id: row.reviewed_item_id,
    created_at: row.created_at,
    inventory_item_id: row.inventory_item_id ?? null,
    color_id: row.color_id ?? null,
    color_name: row.color_name ?? null,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class ScannerRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly supabase: SupabaseClient<any>;

  constructor(supabase: SupabaseClient<Database>) {
    // Cast to any — scanner tables exist in the Database type but BaseRepository
    // requires a strict TableName key; we query directly instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.supabase = supabase as SupabaseClient<any>;
  }

  /**
   * Find scanner sessions with optional filters and pagination.
   * Returns ScannerSessionsResponse (sessions key) to match the UI hook contract.
   */
  async findSessions(
    userId: string,
    filters?: ScannerSessionFilters,
    pagination?: PaginationOptions
  ): Promise<ScannerSessionsResponse> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('scanner_sessions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.dateFrom) {
      query = query.gte('started_at', filters.dateFrom);
    }

    if (filters?.dateTo) {
      query = query.lte('started_at', filters.dateTo);
    }

    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to find scanner sessions: ${error.message}`);
    }

    const total = count ?? 0;
    const rows = (data ?? []) as DbScannerSessionRow[];

    return {
      sessions: rows.map(mapSession),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find a single scanner session by ID, scoped to a user.
   */
  async findSessionById(id: string, userId?: string): Promise<ScannerSession | null> {
    let query = this.supabase
      .from('scanner_sessions')
      .select('*')
      .eq('id', id);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to find scanner session: ${error.message}`);
    }

    return mapSession(data as DbScannerSessionRow);
  }

  /**
   * Find scanner pieces for a session with optional status filter and pagination
   */
  async findPiecesBySessionId(
    sessionId: string,
    filters?: ScannerPieceFilters,
    pagination?: PaginationOptions
  ): Promise<{ data: ScannerPiece[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 100;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('scanner_pieces')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    query = query.range(from, to).order('created_at', { ascending: true });

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to find scanner pieces: ${error.message}`);
    }

    const total = count ?? 0;
    const rows = (data ?? []) as DbScannerPieceRow[];

    return {
      data: rows.map(mapPiece),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find the active scanner session (status is scanning, calibrating, or paused), scoped to a user.
   */
  async findActiveSession(userId?: string): Promise<ScannerSession | null> {
    let query = this.supabase
      .from('scanner_sessions')
      .select('*')
      .in('status', ['scanning', 'calibrating', 'paused']);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find active scanner session: ${error.message}`);
    }

    if (!data) return null;
    return mapSession(data as DbScannerSessionRow);
  }

  /**
   * Count scanner pieces for a session, optionally filtered by status.
   * Uses a head-only count query to avoid fetching row data.
   */
  async countPiecesByStatus(
    sessionId: string,
    status?: string
  ): Promise<{ count: number | null }> {
    let query = this.supabase
      .from('scanner_pieces')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    if (status) {
      query = query.eq('status', status);
    }

    const { count, error } = await query;

    if (error) {
      throw new Error(`Failed to count scanner pieces: ${error.message}`);
    }

    return { count };
  }

  /**
   * Update a piece's review fields (reviewed_item_id, status, reviewed_at)
   */
  async updatePieceReview(
    pieceId: string,
    reviewedItemId: string,
    status: 'accepted' | 'rejected'
  ): Promise<ScannerPiece> {
    const { data, error } = await this.supabase
      .from('scanner_pieces')
      .update({
        reviewed_item_id: reviewedItemId,
        status,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', pieceId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update scanner piece review: ${error.message}`);
    }

    return mapPiece(data as DbScannerPieceRow);
  }
}
