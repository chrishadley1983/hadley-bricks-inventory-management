/**
 * React Query hooks for MTD export functionality
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MtdBasis, MtdExportPreview, MtdExportResponse } from '@/types/mtd-export';

/**
 * Query key factory for MTD export
 */
export const mtdExportKeys = {
  all: ['mtd-export'] as const,
  preview: (startMonth: string, endMonth: string, basis: MtdBasis) =>
    [...mtdExportKeys.all, 'preview', startMonth, endMonth, basis] as const,
  history: () => [...mtdExportKeys.all, 'history'] as const,
};

/**
 * Fetch export preview for a period
 */
async function fetchExportPreview(
  startMonth: string,
  endMonth: string,
  basis: MtdBasis
): Promise<MtdExportPreview> {
  const response = await fetch(
    `/api/reports/mtd-export?startMonth=${startMonth}&endMonth=${endMonth}&basis=${basis}`
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
async function exportCsv(startMonth: string, endMonth: string, basis: MtdBasis): Promise<void> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startMonth, endMonth, action: 'csv', basis }),
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

  // Generate filename based on period and basis (mirrors the server ZIP name)
  const basisSuffix = basis === 'cash' ? '-cash' : '';
  const filename =
    startMonth === endMonth
      ? `quickfile-${startMonth}${basisSuffix}.zip`
      : `quickfile-${startMonth}-to-${endMonth}${basisSuffix}.zip`;

  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Push data to QuickFile
 */
async function pushToQuickFile(
  startMonth: string,
  endMonth: string,
  basis: MtdBasis
): Promise<MtdExportResponse> {
  const response = await fetch('/api/reports/mtd-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startMonth, endMonth, action: 'quickfile', basis }),
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
export function useMtdExportPreview(
  startMonth: string | undefined,
  endMonth: string | undefined,
  basis: MtdBasis = 'accrual'
) {
  return useQuery({
    queryKey: mtdExportKeys.preview(startMonth || '', endMonth || '', basis),
    queryFn: () => fetchExportPreview(startMonth!, endMonth!, basis),
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
    mutationFn: ({
      startMonth,
      endMonth,
      basis = 'accrual',
    }: {
      startMonth: string;
      endMonth: string;
      basis?: MtdBasis;
    }) => exportCsv(startMonth, endMonth, basis),
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
    mutationFn: ({
      startMonth,
      endMonth,
      basis = 'accrual',
    }: {
      startMonth: string;
      endMonth: string;
      basis?: MtdBasis;
    }) => pushToQuickFile(startMonth, endMonth, basis),
    onSuccess: (_, variables) => {
      // Invalidate history queries and preview for this period
      queryClient.invalidateQueries({ queryKey: mtdExportKeys.history() });
      queryClient.invalidateQueries({
        queryKey: mtdExportKeys.preview(
          variables.startMonth,
          variables.endMonth,
          variables.basis ?? 'accrual'
        ),
      });
    },
  });
}
