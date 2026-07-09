/**
 * Lane A live-check CLI (spec: docs/features/pg-market-intelligence/spec.md §3 F7).
 *
 * Thin wrapper around `liveCheckBatch` (src/lib/bricklink/live-check.service.ts): fetches the
 * official UK sold 6MA (and optionally stock) price guide for one or more tuples via the BL
 * store API, writes through to the unified `bricklink_price_guide_cache` (a deliberate PARTIAL
 * upsert of only the fetched quadrants — see the service header for why it bypasses
 * `capturePriceGuide`), and prints a compact table. This is the callable surface bl-basket /
 * set-buy-check use for
 * a "verify before acting" live check, and can be driven directly for ad-hoc lookups.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-live-check.ts --item=P:3001:11
 *   npx tsx scripts/pg/pg-live-check.ts --item=P:3001:11 --item=M:sw1479:0
 *   npx tsx scripts/pg/pg-live-check.ts --set=45501 --set=42140
 *   npx tsx scripts/pg/pg-live-check.ts --from-report=../../tmp/stores/Jabbz/shortlist.json
 *
 * Flags:
 *   --item=<T>:<no>:<colourId>   Repeatable. T is P|S|M; colourId ignored (0) for S/M.
 *   --set=<no>                   Repeatable shorthand for --item=S:<no>:0.
 *   --from-report=<path>         JSON file: either a bare array of tuples, or
 *                                 `{ "tuples": [...] }`. Each tuple accepts camelCase
 *                                 (itemType/itemNo/colourId) or snake_case
 *                                 (item_type/item_no/colour_id) keys.
 *   --conditions=N,U              Conditions to check (default N,U — both).
 *   --include-stock                Also fetch the stock guide (2 more calls/tuple).
 *   --spacing-ms=<n>               Delay between tuples (default 1100 — BL politeness).
 *   --caller=<name>                bricklink_api_calls_daily.by_caller label (default 'pg-live-check').
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createScriptBlContext } from '../_bl-client';
import { PriceGuideCacheService } from '../../src/lib/bricklink/price-guide-cache.service';
import { liveCheckBatch, type LiveCheckTuple } from '../../src/lib/bricklink/live-check.service';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Argv {
  items: string[];
  sets: string[];
  single: Record<string, string>;
}

function parseArgv(argv: string[]): Argv {
  const items: string[] = [];
  const sets: string[] = [];
  const single: Record<string, string> = {};
  for (const a of argv) {
    const stripped = a.replace(/^--/, '');
    const eq = stripped.indexOf('=');
    const key = eq === -1 ? stripped : stripped.slice(0, eq);
    const value = eq === -1 ? 'true' : stripped.slice(eq + 1);
    if (key === 'item') items.push(value);
    else if (key === 'set') sets.push(value);
    else single[key] = value;
  }
  return { items, sets, single };
}

const { items: ITEM_ARGS, sets: SET_ARGS, single: ARGS } = parseArgv(process.argv.slice(2));

const FROM_REPORT = ARGS['from-report'] ? path.resolve(process.cwd(), ARGS['from-report']) : null;
const CONDITIONS = (ARGS['conditions'] ?? 'N,U')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter((c): c is 'N' | 'U' => c === 'N' || c === 'U');
const INCLUDE_STOCK = ARGS['include-stock'] === 'true';
const SPACING_MS = parseInt(ARGS['spacing-ms'] ?? '1100', 10);
const CALLER = ARGS['caller'] ?? 'pg-live-check';

// ---------------------------------------------------------------------------
// Tuple resolution
// ---------------------------------------------------------------------------

function parseItemArg(raw: string): LiveCheckTuple {
  const parts = raw.split(':');
  const itemType = (parts[0] ?? '').toUpperCase() as PgItemType;
  const itemNo = parts[1] ?? '';
  const colourId = parts[2] ? parseInt(parts[2], 10) : 0;
  if (!['P', 'S', 'M'].includes(itemType) || !itemNo) {
    throw new Error(`Invalid --item="${raw}" — expected T:no:colourId (T=P|S|M)`);
  }
  return { itemType, itemNo, colourId: Number.isFinite(colourId) ? colourId : 0 };
}

/** Accepts camelCase or snake_case tuple objects from a shortlist JSON file. */
function normaliseTupleLike(o: Record<string, unknown>): LiveCheckTuple | null {
  const itemType = (o.itemType ?? o.item_type) as string | undefined;
  const itemNo = (o.itemNo ?? o.item_no) as string | undefined;
  const colourIdRaw = o.colourId ?? o.colour_id ?? 0;
  if (!itemType || !itemNo) return null;
  const t = itemType.toUpperCase();
  if (t !== 'P' && t !== 'S' && t !== 'M') return null;
  const colourId = typeof colourIdRaw === 'number' ? colourIdRaw : parseInt(String(colourIdRaw), 10);
  return { itemType: t, itemNo: String(itemNo), colourId: Number.isFinite(colourId) ? colourId : 0 };
}

