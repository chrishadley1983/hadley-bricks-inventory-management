/**
 * Canonical BL <-> Bricqer colour mapping (unified-price-cache feature, F1).
 *
 * BL colour id is the canonical scheme for price_guide_cache and all downstream analysis.
 * Bricqer-sourced inputs (e.g. bricqer_inventory_snapshot.color_id) are normalised to BL ids
 * at the boundary via this map. Source of truth: table `bricklink_colour_map`, built by
 * scripts/pg/build-colour-map.ts from BL getColors() + Bricqer snapshot colours (joined by name).
 *
 * Everything that reads/writes a colour goes through here — never re-derive an ad-hoc name map.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ColourScheme = 'bl' | 'bricqer';

export interface ColourMapRow {
  bl_colour_id: number;
  bl_colour_name: string;
  bricqer_colour_id: number | null;
  bricqer_colour_name: string | null;
  rgb: string | null;
}

/** Normalise a colour name for join/lookup: lowercased, trimmed, collapsed whitespace. */
export function normColourName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface ColourMap {
  /** Canonicalise any colour id to a BL colour id. Non-part types collapse to 0. */
  toBl(colourId: number, scheme: ColourScheme): number;
  /** BL colour id -> Bricqer colour id (null if the colour has no Bricqer equivalent). */
  toBricqer(blColourId: number): number | null;
  /** BL colour id -> BL colour name (null if unknown). */
  name(blColourId: number): string | null;
  /** Resolve a raw colour (id and/or name, in some scheme) to canonical BL id + name. */
  normalise(input: { colourId?: number; colourName?: string | null; scheme: ColourScheme }): {
    blId: number;
    name: string | null;
    mapped: boolean;
  };
  size: number;
}

function build(rows: ColourMapRow[]): ColourMap {
  const byBl = new Map<number, ColourMapRow>();
  const bricqerToBl = new Map<number, number>();
  const nameToBl = new Map<string, number>();
  for (const r of rows) {
    byBl.set(r.bl_colour_id, r);
    if (r.bricqer_colour_id != null) bricqerToBl.set(r.bricqer_colour_id, r.bl_colour_id);
    nameToBl.set(normColourName(r.bl_colour_name), r.bl_colour_id);
    if (r.bricqer_colour_name) nameToBl.set(normColourName(r.bricqer_colour_name), r.bl_colour_id);
  }
  // "(Not Applicable)" / minifig-style colours collapse to 0
  nameToBl.set('(not applicable)', 0);
  nameToBl.set('not applicable', 0);
  nameToBl.set('', 0);

  return {
    size: byBl.size,
    toBl(colourId, scheme) {
      if (scheme === 'bl') return colourId;
      // bricqer -> bl
      return bricqerToBl.get(colourId) ?? colourId; // fall back to identity if unmapped
    },
    toBricqer(blColourId) {
      return byBl.get(blColourId)?.bricqer_colour_id ?? null;
    },
    name(blColourId) {
      if (blColourId === 0) return '(Not Applicable)';
      return byBl.get(blColourId)?.bl_colour_name ?? null;
    },
    normalise({ colourId, colourName, scheme }) {
      // Prefer name (authoritative across schemes); fall back to id in its scheme.
      if (colourName != null) {
        const byName = nameToBl.get(normColourName(colourName));
        if (byName != null) return { blId: byName, name: this.name(byName), mapped: true };
      }
      if (colourId != null) {
        const blId = this.toBl(colourId, scheme);
        return { blId, name: this.name(blId), mapped: byBl.has(blId) || (scheme === 'bricqer' && bricqerToBl.has(colourId)) };
      }
      return { blId: 0, name: '(Not Applicable)', mapped: true };
    },
  };
}

let cached: Promise<ColourMap> | null = null;

/** Load (and memoise) the colour map from the DB. Pass force to bypass the cache. */
export async function loadColourMap(
  supabase: SupabaseClient,
  opts: { force?: boolean } = {}
): Promise<ColourMap> {
  if (cached && !opts.force) return cached;
  cached = (async () => {
    const rows: ColourMapRow[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bricklink_colour_map')
        .select('bl_colour_id,bl_colour_name,bricqer_colour_id,bricqer_colour_name,rgb')
        .order('bl_colour_id')
        .range(from, from + 999);
      if (error) throw new Error(`colour map load failed: ${error.message}`);
      rows.push(...((data ?? []) as ColourMapRow[]));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    return build(rows);
  })();
  return cached;
}

/** For tests: build a map directly from rows without hitting the DB. */
export function buildColourMapFromRows(rows: ColourMapRow[]): ColourMap {
  return build(rows);
}
