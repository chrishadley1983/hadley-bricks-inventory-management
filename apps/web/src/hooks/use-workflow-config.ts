'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Workflow configuration type matching database schema
 */
export interface WorkflowConfig {
  id: string;
  user_id: string;
  // Targets
  target_ebay_listings: number | null;
  target_amazon_listings: number | null;
  target_bricklink_weekly_value: number | null;
  target_daily_listed_value: number | null;
  target_daily_sold_value: number | null;
  // Pomodoro settings
  pomodoro_daily_target: number | null;
  pomodoro_classic_work: number | null;
  pomodoro_classic_break: number | null;
  pomodoro_long_work: number | null;
  pomodoro_long_break: number | null;
  pomodoro_sessions_before_long_break: number | null;
  // Time tracking
  time_categories: TimeCategory[] | null;
  working_days: number | null;
  // Notifications
  notifications_enabled: boolean | null;
  notification_dispatch_hours: number | null;
  notification_overdue_orders: boolean | null;
  notification_sync_failure: boolean | null;
  notification_resolution_threshold: number | null;
  // Audio
  audio_enabled: boolean | null;
  audio_work_complete: string | null;
  audio_break_complete: string | null;
  // Timestamps
  created_at: string | null;
  updated_at: string | null;
}

export interface TimeCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
  isDefault?: boolean;
}

export type UpdateWorkflowConfigInput = Partial<
  Omit<WorkflowConfig, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

/**
 * Weekly insights data
 */
export interface WeeklyInsights {
  timeTracked: {
    total: number;
    byCategory: { name: string; minutes: number; color: string }[];
    trend: number; // percentage change from last week
  };
  pomodoro: {
    completed: number;
    target: number;
    streak: number;
    averagePerDay: number;
  };
  listings: {
    created: number;
    sold: number;
    listedValue: number;
    soldValue: number;
  };
  pickups: {
    completed: number;
    totalSpent: number;
    mileage: number;
  };
  productivity: {
    score: number; // 0-100
    bestDay: string;
    mostProductiveHour: number;
  };
}

// Query keys
export const workflowConfigKeys = {
  all: ['workflow-config'] as const,
  config: () => [...workflowConfigKeys.all, 'config'] as const,
  insights: () => [...workflowConfigKeys.all, 'insights'] as const,
  weeklyInsights: (weekOffset: number) =>
    [...workflowConfigKeys.insights(), 'weekly', weekOffset] as const,
};

// Default configuration values
export const DEFAULT_CONFIG: Partial<WorkflowConfig> = {
  target_ebay_listings: 100,
  target_amazon_listings: 50,
  target_bricklink_weekly_value: 500,
  target_daily_listed_value: 200,
  target_daily_sold_value: 150,
  pomodoro_daily_target: 4,
  pomodoro_classic_work: 25,
  pomodoro_classic_break: 5,
  pomodoro_long_work: 50,
  pomodoro_long_break: 10,
  pomodoro_sessions_before_long_break: 4,
  working_days: 7,
  notifications_enabled: true,
  notification_dispatch_hours: 24,
  notification_overdue_orders: true,
  notification_sync_failure: true,
  notification_resolution_threshold: 10,
  audio_enabled: true,
  time_categories: [
    { id: 'sourcing', name: 'Sourcing', color: '#3B82F6', isDefault: true },
    { id: 'listing', name: 'Listing', color: '#10B981', isDefault: true },
    { id: 'shipping', name: 'Shipping', color: '#F59E0B', isDefault: true },
    { id: 'admin', name: 'Admin', color: '#8B5CF6', isDefault: true },
    { id: 'sorting', name: 'Sorting', color: '#EC4899', isDefault: true },
    { id: 'other', name: 'Other', color: '#6B7280', isDefault: true },
  ],
};

/**
 * Fetch workflow configuration
 */
async function fetchWorkflowConfig(): Promise<WorkflowConfig> {
  const response = await fetch('/api/workflow/config');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch workflow config');
  }
  const data = await response.json();
  return data.config;
}

/**
 * Update workflow configuration
 */
async function updateWorkflowConfig(
  input: UpdateWorkflowConfigInput
): Promise<WorkflowConfig> {
  const response = await fetch('/api/workflow/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update workflow config');
  }
  const data = await response.json();
  return data.config;
}

/**
 * Fetch weekly insights
 */
async function fetchWeeklyInsights(weekOffset: number): Promise<WeeklyInsights> {
  const response = await fetch(`/api/workflow/insights?weekOffset=${weekOffset}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch weekly insights');
  }
  return response.json();
}

// Hooks

/**
 * Hook to fetch workflow configuration
 */
export function useWorkflowConfig() {
  return useQuery({
    queryKey: workflowConfigKeys.config(),
    queryFn: fetchWorkflowConfig,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to update workflow configuration
 */
export function useUpdateWorkflowConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateWorkflowConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(workflowConfigKeys.config(), config);
      // Also invalidate metrics as targets may have changed
      queryClient.invalidateQueries({ queryKey: ['workflow', 'metrics'] });
    },
  });
}

/**
 * Hook to fetch weekly insights
 */
export function useWeeklyInsights(weekOffset: number = 0) {
  return useQuery({
    queryKey: workflowConfigKeys.weeklyInsights(weekOffset),
    queryFn: () => fetchWeeklyInsights(weekOffset),
    staleTime: 300000, // 5 minutes
  });
}

// Utility functions

/**
 * Format minutes as hours and minutes string
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Get productivity score description
 */
export function getProductivityLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Improvement';
}

/**
 * Get productivity score color
 */
export function getProductivityColor(score: number): string {
  if (score >= 90) return 'text-green-500';
  if (score >= 75) return 'text-emerald-500';
  if (score >= 60) return 'text-blue-500';
  if (score >= 40) return 'text-amber-500';
  return 'text-red-500';
}

/**
 * Calculate percentage change
 */
export function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}
