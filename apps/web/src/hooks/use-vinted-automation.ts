/**
 * React hooks for Vinted scanner automation
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// =============================================================================
// TYPES
// =============================================================================

export interface ScannerConfig {
  id: string;
  enabled: boolean;
  paused: boolean;
  pause_reason: string | null;
  broad_sweep_cog_threshold: number;
  watchlist_cog_threshold: number;
  near_miss_threshold: number;
  operating_hours_start: string;
  operating_hours_end: string;
  consecutive_failures: number;
  // Recovery mode (DataDome hardening)
  recovery_mode: boolean;
  recovery_rate_percent: number;
  captcha_detected_at: string | null;
  captcha_count_30d: number;
}

export interface TodayStats {
  broadSweeps: number;
  watchlistScans: number;
  opportunitiesFound: number;
  lastScanAt: string | null;
}

export interface ScannerStatus {
  config: ScannerConfig | null;
  todayStats: TodayStats;
  lastScan: {
    id: string;
    scan_type: string;
    status: string;
    listings_found: number;
    opportunities_found: number;
    completed_at: string;
  } | null;
}

export interface Opportunity {
  id: string;
  vinted_listing_id: string;
  vinted_url: string;
  set_number: string;
  set_name: string | null;
  vinted_price: number;
  amazon_price: number | null;
  asin: string | null;
  cog_percent: number | null;
  estimated_profit: number | null;
  status: 'active' | 'purchased' | 'expired' | 'dismissed';
  found_at: string;
  expires_at: string;
}

export interface ScanLogEntry {
  id: string;
  scan_type: 'broad_sweep' | 'watchlist';
  set_number: string | null;
  status: 'success' | 'failed' | 'partial' | 'captcha';
  listings_found: number;
  opportunities_found: number;
  error_message: string | null;
  timing_delay_ms: number | null;
  completed_at: string | null;
  created_at: string;
  scan_results?: unknown; // JSONB field with processed listings and summary
}

export interface WatchlistItem {
  id: string;
  set_number: string;
  asin: string | null;
  source: 'best_seller' | 'popular_retired';
  sales_rank: number | null;
  stats?: {
    total_scans: number;
    listings_found: number;
    viable_found: number;
    near_miss_found: number;
    last_listing_at: string | null;
    last_viable_at: string | null;
  };
}

// =============================================================================
// QUERY KEYS
// =============================================================================

export const vintedAutomationKeys = {
  all: ['vinted-automation'] as const,
  status: () => [...vintedAutomationKeys.all, 'status'] as const,
  opportunities: (filters?: OpportunityFilters) =>
    [...vintedAutomationKeys.all, 'opportunities', filters] as const,
  scanHistory: (filters?: ScanHistoryFilters) =>
    [...vintedAutomationKeys.all, 'scan-history', filters] as const,
  watchlist: () => [...vintedAutomationKeys.all, 'watchlist'] as const,
  schedule: (date?: string) => [...vintedAutomationKeys.all, 'schedule', date] as const,
};

// =============================================================================
// FILTERS
// =============================================================================

export interface OpportunityFilters {
  status?: 'active' | 'purchased' | 'expired' | 'dismissed';
  limit?: number;
}

export interface ScanHistoryFilters {
  scanType?: 'broad_sweep' | 'watchlist';
  status?: 'success' | 'failed' | 'partial' | 'captcha';
  limit?: number;
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchScannerStatus(): Promise<ScannerStatus> {
  const response = await fetch('/api/arbitrage/vinted/automation');
  if (!response.ok) {
    throw new Error('Failed to fetch scanner status');
  }
  return response.json();
}

async function updateScannerConfig(
  config: Partial<ScannerConfig>
): Promise<{ config: ScannerConfig }> {
  const response = await fetch('/api/arbitrage/vinted/automation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update config');
  }
  return response.json();
}

async function pauseScanner(reason?: string): Promise<{ success: boolean }> {
  const response = await fetch('/api/arbitrage/vinted/automation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pause', reason }),
  });
  if (!response.ok) {
    throw new Error('Failed to pause scanner');
  }
  return response.json();
}

async function resumeScanner(): Promise<{ success: boolean }> {
  const response = await fetch('/api/arbitrage/vinted/automation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resume' }),
  });
  if (!response.ok) {
    throw new Error('Failed to resume scanner');
  }
  return response.json();
}

async function fetchOpportunities(
  filters: OpportunityFilters = {}
): Promise<{ opportunities: Opportunity[] }> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit.toString());

  const response = await fetch(`/api/arbitrage/vinted/automation/opportunities?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch opportunities');
  }
  return response.json();
}

async function updateOpportunityStatus(
  id: string,
  status: Opportunity['status']
): Promise<{ opportunity: Opportunity }> {
  const response = await fetch(`/api/arbitrage/vinted/automation/opportunities/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error('Failed to update opportunity');
  }
  return response.json();
}

async function fetchScanHistory(
  filters: ScanHistoryFilters = {}
): Promise<{ scans: ScanLogEntry[] }> {
  const params = new URLSearchParams();
  if (filters.scanType) params.set('scanType', filters.scanType);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit.toString());

  const response = await fetch(`/api/arbitrage/vinted/automation/history?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch scan history');
  }
  return response.json();
}

async function fetchWatchlist(): Promise<{ items: WatchlistItem[] }> {
  const response = await fetch('/api/arbitrage/vinted/watchlist');
  if (!response.ok) {
    throw new Error('Failed to fetch watchlist');
  }
  return response.json();
}

async function refreshWatchlist(): Promise<{
  success: boolean;
  added: number;
  removed: number;
}> {
  const response = await fetch('/api/arbitrage/vinted/watchlist/refresh', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to refresh watchlist');
  }
  return response.json();
}

export interface ScheduledScan {
  id: string;
  scheduledTime: string;
  type: 'broad_sweep' | 'watchlist';
  setNumber?: string;
  setName?: string;
}

export interface ScheduleResponse {
  date: string;
  generatedAt: string;
  scheduleVersion: number;
  operatingHours: {
    start: string;
    end: string;
  };
  scans: ScheduledScan[];
}

type RegenerateScheduleResponse = ScheduleResponse;

async function regenerateSchedule(startInMinutes: number = 2): Promise<RegenerateScheduleResponse> {
  const response = await fetch('/api/arbitrage/vinted/automation/regenerate-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startInMinutes }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to regenerate schedule');
  }
  return response.json();
}

async function fetchSchedule(date?: string): Promise<ScheduleResponse> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);

  const response = await fetch(`/api/arbitrage/vinted/automation/schedule/web?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch schedule');
  }
  return response.json();
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Fetch scanner status including config and today's stats
 */
