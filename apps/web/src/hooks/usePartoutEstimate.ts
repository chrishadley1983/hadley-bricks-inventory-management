/**
 * usePartoutEstimate Hook
 *
 * What a part-out run would cost in BrickLink calls, before running it. The single-screen
 * Set Lookup no longer has a tab to hide the run behind, so the run has to be an explicit
 * choice — and the cost is what makes it an informed one.
 *
 * The estimate itself costs one BrickLink call (getSubsets), which is why it is cached for
 * the session rather than re-fetched on every render.
 */

import { useQuery } from '@tanstack/react-query';

export interface PartoutEstimate {
  setNumber: string;
  totalLots: number;
  cachedLots: number;
  uncachedLots: number;
  /** BrickLink calls a full run would make from here (4 quadrants per uncached lot). */
  estimatedApiCalls: number;
}

export const partoutEstimateKeys = {
  all: ['partout-estimate'] as const,
  detail: (setNumber: string) => [...partoutEstimateKeys.all, setNumber] as const,
};

async function fetchEstimate(setNumber: string): Promise<PartoutEstimate> {
  const response = await fetch(
    `/api/bricklink/partout/estimate?${new URLSearchParams({ setNumber })}`
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to estimate part-out cost');
  }
  const result: { data: PartoutEstimate } = await response.json();
  return result.data;
}

export function usePartoutEstimate(setNumber: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: partoutEstimateKeys.detail(setNumber || ''),
    queryFn: () => {
      if (!setNumber) throw new Error('Set number is required');
      return fetchEstimate(setNumber);
    },
    enabled: enabled && !!setNumber,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
}
