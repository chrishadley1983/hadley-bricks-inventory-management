/**
 * capturePriceGuide / ensurePriceGuide — the single write path (unified-price-cache F2/F3).
 *
 * Decision (2026-07-09): always grab ALL FOUR quadrants (soldNew, soldUsed, stockNew, stockUsed)
 * so every write is a COMPLETE row — plain upsert, no coalescing needed. The BL price API is one
 * quadrant per call, so a fresh tuple costs 4 calls; the 90-day TTL + never-re-fetch offsets it.
 * Everything needed to recompute STR (lots + qty per quadrant), median, recency and histogram is
 * captured from the API's price_detail[]. Colour ids are normalised to canonical BL id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrickLinkClient } from '../client';
import type { BrickLinkPriceGuide, BrickLinkItemType } from '../types';
import { PriceGuideCacheService } from '../price-guide-cache.service';
import type { PgQuadrantStats, PgScrapeResult, PgSideStats, PgItemType } from '../price-guide-page';
import { loadColourMap, type ColourScheme } from '../colour-map';
import { readPriceGuide, type PriceGuideView } from './read';

const HIST_MAX = 150;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const API_TYPE: Record<PgItemType, BrickLinkItemType> = { P: 'PART', M: 'MINIFIG', S: 'SET' };

const num = (s: string | number | null | undefined): number | null => {
  const n = typeof s === 'number' ? s : parseFloat(String(s ?? ''));
  return Number.isFinite(n) ? n : null;
};

function emptyQuad(): PgQuadrantStats {
  return { lots: 0, qty: 0, avg: null, qtyAvg: null, median: null, min: null, max: null, byMonth: {}, hist: {} };
}

/** Cap a price->qty map to the highest-qty buckets, rolling the tail into "other" (qty integrity). */
function capHist(raw: Map<string, number>): Record<string, number> {
  if (raw.size <= HIST_MAX) return Object.fromEntries(raw);
  const sorted = [...raw.entries()].sort((a, b) => b[1] - a[1]);
  const kept = sorted.slice(0, HIST_MAX);
  const other = sorted.slice(HIST_MAX).reduce((s, [, q]) => s + q, 0);
  const out = Object.fromEntries(kept);
  if (other > 0) out.other = (out.other ?? 0) + other;
  return out;
}