export function useScannerStatus() {
  return useQuery({
    queryKey: vintedAutomationKeys.status(),
    queryFn: fetchScannerStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

/**
 * Update scanner configuration
 */
export function useUpdateScannerConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateScannerConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.status(),
      });
    },
  });
}

/**
 * Pause the scanner
 */
export function usePauseScanner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: pauseScanner,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.status(),
      });
    },
  });
}

/**
 * Resume the scanner
 */
export function useResumeScanner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resumeScanner,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.status(),
      });
    },
  });
}

/**
 * Fetch opportunities
 */
export function useOpportunities(filters: OpportunityFilters = {}) {
  return useQuery({
    queryKey: vintedAutomationKeys.opportunities(filters),
    queryFn: () => fetchOpportunities(filters),
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Update opportunity status (purchased, dismissed, etc.)
 */
export function useUpdateOpportunityStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Opportunity['status'] }) =>
      updateOpportunityStatus(id, status),
    onSuccess: () => {
      // Invalidate ALL opportunity queries regardless of filters
      queryClient.invalidateQueries({
        queryKey: ['vinted-automation', 'opportunities'],
      });
    },
  });
}

/**
 * Fetch scan history
 */
export function useScanHistory(filters: ScanHistoryFilters = {}) {
  return useQuery({
    queryKey: vintedAutomationKeys.scanHistory(filters),
    queryFn: () => fetchScanHistory(filters),
  });
}

/**
 * Fetch watchlist
 */
export function useWatchlist() {
  return useQuery({
    queryKey: vintedAutomationKeys.watchlist(),
    queryFn: fetchWatchlist,
  });
}

/**
 * Refresh watchlist from Amazon best sellers
 */
export function useRefreshWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refreshWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.watchlist(),
      });
    },
  });
}

/**
 * Regenerate the scanner schedule starting from NOW
 * Useful when starting the scanner late in the day
 */
export function useRegenerateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (startInMinutes?: number) => regenerateSchedule(startInMinutes),
    onSuccess: () => {
      // Invalidate status and schedule to pick up new schedule
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.status(),
      });
      queryClient.invalidateQueries({
        queryKey: vintedAutomationKeys.schedule(),
      });
    },
  });
}

/**
 * Fetch the scan schedule for a specific date
 */
export function useSchedule(date?: string) {
  return useQuery({
    queryKey: vintedAutomationKeys.schedule(date),
    queryFn: () => fetchSchedule(date),
    refetchInterval: 60000, // Refresh every minute
  });
}
