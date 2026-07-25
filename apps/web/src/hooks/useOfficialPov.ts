/**
 * useOfficialPov Hook
 *
 * BrickLink's own Part Out Value (the figure BL publishes on the catalogue page),
 * read from `bricklink_part_out_value_cache` via /api/bricklink/part-out-value.
 *
 * This is a CROSS-CHECK on the computed assessment, not a rival decision figure —
 * see `OfficialPovCard` for the reconciliation. The hook is shared so the card and
 * anything else reading the official row hit one query cache entry, and so the
 * condition can be driven by the Partout tab's single New/Used toggle rather than
 * a second toggle of its own.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartoutCondition } from '@/types/partout';

export interface OfficialPovRow {
  set_name: string | null;
  native_currency: string | null;
  sold_6mo_native: number | string | null;
  sold_6mo_avg_gbp: number | string | null;
  sold_6mo_items: number | null;
  sold_6mo_lots: number | null;
  for_sale_native: number | string | null;
  for_sale_avg_gbp: number | string | null;
  uk_retail_gbp: number | string | null;
  partout_multiple: number | string | null;
  is_aggregate_listing: boolean | null;
  fetched_at: string;
}

export interface OfficialPovGetResponse {
  found: boolean;
  isFresh?: boolean;
  ageMs?: number;
  row?: OfficialPovRow;
}

export interface OfficialPovPostResponse {
  scraped: boolean;
  cdpReachable?: boolean;
  note?: string;
  row?: OfficialPovRow | null;
}

/** BL's API condition codes. The tab speaks 'new' | 'used'; the route speaks 'N' | 'U'. */
export const toBlCondition = (condition: PartoutCondition): 'N' | 'U' =>
  condition === 'new' ? 'N' : 'U';

export const officialPovQueryKey = (setNumber: string | null, condition: PartoutCondition) => [
  'official-pov',
  setNumber,
  toBlCondition(condition),
];

async function fetchOfficialPov(
  setNumber: string,
  condition: PartoutCondition
): Promise<OfficialPovGetResponse> {
  const params = new URLSearchParams({ set: setNumber, condition: toBlCondition(condition) });
  const res = await fetch(`/api/bricklink/part-out-value?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load POV (${res.status})`);
  return (await res.json()).data as OfficialPovGetResponse;
}

async function refreshOfficialPov(
  setNumber: string,
  condition: PartoutCondition
): Promise<OfficialPovPostResponse> {
  const res = await fetch('/api/bricklink/part-out-value', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: setNumber, condition: toBlCondition(condition), force: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Fetch failed (${res.status})`);
  return json.data as OfficialPovPostResponse;
}

export function useOfficialPov(
  setNumber: string | null,
  condition: PartoutCondition,
  enabled: boolean
) {
  return useQuery({
    queryKey: officialPovQueryKey(setNumber, condition),
    queryFn: () => fetchOfficialPov(setNumber!, condition),
    enabled: enabled && !!setNumber,
    staleTime: 60_000,
  });
}

export function useRefreshOfficialPov(
  setNumber: string | null,
  condition: PartoutCondition,
  callbacks: {
    onUnavailable?: (note: string) => void;
    onScraped?: () => void;
    onError?: (message: string) => void;
  } = {}
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => refreshOfficialPov(setNumber!, condition),
    onSuccess: (d) => {
      if (d.scraped === false && d.cdpReachable === false) {
        callbacks.onUnavailable?.(
          d.note ?? 'Live POV fetch only works on the local dev server (needs local Chrome).'
        );
      } else if (d.scraped) {
        callbacks.onScraped?.();
      }
      queryClient.invalidateQueries({ queryKey: officialPovQueryKey(setNumber, condition) });
    },
    onError: (e) => {
      callbacks.onError?.(e instanceof Error ? e.message : 'Could not fetch Part Out Value.');
    },
  });
}
