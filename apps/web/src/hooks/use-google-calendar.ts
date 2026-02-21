/**
 * Google Calendar React Hooks
 *
 * Provides hooks for checking Google Calendar connection status
 * and syncing pickups to Google Calendar.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GoogleCalendarConnectionStatus } from '@/lib/google-calendar';

// ============================================================================
// Query Keys
// ============================================================================

export const googleCalendarKeys = {
  all: ['google-calendar'] as const,
  status: () => [...googleCalendarKeys.all, 'status'] as const,
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchConnectionStatus(): Promise<GoogleCalendarConnectionStatus> {
  const response = await fetch('/api/integrations/google-calendar/status');
  if (!response.ok) {
    throw new Error('Failed to fetch Google Calendar status');
  }
  return response.json();
}

async function connectGoogleCalendar(returnUrl?: string): Promise<{ authUrl: string }> {
  const response = await fetch('/api/integrations/google-calendar/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnUrl }),
  });
  if (!response.ok) {
    throw new Error('Failed to get authorization URL');
  }
  return response.json();
}

async function disconnectGoogleCalendar(): Promise<void> {
  const response = await fetch('/api/integrations/google-calendar/disconnect', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to disconnect Google Calendar');
  }
}

async function syncPickupToCalendar(
  pickupId: string
): Promise<{ eventId: string; message: string }> {
  const response = await fetch(`/api/pickups/${pickupId}/calendar`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to sync to calendar');
  }
  return response.json();
}

async function removePickupFromCalendar(pickupId: string): Promise<void> {
  const response = await fetch(`/api/pickups/${pickupId}/calendar`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove from calendar');
  }
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get Google Calendar connection status
 */
export function useGoogleCalendarStatus() {
  return useQuery({
    queryKey: googleCalendarKeys.status(),
    queryFn: fetchConnectionStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to connect to Google Calendar
 * Returns a mutation that gets the auth URL, then navigates to it
 */
export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: async (returnUrl?: string) => {
      const { authUrl } = await connectGoogleCalendar(returnUrl);
      // Navigate to Google OAuth
      window.location.href = authUrl;
    },
    onError: (error) => {
      console.error('[useConnectGoogleCalendar] Error:', error);
    },
  });
}

/**
 * Hook to disconnect from Google Calendar
 */
export function useDisconnectGoogleCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: googleCalendarKeys.status() });
    },
  });
}

/**
 * Hook to sync a pickup to Google Calendar
 */
export function useSyncPickupToCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncPickupToCalendar,
    onSuccess: () => {
      // Invalidate pickups queries to reflect the new calendar event ID
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
    },
  });
}

/**
 * Hook to remove a pickup from Google Calendar
 */
export function useRemovePickupFromCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removePickupFromCalendar,
    onSuccess: () => {
      // Invalidate pickups queries to reflect the removed calendar event
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
    },
  });
}
