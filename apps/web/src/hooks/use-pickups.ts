'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Stock pickup type matching database schema
 */
export interface StockPickup {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postcode: string;
  estimated_value: number | null;
  agreed_price: number | null;
  estimated_duration_minutes: number | null;
  mileage: number | null;
  mileage_cost: number | null;
  source_platform: string | null;
  notes: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | null;
  outcome: 'successful' | 'partial' | 'unsuccessful' | 'rescheduled' | null;
  final_amount_paid: number | null;
  completion_notes: string | null;
  completed_at: string | null;
  is_recurring: boolean | null;
  recurrence_pattern: string | null;
  parent_pickup_id: string | null;
  reminder_day_before: boolean | null;
  purchase_id: string | null;
  task_instance_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePickupInput {
  title: string;
  description?: string | null;
  scheduled_date: string;
  scheduled_time?: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  postcode: string;
  estimated_value?: number | null;
  agreed_price?: number | null;
  estimated_duration_minutes?: number | null;
  source_platform?: string | null;
  notes?: string | null;
  is_recurring?: boolean | null;
  recurrence_pattern?: string | null;
  reminder_day_before?: boolean | null;
}

export interface CompletePickupInput {
  id: string;
  outcome: 'successful' | 'partial' | 'unsuccessful' | 'rescheduled';
  final_amount_paid?: number | null;
  completion_notes?: string | null;
  mileage?: number | null;
}

export interface PickupStats {
  upcoming: number;
  thisWeek: number;
  completedThisMonth: number;
  totalValueThisMonth: number;
}

export interface MonthPickups {
  pickups: StockPickup[];
  month: number;
  year: number;
}

// Query keys
export const pickupKeys = {
  all: ['pickups'] as const,
  lists: () => [...pickupKeys.all, 'list'] as const,
  list: (filters: { month?: number; year?: number; status?: string }) =>
    [...pickupKeys.lists(), filters] as const,
  upcoming: () => [...pickupKeys.all, 'upcoming'] as const,
  detail: (id: string) => [...pickupKeys.all, 'detail', id] as const,
  stats: () => [...pickupKeys.all, 'stats'] as const,
  month: (year: number, month: number) =>
    [...pickupKeys.all, 'month', year, month] as const,
};

/**
 * Fetch pickups for a specific month
 */
async function fetchMonthPickups(
  year: number,
  month: number
): Promise<MonthPickups> {
  const params = new URLSearchParams({
    year: year.toString(),
    month: month.toString(),
  });

  const response = await fetch(`/api/pickups?${params}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pickups');
  }
  const data = await response.json();
  return { pickups: data.pickups, month, year };
}

/**
 * Fetch upcoming pickups (next 7 days)
 */
async function fetchUpcomingPickups(): Promise<StockPickup[]> {
  const response = await fetch('/api/pickups/upcoming');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch upcoming pickups');
  }
  const data = await response.json();
  return data.pickups;
}

/**
 * Fetch pickup stats
 */
async function fetchPickupStats(): Promise<PickupStats> {
  const response = await fetch('/api/pickups/stats');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pickup stats');
  }
  return response.json();
}

/**
 * Create a new pickup
 */
async function createPickup(input: CreatePickupInput): Promise<StockPickup> {
  const response = await fetch('/api/pickups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create pickup');
  }
  const data = await response.json();
  return data.pickup;
}

/**
 * Update a pickup
 */
async function updatePickup(
  id: string,
  input: Partial<CreatePickupInput>
): Promise<StockPickup> {
  const response = await fetch(`/api/pickups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update pickup');
  }
  const data = await response.json();
  return data.pickup;
}

/**
 * Complete a pickup
 */
async function completePickup(input: CompletePickupInput): Promise<StockPickup> {
  const response = await fetch(`/api/pickups/${input.id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to complete pickup');
  }
  const data = await response.json();
  return data.pickup;
}

/**
 * Cancel a pickup
 */
async function cancelPickup(id: string): Promise<StockPickup> {
  const response = await fetch(`/api/pickups/${id}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel pickup');
  }
  const data = await response.json();
  return data.pickup;
}

/**
 * Delete a pickup
 */
async function deletePickup(id: string): Promise<void> {
  const response = await fetch(`/api/pickups/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete pickup');
  }
}

// Hooks

/**
 * Hook to fetch pickups for a specific month
 */
export function useMonthPickups(year: number, month: number) {
  return useQuery({
    queryKey: pickupKeys.month(year, month),
    queryFn: () => fetchMonthPickups(year, month),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch upcoming pickups
 */
export function useUpcomingPickups() {
  return useQuery({
    queryKey: pickupKeys.upcoming(),
    queryFn: fetchUpcomingPickups,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch pickup stats
 */
export function usePickupStats() {
  return useQuery({
    queryKey: pickupKeys.stats(),
    queryFn: fetchPickupStats,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to create a pickup
 */
export function useCreatePickup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPickup,
    onSuccess: (pickup) => {
      // Invalidate relevant queries
      const date = new Date(pickup.scheduled_date);
      queryClient.invalidateQueries({
        queryKey: pickupKeys.month(date.getFullYear(), date.getMonth() + 1),
      });
      queryClient.invalidateQueries({ queryKey: pickupKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.stats() });
    },
  });
}

/**
 * Hook to update a pickup
 */
export function useUpdatePickup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CreatePickupInput>) =>
      updatePickup(id, input),
    onSuccess: (pickup) => {
      // Invalidate relevant queries
      const date = new Date(pickup.scheduled_date);
      queryClient.invalidateQueries({
        queryKey: pickupKeys.month(date.getFullYear(), date.getMonth() + 1),
      });
      queryClient.invalidateQueries({ queryKey: pickupKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.stats() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.detail(pickup.id) });
    },
  });
}

/**
 * Hook to complete a pickup
 */
export function useCompletePickup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completePickup,
    onSuccess: (pickup) => {
      // Invalidate relevant queries
      const date = new Date(pickup.scheduled_date);
      queryClient.invalidateQueries({
        queryKey: pickupKeys.month(date.getFullYear(), date.getMonth() + 1),
      });
      queryClient.invalidateQueries({ queryKey: pickupKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.stats() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.detail(pickup.id) });
    },
  });
}

/**
 * Hook to cancel a pickup
 */
export function useCancelPickup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelPickup,
    onSuccess: (pickup) => {
      // Invalidate relevant queries
      const date = new Date(pickup.scheduled_date);
      queryClient.invalidateQueries({
        queryKey: pickupKeys.month(date.getFullYear(), date.getMonth() + 1),
      });
      queryClient.invalidateQueries({ queryKey: pickupKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.stats() });
      queryClient.invalidateQueries({ queryKey: pickupKeys.detail(pickup.id) });
    },
  });
}

/**
 * Hook to delete a pickup
 */
export function useDeletePickup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePickup,
    onSuccess: () => {
      // Invalidate all pickup queries
      queryClient.invalidateQueries({ queryKey: pickupKeys.all });
    },
  });
}

// Utility functions

/**
 * Format a date for display
 */
export function formatPickupDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Format a time for display
 */
export function formatPickupTime(timeString: string | null): string {
  if (!timeString) return 'Time TBC';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Get status color class
 */
export function getStatusColor(
  status: string | null
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'scheduled':
      return 'default';
    case 'in_progress':
      return 'secondary';
    case 'completed':
      return 'outline';
    case 'cancelled':
      return 'destructive';
    default:
      return 'default';
  }
}

/**
 * Get outcome color class
 */
export function getOutcomeColor(
  outcome: string | null
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (outcome) {
    case 'successful':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'unsuccessful':
      return 'destructive';
    case 'rescheduled':
      return 'outline';
    default:
      return 'default';
  }
}

/**
 * Check if a pickup is today
 */
export function isToday(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a pickup is in the past
 */
export function isPast(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

/**
 * Get days in a month
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Get first day of week for a month (0 = Sunday)
 */
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/**
 * Group pickups by date
 */
export function groupPickupsByDate(
  pickups: StockPickup[]
): Record<string, StockPickup[]> {
  return pickups.reduce(
    (acc, pickup) => {
      const date = pickup.scheduled_date;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(pickup);
      return acc;
    },
    {} as Record<string, StockPickup[]>
  );
}
