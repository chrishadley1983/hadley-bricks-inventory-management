/**
 * BrickLink catalog item name resolution, cached in `bl_catalog_names`.
 *
 * Cache-first: only calls the BrickLink API on a genuine miss. This is designed to be
 * called from a single-item view (e.g. the BrickRadar tuple drill-down page) — never
 * in a loop over screen/list rows, since that would burn one BL API call per row.
 * Every failure mode (cache read, BL API call, cache write) is non-fatal and resolves
 * to `null` so the caller can fall back to showing the raw item_type/item_no tuple.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrickLinkClient } from './client';
import type { BrickLinkItemType } from './types';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type CatalogItemType = 'P' | 'S' | 'M';

/** Map our single-char item_type (P/S/M) to BrickLink's API item type enum. */
export function mapType(itemType: CatalogItemType): BrickLinkItemType {
  switch (itemType) {
    case 'P':
      return 'PART';
    case 'S':
      return 'SET';
    case 'M':
      return 'MINIFIG';
  }
}

/**
 * Strip a set's "-N" catalog sequence suffix for the cache key (e.g. "76967-1" ->
 * "76967"). Sets can arrive in either form depending on caller (see the tuple page's
 * own `itemNoCandidates` helper) — normalising to the bare number keeps one cache row
 * per set regardless of which variant the caller passed in.
 */
function bareItemNo(itemType: CatalogItemType, itemNo: string): string {
  return itemType === 'S' ? itemNo.replace(/-\d+$/, '') : itemNo;
}

/**
 * Resolve a human-readable BrickLink catalog name for (itemType, itemNo).
 *
 * - `supabase`: any Supabase client with read access to `bl_catalog_names` (authenticated
 *   RLS policy allows SELECT) — used for the cache-hit check.
 * - `blClient`: an authenticated BrickLinkClient, or `null` if credentials aren't
 *   available in this context (e.g. not loaded). When `null`, this only ever serves
 *   from cache and returns `null` on a miss — it never throws.
 *
 * On a cache miss, calls `blClient.getCatalogItem(mapType(itemType), apiNo)` — note
 * BrickLink's catalog endpoint requires the "-N" sequence suffix for SET lookups (bare
 * numbers 404); this mirrors the convention already used in mapping.service.ts and
 * pg-set-check.ts (default to "-1"). The resolved name is upserted into
 * `bl_catalog_names` via a service-role client (the table has no authenticated
 * write policy — see the migration) so the cache stays warm for the next viewer.
 */
export async function resolveItemName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bl_catalog_names isn't in generated Database types yet
  supabase: SupabaseClient<any>,
  blClient: BrickLinkClient | null,
  itemType: CatalogItemType,
  itemNo: string
): Promise<string | null> {
  const bareNo = bareItemNo(itemType, itemNo);

  try {
    const { data, error } = await supabase
      .from('bl_catalog_names')
      .select('name')
      .eq('item_type', itemType)
      .eq('item_no', bareNo)
      .maybeSingle();

    if (!error && data?.name) {
      return data.name as string;
    }
  } catch (err) {
    console.warn('[resolveItemName] cache read failed:', err);
    // Fall through — still worth trying a live BL lookup.
  }

  if (!blClient) return null;

  let name: string | null = null;
  try {
    const apiNo = itemType === 'S' ? `${bareNo}-1` : bareNo;
    const item = await blClient.getCatalogItem(mapType(itemType), apiNo);
    name = item.name ?? null;
  } catch (err) {
    console.warn('[resolveItemName] BrickLink API lookup failed:', err);
    return null;
  }

  if (!name) return null;

  try {
    const serviceClient = createServiceRoleClient();
    const { error: upsertError } = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bl_catalog_names isn't in generated Database types yet
      serviceClient as SupabaseClient<any>
    )
      .from('bl_catalog_names')
      .upsert(
        {
          item_type: itemType,
          item_no: bareNo,
          name,
          source: 'bl_api',
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'item_type,item_no' }
      );
    if (upsertError) {
      console.warn('[resolveItemName] cache write failed:', upsertError.message);
    }
  } catch (err) {
    console.warn('[resolveItemName] cache write failed:', err);
    // Non-fatal — we already have a name to return for this request.
  }

  return name;
}
