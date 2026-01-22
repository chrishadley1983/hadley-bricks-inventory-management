'use client';

import { useQuery } from '@tanstack/react-query';

// Types
export interface MetricData {
  current: number;
  target: number;
  history: number[]; // Last 7 days
}

export interface ListingCounts {
  ebay: number;
  amazon: number;
  bricklink: number;
  brickowl: number;
}

export interface WeeklyMetrics {
  listingCounts: ListingCounts;
  dailyListingCounts: ListingCounts;
  bricklinkWeeklyValue: MetricData;
  dailyListedValue: MetricData;
  dailySoldValue: MetricData;
  weekTotals: {
    listedValue: number;
    soldValue: number;
    listedCount: number;
    soldCount: number;
  };
  targets: {
    ebayListings: number;
    amazonListings: number;
    bricklinkWeeklyValue: number;
    dailyListedValue: number;
    dailySoldValue: number;
  };
}

// Query keys
export const metricsKeys = {
  all: ['metrics'] as const,
  weekly: () => [...metricsKeys.all, 'weekly'] as const,
  listingCounts: () => [...metricsKeys.all, 'listing-counts'] as const,
};

// API functions
async function fetchWeeklyMetrics(): Promise<WeeklyMetrics> {
  const response = await fetch('/api/workflow/metrics');
  if (!response.ok) {
    throw new Error('Failed to fetch metrics');
  }
  return response.json();
}

async function fetchListingCounts(): Promise<ListingCounts> {
  const response = await fetch('/api/inventory/listing-counts');
  if (!response.ok) {
    throw new Error('Failed to fetch listing counts');
  }
  return response.json();
}

// Hooks
export function useWeeklyMetrics() {
  return useQuery({
    queryKey: metricsKeys.weekly(),
    queryFn: fetchWeeklyMetrics,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 300000, // Refetch every 5 minutes
  });
}

export function useListingCounts() {
  return useQuery({
    queryKey: metricsKeys.listingCounts(),
    queryFn: fetchListingCounts,
    staleTime: 60000,
    refetchInterval: 300000,
  });
}

// Utility functions
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

export function getProgressPercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

export function getGapText(current: number, target: number, isCurrency = false): string {
  const gap = target - current;
  const formatter = isCurrency ? formatCurrency : formatNumber;

  if (gap > 0) {
    return `${formatter(gap)} to go`;
  } else if (gap < 0) {
    return `${formatter(Math.abs(gap))} ahead`;
  }
  return 'Target met!';
}

export function getProgressColor(percentage: number): string {
  if (percentage >= 100) return 'hsl(142.1 76.2% 36.3%)'; // Green
  if (percentage >= 75) return 'hsl(142.1 76.2% 36.3%)'; // Green
  if (percentage >= 50) return 'hsl(47.9 95.8% 53.1%)'; // Yellow
  if (percentage >= 25) return 'hsl(24.6 95% 53.1%)'; // Orange
  return 'hsl(0 84.2% 60.2%)'; // Red
}