/** BrickLink price-guide response (one quadrant) -> PgQuadrantStats. */
export function blGuideToQuadrant(g: BrickLinkPriceGuide, isSold: boolean): PgQuadrantStats {
  const detail = g.price_detail ?? [];
  if (detail.length === 0 && !g.unit_quantity) return emptyQuad();

  // lot-median over transactions (each price_detail entry is one lot)
  const prices = detail.map((d) => num(d.unit_price)).filter((p): p is number => p != null).sort((a, b) => a - b);
  const median = prices.length ? (prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) : null;

  // hist: price(4dp) -> total qty
  const rawHist = new Map<string, number>();
  const byMonthAcc: Record<string, { lots: number; qty: number; sum: number }> = {};
  for (const d of detail) {
    const p = num(d.unit_price);
    const q = Number(d.quantity) || 0;
    if (p == null) continue;
    const key = p.toFixed(4);
    rawHist.set(key, (rawHist.get(key) ?? 0) + q);
    if (isSold && d.date_ordered) {
      const dt = new Date(d.date_ordered as string);
      if (!Number.isNaN(dt.getTime())) {
        const label = `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
        const b = (byMonthAcc[label] ??= { lots: 0, qty: 0, sum: 0 });
        b.lots += 1; b.qty += q; b.sum += p * q;
      }
    }
  }
  const byMonth: Record<string, { lots: number; qty: number; avg: number }> = {};
  for (const [k, b] of Object.entries(byMonthAcc)) byMonth[k] = { lots: b.lots, qty: b.qty, avg: b.qty ? b.sum / b.qty : 0 };

  return {
    lots: g.unit_quantity ?? detail.length,
    qty: g.total_quantity ?? detail.reduce((s, d) => s + (Number(d.quantity) || 0), 0),
    avg: num(g.avg_price),
    qtyAvg: num(g.qty_avg_price),
    median,
    min: num(g.min_price),
    max: num(g.max_price),
    byMonth: isSold ? byMonth : {},
    hist: capHist(rawHist),
  };
}

export interface BlQuads {
  soldNew: BrickLinkPriceGuide; stockNew: BrickLinkPriceGuide;
  soldUsed: BrickLinkPriceGuide; stockUsed: BrickLinkPriceGuide;
}

/** Assemble a PgScrapeResult (UK scope) from the four BL API quadrant responses. */
export function fromBlApi(
  item: { itemType: PgItemType; itemNo: string; blColourId: number },
  quads: BlQuads,
  itemName: string | null = null
): PgScrapeResult {
  const uk: PgSideStats = {
    soldNew: blGuideToQuadrant(quads.soldNew, true),
    soldUsed: blGuideToQuadrant(quads.soldUsed, true),
    stockNew: blGuideToQuadrant(quads.stockNew, false),
    stockUsed: blGuideToQuadrant(quads.stockUsed, false),
  };
  const world: PgSideStats = { soldNew: emptyQuad(), soldUsed: emptyQuad(), stockNew: emptyQuad(), stockUsed: emptyQuad() };
  return {
    item: { itemType: item.itemType, itemNo: item.itemNo, colourId: item.itemType === 'P' ? item.blColourId : 0 },
    itemName,
    uk,
    world,
    finalUrl: 'bl_api',
    scrapedAt: new Date().toISOString(),
  };
}

/** Write a complete price-guide row (plain upsert via the rich cache service). */
export async function capturePriceGuide(supabase: SupabaseClient, result: PgScrapeResult): Promise<void> {
  await new PriceGuideCacheService(supabase).upsert([result]);
}

export interface EnsureOpts {
  ttlDays?: number; // default 45
  scheme?: ColourScheme; // colour scheme of the input colourId (default 'bl')
  persist?: boolean; // default true — set false to skip capture (read-only)
}

/**
 * Standard price path: return a fresh UK view for one tuple, fetching + capturing all 4 quadrants
 * from the BL API when the cache is missing/stale. Colour normalised to BL.
 */
export async function ensurePriceGuide(
  bl: BrickLinkClient,
  supabase: SupabaseClient,
  item: { itemType: PgItemType; itemNo: string; colourId: number },
  opts: EnsureOpts = {}
): Promise<PriceGuideView> {
  const ttlDays = opts.ttlDays ?? 45;
  const cmap = await loadColourMap(supabase);
  const blColourId = item.itemType === 'P' ? cmap.toBl(item.colourId, opts.scheme ?? 'bl') : 0;
  const ref = { itemType: item.itemType, itemNo: item.itemNo, colourId: blColourId, scheme: 'bl' as const };

  // fresh UK hit?
  const existing = await readPriceGuide(supabase, [ref], { ttlDays, allowWorldFallback: false });
  const [key] = existing.keys();
  const hit = existing.get(key);
  if (hit && hit.coverage === 'uk') return hit;
  if (opts.persist === false) {
    // read-only: return whatever we have (world fallback / none)
    return (await readPriceGuide(supabase, [ref])).get(key)!;
  }

  // fetch all 4 quadrants (UK) and capture a complete row
  const apiType = API_TYPE[item.itemType];
  const g = (condition: 'N' | 'U', guideType: 'sold' | 'stock') =>
    bl.getPartPriceGuide(apiType, item.itemNo, blColourId, { condition, guideType, currencyCode: 'GBP', countryCode: 'UK' });
  const [soldNew, stockNew, soldUsed, stockUsed] = await Promise.all([
    g('N', 'sold'), g('N', 'stock'), g('U', 'sold'), g('U', 'stock'),
  ]);
  await capturePriceGuide(supabase, fromBlApi({ itemType: item.itemType, itemNo: item.itemNo, blColourId }, { soldNew, stockNew, soldUsed, stockUsed }));

  // Post-capture read: no ttl filter — the row we just wrote is fresh by definition.
  return (await readPriceGuide(supabase, [ref], { allowWorldFallback: true })).get(key)!;
}
