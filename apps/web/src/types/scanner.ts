/**
 * Scanner domain types
 *
 * Clean domain types derived from the Supabase scanner_sessions and scanner_pieces tables.
 * Field names on ScannerPiece are mapped from DB column names to more readable aliases
 * (e.g. brickognize_item_id → part_id) to match the UI component conventions.
 */

export interface ScannerSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: 'calibrating' | 'scanning' | 'paused' | 'completed' | 'aborted';
  confidence_threshold: number;
  camera_config_json: Record<string, unknown> | null;
  summary_json: ScannerSessionSummary | null;
  created_at: string;
}

export interface ScannerSessionSummary {
  total_pieces: number;
  accepted_count: number;
  flagged_count: number;
  error_count: number;
  unique_parts: number;
  duration_seconds: number;
  pieces_per_minute: number;
}

/**
 * ScannerPiece uses UI-friendly field names mapped from DB column names:
 *   brickognize_item_id  → part_id
 *   item_name            → part_name
 *   item_category        → category
 *   confidence           → confidence_score
 *   frame_sharpness      → sharpness_score
 */
export interface ScannerPiece {
  id: string;
  session_id: string;
  /** Mapped from brickognize_item_id */
  part_id: string | null;
  /** Mapped from brickognize_listing_id */
  brickognize_listing_id: string | null;
  /** Mapped from item_name */
  part_name: string | null;
  /** Mapped from item_category */
  category: string | null;
  /** Mapped from confidence (0–1 scale) */
  confidence_score: number | null;
  status: 'accepted' | 'flagged' | 'rejected' | 'error';
  top_results_json: BrickognizeCandidate[] | null;
  image_path: string | null;
  /** Mapped from frame_sharpness */
  sharpness_score: number | null;
  reviewed_at: string | null;
  reviewed_item_id: string | null;
  created_at: string;
  /** Links this piece to an inventory_items record */
  inventory_item_id?: string | null;
  /** Color ID from the migration-added color columns */
  color_id?: number | null;
  /** Color name from the migration-added color columns */
  color_name?: string | null;
}

export interface BrickognizeCandidate {
  id?: string;
  part_id?: string;
  name?: string;
  score?: number;
  rank?: number;
  img_url?: string;
  category?: string;
}

export interface ScannerSessionFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface ScannerPieceFilters {
  status?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Response shape for the session list endpoint — uses `sessions` key */
export interface ScannerSessionsResponse {
  sessions: ScannerSession[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Response shape for the session detail endpoint */
export interface ScannerSessionDetailResponse {
  session: ScannerSession;
  pieces: ScannerPiece[];
  pieceTotal: number;
  /** Piece counts keyed by status, plus 'all' for total */
  pieceCounts: {
    all: number;
    accepted: number;
    flagged: number;
    error: number;
    [key: string]: number;
  };
}

/** Options for useScannerSessions hook — flat object including pagination */
export interface ScannerSessionsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/** Options for useScannerSession hook — controls piece pagination and filtering */
export interface ScannerSessionDetailOptions {
  pieceStatus?: string;
  piecePage?: number;
  piecePageSize?: number;
}

export interface ReviewPieceInput {
  reviewed_item_id: string;
  status: 'accepted' | 'rejected';
}

export interface InventoryLinkItem {
  part_id: string;
  part_name: string;
  category: string;
  quantity: number;
  inventory_item_id?: string;
}

export interface LinkInventoryResponse {
  created: number;
  updated: number;
}

// ============================================================================
// Set-Check Types
// ============================================================================

export interface SetCheckPart {
  part_num: string;
  name: string;
  color_id: number;
  color_name: string;
  color_rgb: string;
  bl_color_id: number | null;
  quantity: number;
  is_spare: boolean;
}

export interface SetCheckSession {
  id: string;
  session_id: string;
  set_num: string;
  set_name: string;
  set_year: number | null;
  total_expected: number;
  total_unique: number;
  spare_count: number;
  parts_json: SetCheckPart[];
  created_at: string;
  // Joined from scanner_sessions
  status?: string;
  started_at?: string;
  ended_at?: string;
}

export interface SetCheckProgress {
  id: string;
  set_check_session_id: string;
  part_num: string;
  color_id: number;
  color_name: string;
  expected_qty: number;
  found_qty: number;
  is_spare: boolean;
  updated_at: string;
}

export interface SetCheckSessionsResponse {
  sessions: SetCheckSession[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SetCheckDetailResponse {
  session: SetCheckSession;
  progress: SetCheckProgress[];
}
