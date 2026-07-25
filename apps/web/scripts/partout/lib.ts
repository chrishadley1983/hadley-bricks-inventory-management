/**
 * Shared helpers for the part-out lot toolkit (scripts/partout/*).
 *
 * All BrickLink reads/fetches go through the repo's unified price cache and the
 * canonical Bricqer formula — this file is a thin, reusable wrapper around them
 * so the CLI commands stay declarative. No business logic is re-implemented here.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BrickLinkClient } from '../../src/lib/bricklink/client';
import type { BrickLinkCredentials } from '../../src/lib/bricklink/types';
import { readPriceGuide, pgKey, type ItemRef, type PgType } from '../../src/lib/bricklink/price-guide/read';
import { ensurePriceGuide } from '../../src/lib/bricklink/price-guide/capture';
import { bricqerListPrice, type BricqerCondition } from '../../src/lib/bricklink/bricqer-pricing';
import { BL_COLOURS } from '../../src/lib/bricklink/bl-colours';

/** POV grounding freshness gate — mirrors PartoutService (accepts any UK row <180d). */
export const POV_TTL_DAYS = 180;
/** Polite spacing between the price-guide fetches that actually hit BrickLink. */
const FETCH_DELAY_MS = 700;
const CACHE_DIR = path.resolve(__dirname, '.cache');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const toPg = (t: string): PgType => (t === 'MINIFIG' ? 'M' : t === 'SET' ? 'S' : 'P');
/** Cache/identity key for a lot — colour is ignored for minifigs (as in the repo). */
export const keyOf = (t: PgType, no: string, col: number) => pgKey(t, no, t === 'P' ? col : 0);
export const blColour = (col: number) => BL_COLOURS[col]?.name ?? `colour ${col}`;
/** BrickLink item numbers are "<set>-1"; accept either form from the user. */
export const normSet = (s: string) => (/-\d+$/.test(s) ? s : `${s}-1`);
export const bareSet = (s: string) => s.replace(/-\d+$/, '');

export interface Clients { supabase: SupabaseClient; bl: BrickLinkClient }
export function clients(caller: string): Clients {
  const creds: BrickLinkCredentials = {
    consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
    consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
    tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
    tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
  };
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return { supabase, bl: new BrickLinkClient(creds, { supabase, caller }) };
}

export interface Lot { t: PgType; no: string; col: number; qty: number; name: string; set: string }

/**
 * BOM (bill of materials) for each set, deduped within set with quantities summed.
 * Cached to .cache/ keyed by the set list so `count` and `ground` share the one
 * subsets call each — re-runs cost zero BrickLink calls. Pass force to refetch.
 */
export async function fetchBoms(bl: BrickLinkClient, sets: string[], force = false): Promise<Record<string, Lot[]>> {
  const norm = sets.map(normSet);
  const hash = crypto.createHash('md5').update(norm.slice().sort().join(',')).digest('hex').slice(0, 10);
  const file = path.join(CACHE_DIR, `bom-${hash}.json`);
  if (!force && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));

  const out: Record<string, Lot[]> = {};
  for (const set of norm) {
    const subsets = await bl.getSubsets('SET', set, { breakMinifigs: false, breakSets: false });
    const m = new Map<string, Lot>();
    for (const s of subsets) for (const e of s.entries) {
      if (e.is_alternate || e.is_counterpart) continue; // primary parts only, like PartoutService
      const t = toPg(e.item.type);
      const k = keyOf(t, e.item.no, e.color_id);
      const ex = m.get(k);
      if (ex) ex.qty += e.quantity;
      else m.set(k, { t, no: e.item.no, col: e.color_id, qty: e.quantity, name: e.item.name, set: bareSet(set) });
    }
    out[bareSet(set)] = [...m.values()];
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

export const refsOf = (lots: Lot[]): ItemRef[] =>
  lots.map((l) => ({ itemType: l.t, itemNo: l.no, colourId: l.col, scheme: 'bl' as const }));

/** Read cached price-guide views for these lots (no fetching). coverage==='uk' means a fresh hit. */
export const readViews = (s: SupabaseClient, lots: Lot[], ttlDays = POV_TTL_DAYS) =>
  readPriceGuide(s, refsOf(lots), { ttlDays, allowWorldFallback: false });

/** Fetch the uncached lots into the shared cache, sequential + spaced. Returns count fetched. */
export async function fetchUncached(c: Clients, lots: Lot[], ttlDays = POV_TTL_DAYS, log = true): Promise<number> {
  const views = await readViews(c.supabase, lots, ttlDays);
  const missing = lots.filter((l) => views.get(keyOf(l.t, l.no, l.col))?.coverage !== 'uk');
  if (log) console.log(`Fetching ${missing.length} uncached price guides (${lots.length - missing.length} already cached)...`);
  let n = 0;
  for (const l of missing) {
    await ensurePriceGuide(c.bl, c.supabase, { itemType: l.t, itemNo: l.no, colourId: l.col }, { ttlDays });
    if (log && ++n % 10 === 0) console.log(`  ${n}/${missing.length}`);
    else n++;
    await sleep(FETCH_DELAY_MS);
  }
  return n;
}

/** Per-lot valuation via the canonical v4 Bricqer formula, for one condition. */
export interface LotVal { avg: number | null; str: number | null; list: number; extList: number; extSold: number }
export function valueLot(view: ReturnType<Map<string, any>['get']>, cond: BricqerCondition, qty: number): LotVal {
  const side = cond === 'N' ? view?.new : view?.used;
  const avg: number | null = side?.soldAvg ?? null;
  const str: number | null = side?.strQty ?? null;
  const list = bricqerListPrice(avg, cond, str ?? 0) ?? 0; // null STR => 0 => 0.90x slow-mover bracket
  return { avg, str, list, extList: list * qty, extSold: (avg ?? 0) * qty };
}

// ---- tiny arg + formatting helpers -------------------------------------------------
export function parseArgs(argv: string[]) {
  const cmd = argv[0];
  const o: Record<string, string> = {};
  for (const a of argv.slice(1)) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) o[m[1]] = m[2] ?? 'true'; }
  return { cmd, o };
}

/** Parse a lot spec: "43020:75,31171:25" or --file=<json {set:ask} | [{set,ask}]>. */
export function parseLot(o: Record<string, string>): { set: string; ask: number | null }[] {
  if (o.file) {
    const j = JSON.parse(fs.readFileSync(o.file, 'utf-8'));
    if (Array.isArray(j)) return j.map((r: any) => ({ set: bareSet(String(r.set)), ask: r.ask ?? null }));
    return Object.entries(j).map(([set, ask]) => ({ set: bareSet(set), ask: Number(ask) }));
  }
  const spec = o.lot ?? o.sets ?? '';
  return spec.split(',').filter(Boolean).map((p) => {
    const [set, ask] = p.split(':');
    return { set: bareSet(set.trim()), ask: ask == null ? null : Number(ask) };
  });
}

export function table(headers: string[], rows: (string | number)[][]): string {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const w = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  return all.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ')).join('\n');
}
export const gbp = (n: number) => n.toFixed(2);
export const CACHE_PATH = CACHE_DIR;
