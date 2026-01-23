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
  preview: (month: string) => [...mtdExportKeys.all, 'preview', month] as const,
  history: () => [...mtdExportKeys.all, 'history'] as const,
};

/**
 * Fetch export preview for a month
 */
async function fetchExportPreview(month: string): Promise<MtdExportPreview> {
  const response = await fetch(`/api/reports/mtd-export?month=${month}`);

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch export preview');
  }

  return response.json();
}

/**
 * Export CSV for a month
 */
async function exportCsv(month: string): Promise<void> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ month, action: 'csv' }),
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
  a.download = `quickfile-${month}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Push data to QuickFile
 */
async function pushToQuickFile(month: string): Promise<MtdExportResponse> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ month, action: 'quickfile' }),
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
export function useMtdExportPreview(month: string | undefined) {
  return useQuery({
    queryKey: mtdExportKeys.preview(month || ''),
    queryFn: () => fetchExportPreview(month!),
    enabled: !!month,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to export CSV
 */
export function useMtdExportCsv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ month }: { month: string }) => exportCsv(month),
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
    mutationFn: ({ month }: { month: string }) => pushToQuickFile(month),
    onSuccess: (_, variables) => {
      // Invalidate history queries and preview for this month
      queryClient.invalidateQueries({ queryKey: mtdExportKeys.history() });
      queryClient.invalidateQueries({ queryKey: mtdExportKeys.preview(variables.month) });
    },
  });
}
