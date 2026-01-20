import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types
// ============================================================================

export type TimeCategory = 'Development' | 'Listing' | 'Shipping' | 'Sourcing' | 'Admin' | 'Other';

export interface TimeEntry {
  id: string;
  userId: string;
  category: TimeCategory;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  isPaused: boolean;
  pausedDurationSeconds: number;
  taskInstanceId: string | null;
  notes: string | null;
  isManualEntry: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentEntryResponse {
  entry: {
    id: string;
    category: TimeCategory;
    startedAt: string;
    elapsedSeconds: number;
    isPaused: boolean;
    pausedDurationSeconds: number;
  } | null;
}

export interface TimeSummary {
  today: {
    total: number;
    byCategory: Record<TimeCategory, number>;
  };
  week: {
    total: number;
    byCategory: Record<TimeCategory, number>;
  };
}

export interface TimeEntriesResponse {
  entries: TimeEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateManualEntryInput {
  category: TimeCategory;
  startedAt: string;
  endedAt: string;
  notes?: string;
}

export interface UpdateEntryInput {
  category?: TimeCategory;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
}

// ============================================================================
// Query Keys
// ============================================================================

export const timeTrackingKeys = {
  all: ['time-tracking'] as const,
  current: () => [...timeTrackingKeys.all, 'current'] as const,
  summary: () => [...timeTrackingKeys.all, 'summary'] as const,
  entries: () => [...timeTrackingKeys.all, 'entries'] as const,
  entriesFiltered: (filters: { dateFrom?: string; dateTo?: string; category?: TimeCategory; page?: number }) =>
    [...timeTrackingKeys.entries(), filters] as const,
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get the currently active time entry (if any)
 */
export function useCurrentTimeEntry() {
  return useQuery({
    queryKey: timeTrackingKeys.current(),
    queryFn: async (): Promise<CurrentEntryResponse> => {
      const response = await fetch('/api/time-tracking/current');
      if (!response.ok) {
        throw new Error('Failed to fetch current time entry');
      }
      return response.json();
    },
    refetchInterval: 1000, // Refetch every second for timer updates
    staleTime: 0, // Always consider stale for real-time updates
  });
}

/**
 * Get time tracking summary (today and week totals)
 */
export function useTimeSummary() {
  return useQuery({
    queryKey: timeTrackingKeys.summary(),
    queryFn: async (): Promise<TimeSummary> => {
      const response = await fetch('/api/time-tracking/summary');
      if (!response.ok) {
        throw new Error('Failed to fetch time summary');
      }
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Get paginated time entries with optional filters
 */
export function useTimeEntries(filters: {
  dateFrom?: string;
  dateTo?: string;
  category?: TimeCategory;
  page?: number;
  limit?: number;
} = {}) {
  return useQuery({
    queryKey: timeTrackingKeys.entriesFiltered(filters),
    queryFn: async (): Promise<TimeEntriesResponse> => {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.category) params.set('category', filters.category);
      if (filters.page) params.set('page', filters.page.toString());
      if (filters.limit) params.set('limit', filters.limit.toString());

      const response = await fetch(`/api/time-tracking/entries?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch time entries');
      }
      return response.json();
    },
    staleTime: 30 * 1000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Start tracking time with a category
 */
export function useStartTimeTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (category: TimeCategory) => {
      const response = await fetch('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start time tracking');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.current() });
    },
  });
}

/**
 * Stop the current time tracking session
 */
export function useStopTimeTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/time-tracking/stop', {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop time tracking');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.current() });
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.summary() });
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.entries() });
    },
  });
}

/**
 * Pause the current time tracking session
 */
export function usePauseTimeTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/time-tracking/pause', {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to pause time tracking');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.current() });
    },
  });
}

/**
 * Resume a paused time tracking session
 */
export function useResumeTimeTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/time-tracking/resume', {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to resume time tracking');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.current() });
    },
  });
}

/**
 * Create a manual time entry
 */
export function useCreateManualEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateManualEntryInput) => {
      const response = await fetch('/api/time-tracking/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create manual entry');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.summary() });
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.entries() });
    },
  });
}

/**
 * Update an existing time entry
 */
export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateEntryInput & { id: string }) => {
      const response = await fetch(`/api/time-tracking/entries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update time entry');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.summary() });
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.entries() });
    },
  });
}

/**
 * Delete a time entry
 */
export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/time-tracking/entries/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete time entry');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.summary() });
      queryClient.invalidateQueries({ queryKey: timeTrackingKeys.entries() });
    },
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format seconds to HH:MM:SS display
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Format seconds to timer display (HH:MM:SS or MM:SS)
 */
export function formatTimer(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Get category color for display
 */
export function getCategoryColor(category: TimeCategory): string {
  const colors: Record<TimeCategory, string> = {
    Development: '#3b82f6', // blue
    Listing: '#10b981', // green
    Shipping: '#f59e0b', // amber
    Sourcing: '#8b5cf6', // purple
    Admin: '#6b7280', // gray
    Other: '#ec4899', // pink
  };
  return colors[category];
}
