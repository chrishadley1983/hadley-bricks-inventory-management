/**
 * Rebrickable API v3 type definitions
 */

/** Paginated response wrapper from Rebrickable API */
export interface RebrickablePaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Set data from Rebrickable API */
export interface RebrickableSet {
  set_num: string;
  name: string;
  year: number;
  theme_id: number;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
}

/** Theme data from Rebrickable API */
export interface RebrickableTheme {
  id: number;
  name: string;
  parent_id: number | null;
}

/** Minifig data from Rebrickable set minifigs endpoint */
export interface RebrickableSetMinifig {
  id: number;
  set_num: string;
  set_name: string;
  set_img_url: string | null;
  quantity: number;
}

/** Parameters for fetching sets */
export interface RebrickableSetSearchParams {
  page?: number;
  page_size?: number;
  theme_id?: number;
  min_year?: number;
  max_year?: number;
  min_parts?: number;
  max_parts?: number;
  ordering?: string;
  search?: string;
}

/** Sync result statistics */
export interface RebrickableSyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  total_processed: number;
  total_available: number;
  duration_ms: number;
  theme_map_size: number;
}
