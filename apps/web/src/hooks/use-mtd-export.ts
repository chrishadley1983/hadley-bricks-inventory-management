/**
 * React Query hooks for MTD export functionality
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MtdExportPreview, MtdExportResponse } from '@/types/mtd-export';

/**
 * Query key factory for MTD export
 */
export const mtdExportKeys = {
  all: ['mtd-export'] as const,
  preview: (startMonth: string, endMonth: string) =>
    [...mtdExportKeys.all, 'preview', startMonth, endMonth] as const,
  history: () => [...mtdExportKeys.all, 'history'] as const,
};

/**
 * Fetch export preview for a period
 */
async function fetchExportPreview(startMonth: string, endMonth: string): Promise<MtdExportPreview> {
  const response = await fetch(
    `/api/reports/mtd-export?startMonth=${startMonth}&endMonth=${endMonth}`
  );

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch export preview');
  }

  return response.json();
}

/**
 * Export CSV for a period
 */
async function exportCsv(startMonth: string, endMonth: string): Promise<void> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startMonth, endMonth, action: 'csv' }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to export CSV');
  }

  // Download the ZIP file
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  // Generate filename based on period
  const filename =
    startMonth === endMonth
      ? `quickfile-${startMonth}.zip`
      : `quickfile-${startMonth}-to-${endMonth}.zip`;

  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Push data to QuickFile
 */
async function pushToQuickFile(startMonth: string, endMonth: string): Promise<MtdExportResponse> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startMonth, endMonth, action: 'quickfile' }),
  });

  const data = await response.json();

  if (!response.ok) {
    // Check for specific error types
    if (data.needsCredentials) {
      throw new Error('NEEDS_CREDENTIALS');
    }
    if (data.isEmpty) {
      throw new Error(data.error);
    }
    throw new Error(data.error || 'Failed to push to QuickFile');
  }

  return data;
}

/**
 * Hook to fetch export preview
 */
export function useMtdExportPreview(startMonth: string | undefined, endMonth: string | undefined) {
  return useQuery({
    queryKey: mtdExportKeys.preview(startMonth || '', endMonth || ''),
    queryFn: () => fetchExportPreview(startMonth!, endMonth!),
    enabled: !!startMonth && !!endMonth,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to export CSV
 */
export function useMtdExportCsv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ startMonth, endMonth }: { startMonth: string; endMonth: string }) =>
      exportCsv(startMonth, endMonth),
    onSuccess: () => {
      // Invalidate history queries
      queryClient.invalidateQueries({ queryKey: mtdExportKeys.history() });
    },
  });
}

/**
 * Hook to push to QuickFile
 */
export function useMtdExportQuickFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ startMonth, endMonth }: { startMonth: string; endMonth: string }) =>
      pushToQuickFile(startMonth, endMonth),
    onSuccess: (_, variables) => {
      // Invalidate history queries and preview for this period
      queryClient.invalidateQueries({ queryKey: mtdExportKeys.history() });
      queryClient.invalidateQueries({
        queryKey: mtdExportKeys.preview(variables.startMonth, variables.endMonth),
      });
    },
  });
}
