/**
 * Resolve AMBIGUOUS bare-series CMF listings to their per-figure catalog ids by name.
 *
 * Some sellers list a single collectible minifigure under the bare series id
 * ("col13" + name "Alien Trooper, Series 13 (Complete Set with Stand and Accessories)").
 * In BL's catalog the bare id is the COMPLETE SERIES BOX, so any automated price match
 * is wrong (the Alpine8 2026-07-14 phantom-margin bug). The listing NAME, however, is
 * the BL catalog name verbatim — so it resolves exactly against the series map built by
 * scripts/pg/build-cmf-figure-map.ts.
 *
 * Resolution changes IDENTITY only: condition (invNew) and completeness (invComplete)
 * still gate pricing in the engine as for any other lot.
 */

import type { StoreLot } from './types';
import figureMapJson from './data/cmf-figure-map.json';

const FIGURE_MAP = figureMapJson as Record<string, string>;

export function normalizeCmfName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isBareCmf(lot: Pick<StoreLot, 'itemType' | 'itemNo'>): boolean {
  return lot.itemType === 'S' && /^col/i.test(lot.itemNo) && !lot.itemNo.includes('-');
}

/** Returns a NEW lots array with resolvable bare-CMF lots re-keyed to their figure ids. */
export function resolveBareCmfLots(lots: StoreLot[]): { lots: StoreLot[]; resolvedCount: number } {
  let resolvedCount = 0;
  const out = lots.map((l) => {
    if (!isBareCmf(l) || l.cmfResolved) return l;
    const hit = FIGURE_MAP[normalizeCmfName(l.itemName ?? '')];
    if (!hit) return l;
    // Sanity: the resolved figure must belong to the listed series.
    if (!hit.toLowerCase().startsWith(`${l.itemNo.toLowerCase()}-`)) return l;
    resolvedCount++;
    return { ...l, itemNo: hit, cmfResolved: true };
  });
  return { lots: out, resolvedCount };
}
