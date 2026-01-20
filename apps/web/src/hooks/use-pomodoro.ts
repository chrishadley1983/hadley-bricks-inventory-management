'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types
export type PomodoroMode = 'classic' | 'long' | 'custom';
export type PomodoroStatus = 'work' | 'break' | 'completed' | 'cancelled' | 'paused';

export interface PomodoroSession {
  id: string;
  userId: string;
  sessionDate: string;
  sessionNumber: number;
  mode: PomodoroMode;
  workMinutes: number;
  breakMinutes: number;
  startedAt: string;
  workCompletedAt: string | null;
  breakCompletedAt: string | null;
  pausedAt: string | null;
  pausedDurationSeconds: number;
  status: PomodoroStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PomodoroStats {
  sessionsToday: number;
  dailyTarget: number;
  streakDays: number;
}

export interface CurrentPomodoroResponse {
  session: PomodoroSession | null;
  remainingSeconds: number;
  phaseEndTime: string | null;
}

// Query keys
export const pomodoroKeys = {
  all: ['pomodoro'] as const,
  current: () => [...pomodoroKeys.all, 'current'] as const,
  stats: () => [...pomodoroKeys.all, 'stats'] as const,
};

// Mode configurations
export const POMODORO_MODES = {
  classic: { work: 25, break: 5, label: 'Classic (25/5)' },
  long: { work: 50, break: 10, label: 'Long (50/10)' },
  custom: { work: 25, break: 5, label: 'Custom' },
} as const;

// API functions
async function fetchCurrentSession(): Promise<CurrentPomodoroResponse> {
  const response = await fetch('/api/pomodoro/current');
  if (!response.ok) {
    throw new Error('Failed to fetch current session');
  }
  return response.json();
}

async function fetchStats(): Promise<PomodoroStats> {
  const response = await fetch('/api/pomodoro/stats');
  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }
  return response.json();
}

async function startSession(params: {
  mode: PomodoroMode;
  workMinutes?: number;
  breakMinutes?: number;
}): Promise<{ session: PomodoroSession }> {
  const response = await fetch('/api/pomodoro/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start session');
  }
  return response.json();
}

async function completePhase(): Promise<{ session: PomodoroSession }> {
  const response = await fetch('/api/pomodoro/complete-phase', {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to complete phase');
  }
  return response.json();
}

async function pauseSession(): Promise<{ session: PomodoroSession }> {
  const response = await fetch('/api/pomodoro/pause', {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to pause session');
  }
  return response.json();
}

async function resumeSession(): Promise<{ session: PomodoroSession }> {
  const response = await fetch('/api/pomodoro/resume', {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to resume session');
  }
  return response.json();
}

async function cancelSession(): Promise<{ session: PomodoroSession }> {
  const response = await fetch('/api/pomodoro/cancel', {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel session');
  }
  return response.json();
}

// Hooks
export function useCurrentPomodoro() {
  return useQuery({
    queryKey: pomodoroKeys.current(),
    queryFn: fetchCurrentSession,
    refetchInterval: 1000, // Refetch every second to keep UI in sync
  });
}

export function usePomodoroStats() {
  return useQuery({
    queryKey: pomodoroKeys.stats(),
    queryFn: fetchStats,
    staleTime: 30000, // Cache for 30 seconds
  });
}

export function useStartPomodoro() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: startSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.current() });
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.stats() });
    },
  });
}

export function useCompletePhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completePhase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.current() });
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.stats() });
    },
  });
}

export function usePausePomodoro() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: pauseSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.current() });
    },
  });
}

export function useResumePomodoro() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resumeSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.current() });
    },
  });
}

export function useCancelPomodoro() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.current() });
      queryClient.invalidateQueries({ queryKey: pomodoroKeys.stats() });
    },
  });
}

// Utility functions
export function formatPomodoroTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function getPhaseLabel(status: PomodoroStatus): string {
  switch (status) {
    case 'work':
      return 'Working';
    case 'break':
      return 'Break Time';
    case 'paused':
      return 'Paused';
    default:
      return '';
  }
}