function loadFromReport(file: string): LiveCheckTuple[] {
  if (!fs.existsSync(file)) {
    console.error(`--from-report file not found: ${file}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.tuples) ? raw.tuples : [];
  const out: LiveCheckTuple[] = [];
  for (const entry of list) {
    if (entry && typeof entry === 'object') {
      const t = normaliseTupleLike(entry as Record<string, unknown>);
      if (t) out.push(t);
    }
  }
  return out;
}

function resolveTuples(): LiveCheckTuple[] {
  const out: LiveCheckTuple[] = [];
  for (const raw of ITEM_ARGS) out.push(parseItemArg(raw));
  for (const setNo of SET_ARGS) out.push({ itemType: 'S', itemNo: setNo, colourId: 0 });
  if (FROM_REPORT) out.push(...loadFromReport(FROM_REPORT));
  // De-dupe (same tuple could appear via --item and --from-report).
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = `${t.itemType}:${t.itemNo}:${t.colourId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function money(n: number | null | undefined, dp = 3): string {
  return n == null ? '—' : `£${n.toFixed(dp)}`;
}

function printReport(result: Awaited<ReturnType<typeof liveCheckBatch>>): void {
  console.log('');
  console.log(`Tuples: ${result.tuplesCompleted}/${result.tuplesRequested} completed · requests ${result.requestsTotal} (ok ${result.ok}, failed ${result.failed})`);
  if (result.budgetExhausted) {
    console.log(`⚠ BUDGET EXHAUSTED at request #${result.firstBlockAtRequest} — stopped early, partial results below.`);
  }
  console.log('');

  const header = '| Item | Colour | N: lots/qty/avg | U: lots/qty/avg | Cache | Errors |';
  const sep = '|---|---|---|---|---|---|';
  console.log(header);
  console.log(sep);
  for (const r of result.results) {
    const item = `${r.tuple.itemType} ${r.tuple.itemNo}`;
    const n = r.sold.N ? `${r.sold.N.lots}/${r.sold.N.qty}/${money(r.sold.N.avg)}` : '—';
    const u = r.sold.U ? `${r.sold.U.lots}/${r.sold.U.qty}/${money(r.sold.U.avg)}` : '—';
    const cache = r.wroteToUkCache ? '✓' : '—';
    const prior = r.priorCacheAgeDays == null ? 'new' : `${r.priorCacheAgeDays.toFixed(1)}d old`;
    const errs = r.errors.length > 0 ? r.errors.join('; ').slice(0, 60) : '';
    console.log(`| ${item} | ${r.tuple.colourId} | ${n} | ${u} | ${cache} (was ${prior}) | ${errs} |`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tuples = resolveTuples();
  if (tuples.length === 0) {
    console.error('No tuples resolved. Provide --item=T:no:colourId, --set=no, and/or --from-report=<path>.');
    process.exit(1);
  }
  if (CONDITIONS.length === 0) {
    console.error(`--conditions="${ARGS['conditions']}" resolved to no valid conditions (expected N,U).`);
    process.exit(1);
  }

  console.log(`[pg-live-check] ${tuples.length} tuple(s), conditions=${CONDITIONS.join(',')}, includeStock=${INCLUDE_STOCK}, spacing=${SPACING_MS}ms`);

  const { bl, supabase } = createScriptBlContext(CALLER);
  const cacheService = new PriceGuideCacheService(supabase);

  const result = await liveCheckBatch(bl, cacheService, supabase, tuples, {
    conditions: CONDITIONS,
    includeStock: INCLUDE_STOCK,
    spacingMs: SPACING_MS,
  });

  printReport(result);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
