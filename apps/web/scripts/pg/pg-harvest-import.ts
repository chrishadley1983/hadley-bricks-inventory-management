/**
 * Lane B BrickStore harvest ingest (spec §2.2 lane B: batch affiliate API via a
 * BrickStore token, fortnightly ~15-min manual ritual). Replaces the POC import
 * path (`_tmp-import-brickstore-pg.ts`, one-shot, hardcoded rate + hardcoded file
 * path) with a reusable, quarantine-aware service.
 *
 * IMPORTANT — input format note (read before wiring a real harvest into this):
 * the task brief for this script describes ".bsx files" as the input, but the
 * documented, WORKING harvest pipeline (see memory `bl-pg-summary-coverage`,
 * ported from `_tmp-import-brickstore-pg.ts`) is: BrickStore's price-guide panel
 * (Ctrl+G) populates its LOCAL SQLite cache
 * (`%LOCALAPPDATA%\BrickStore\cache\priceguide_cache.sqlite`), which a Python
 * decoder unpacks into a flat JSON array (`part`, `colour`, quadrant fields) — a
 * plain BrickStore *.bsx inventory export does NOT carry price-guide quadrant
 * data; BSX's `<Item>` schema has no such fields. Rather than invent an
 * unverified custom BSX tag convention, this importer:
 *
 *   - Reads every file in `--dir`.
 *   - JSON files (`.json`) are treated as decoded harvest batches — the real,
 *     working format — each record shaped like `_tmp-import-brickstore-pg.ts`'s
 *     `Rec` (`part`/`itemNo`, `colour`/`colourId`, optional `itemType`,
 *     `soldN`/`soldU`/`stockN`/`stockU` quads, optional per-record `currency`).
 *   - `.bsx` files are detected (XML) and, since they carry no PG fields in
 *     practice, are logged and skipped with an explicit explanation rather than
 *     silently imported as empty/zero data — a future harvest step that DOES
 *     encode PG fields into BSX can extend `parseBsxHarvestFile` below.
 *
 * Currency handling (the USD-blobs defence, spec §2.2/§7.5 — mandatory):
 *   --fx-rate=<rate>   Data is USD-based (BrickStore's batch blobs are always USD,
 *                      VAT-excluded) — every record is converted to GBP at this
 *                      rate and stamped `fx_rate`.
 *   --gbp-native       Data is already GBP-native — no conversion, `fx_rate=null`.
 *   Exactly one of the two must be given. Every row is run through
 *   `validateCurrencyBasis` before upsert; anything that doesn't pass (e.g. a
 *   per-record `currency` override with no resolvable rate) is written to a
 *   quarantine JSON report and skipped — never silently ingested.
 *
 * Also updates `bl_pg_refresh_queue` for imported TAIL-tier tuples only
 * (last_refreshed_at=now, next_due_at=+90d). Active-tier tuples are deliberately
 * left alone: their 28-day clock schedules lane D's UK-grade L3 refresh, which a
 * worldwide-only lane B import doesn't satisfy. Tuples with no queue row yet are
 * left for `pg-universe.ts --seed-from-cache` to pick up.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-harvest-import.ts --dir="C:/harvest/2026-07" --fx-rate=0.7407
 *   npx tsx scripts/pg/pg-harvest-import.ts --dir="C:/harvest/2026-07" --gbp-native
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  toSummaryCacheRow,
  validateCurrencyBasis,
  EMPTY_PG_SUMMARY_QUAD,
  type PgSummaryCacheRow,
  type PgSummaryQuad,
} from '../../src/lib/bricklink/pg-summary';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const DIR = argv['dir'] ? path.resolve(process.cwd(), argv['dir']) : null;
const GBP_NATIVE = argv['gbp-native'] === 'true';
const FX_RATE = argv['fx-rate'] != null ? parseFloat(argv['fx-rate']) : null;
const QUARANTINE_OVERRIDE = argv['quarantine-file'] ? path.resolve(process.cwd(), argv['quarantine-file']) : null;

if (!DIR) {
  console.error('Required: --dir=<folder of harvest files>');
  process.exit(1);
}
if (!GBP_NATIVE && (FX_RATE == null || !Number.isFinite(FX_RATE) || FX_RATE <= 0)) {
  console.error('Required: exactly one of --gbp-native or --fx-rate=<positive number>');
  process.exit(1);
}
if (GBP_NATIVE && FX_RATE != null) {
  console.error('Pass only one of --gbp-native or --fx-rate, not both.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Harvest record shape (JSON decode output) — ports `_tmp-import-brickstore-pg.ts`'s
// `Rec` type, generalised with an optional item type + per-record currency.
// ---------------------------------------------------------------------------

interface HarvestQuad {
  qty: number;
  lots: number;
  min: number | null;
  avg: number | null;
  qavg: number | null;
  max: number | null;
}

interface HarvestRec {
  /** BL part/set/fig number. Accepts either key for compatibility with older exports. */
  part?: string;
  itemNo?: string;
  itemType?: PgItemType; // default 'P' — the only type the harvest has produced to date
  colour?: number;
  colourId?: number;
  rank?: number;
  ageDays?: number;
  /** Per-record override — normally absent; the CLI flag sets the run-wide basis. */
  currency?: string;
  fxRate?: number;
  soldN: HarvestQuad;
  soldU: HarvestQuad;
  stockN: HarvestQuad;
  stockU: HarvestQuad;
}

function toPgSummaryQuad(h: HarvestQuad | undefined): PgSummaryQuad {
  if (!h) return { ...EMPTY_PG_SUMMARY_QUAD };
  return { lots: h.lots ?? 0, qty: h.qty ?? 0, min: h.min ?? null, avg: h.avg ?? null, qavg: h.qavg ?? null, max: h.max ?? null };
}

/** Multiply a quad's price fields by `rate` (used to convert USD blobs to GBP). */
function convertQuad(q: PgSummaryQuad, rate: number): PgSummaryQuad {
  const c = (v: number | null) => (v == null ? null : +(v * rate).toFixed(4));
  return { lots: q.lots, qty: q.qty, min: c(q.min), avg: c(q.avg), qavg: c(q.qavg), max: c(q.max) };
}

// ---------------------------------------------------------------------------
// File discovery + parsing
// ---------------------------------------------------------------------------

interface QuarantineEntry {
  file: string;
  record: unknown;
  reason: string;
}

function parseJsonHarvestFile(filePath: string): HarvestRec[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path.basename(filePath)}: expected a JSON array of harvest records`);
  }
  return parsed as HarvestRec[];
}

/** BSX files carry no PG quadrant fields in the real pipeline (see file header
 * comment) — detect and report rather than silently import empty rows. */
function reportBsxFile(filePath: string): void {
  console.warn(
    `  ⚠ ${path.basename(filePath)}: BrickStore .bsx inventory exports don't carry price-guide quadrant ` +
      `data — skipped. Use the decoded SQLite→JSON harvest batch instead (see file header comment).`,
  );
}

// ---------------------------------------------------------------------------
// Queue tier lookup (for the next_due_at update)
// ---------------------------------------------------------------------------

async function fetchQueueTiers(tuples: { item_type: PgItemType; item_no: string; colour_id: number }[]): Promise<Map<string, 'active' | 'tail'>> {
  const tiers = new Map<string, 'active' | 'tail'>();
  const itemNos = [...new Set(tuples.map((t) => t.item_no))];
  const CHUNK = 300;
  const PAGE = 1000;
  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const chunk = itemNos.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('bl_pg_refresh_queue')
        .select('item_type,item_no,colour_id,tier')
        .in('item_no', chunk)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`queue tier lookup failed: ${error.message}`);
      for (const r of data ?? []) tiers.set(`${r.item_type}:${r.item_no}:${r.colour_id}`, r.tier as 'active' | 'tail');
      if ((data ?? []).length < PAGE) break;
    }
  }
  return tiers;
}

async function updateQueueRows(rows: PgSummaryCacheRow[], tiers: Map<string, 'active' | 'tail'>): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    const key = `${row.item_type}:${row.item_no}:${row.colour_id}`;
    const tier = tiers.get(key);
    if (!tier) continue; // no queue row yet — pg-universe.ts --seed-from-cache will create one later
    // Lane B only refreshes L1 (worldwide summary). Active-tier tuples' 28-day clock
    // schedules lane D's UK-grade L3 refresh — a worldwide-only import must NOT
    // satisfy it (review finding #3), so active rows keep their next_due_at.
    if (tier !== 'tail') continue;
    const now = new Date();
    const { error } = await supabase
      .from('bl_pg_refresh_queue')
      .update({
        last_refreshed_at: now.toISOString(),
        next_due_at: new Date(now.getTime() + 90 * 86400000).toISOString(),
        attempts: 0,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq('item_type', row.item_type)
      .eq('item_no', row.item_no)
      .eq('colour_id', row.colour_id);
    if (error) {
      console.error(`  ⚠ queue update failed for ${key}: ${error.message}`);
      continue;
    }
    updated++;
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

async function writeTelemetry(ok: number, failed: number, startedAt: string): Promise<void> {
  const { error } = await supabase.from('bl_pg_lane_telemetry').insert({
    lane: 'brickstore_batch',
    session_no: 1,
    requests: ok + failed,
    ok,
    failed,
    first_block_at_request: null,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    notes: 'pg-harvest-import.ts local ingest (no HTTP requests — decoded harvest file import)',
  });
  if (error) console.error(`  ⚠ telemetry insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (!fs.existsSync(DIR!) || !fs.statSync(DIR!).isDirectory()) {
    console.error(`--dir not found or not a directory: ${DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(DIR!).filter((f) => !fs.statSync(path.join(DIR!, f)).isDirectory());
  if (files.length === 0) {
    console.log('[harvest-import] no files found in --dir.');
    return;
  }
  console.log(`[harvest-import] ${files.length} file(s) in ${DIR}`);

  const goodRows: PgSummaryCacheRow[] = [];
  const quarantine: QuarantineEntry[] = [];

  for (const file of files) {
    const filePath = path.join(DIR!, file);
    if (/\.bsx$/i.test(file) || file.trim().startsWith('<')) {
      reportBsxFile(filePath);
      continue;
    }
    if (!/\.json$/i.test(file)) {
      console.log(`  skipping ${file} (not .json or .bsx)`);
      continue;
    }
    let recs: HarvestRec[];
    try {
      recs = parseJsonHarvestFile(filePath);
    } catch (e) {
      console.error(`  ⚠ ${file}: failed to parse — ${(e as Error).message}`);
      quarantine.push({ file, record: null, reason: `parse error: ${(e as Error).message}` });
      continue;
    }
    console.log(`  ${file}: ${recs.length} records`);

    for (const rec of recs) {
      const itemNo = rec.itemNo ?? rec.part;
      const colourId = rec.colourId ?? rec.colour ?? 0;
      const itemType: PgItemType = rec.itemType ?? 'P';
      if (!itemNo) {
        quarantine.push({ file, record: rec, reason: 'missing item number (part/itemNo)' });
        continue;
      }

      // Resolve this record's currency basis: per-record override wins, else the
      // CLI-wide basis. A record claiming non-GBP with no resolvable rate is
      // quarantined by validateCurrencyBasis below rather than assumed GBP.
      const recCurrency = rec.currency ?? (GBP_NATIVE ? 'GBP' : 'USD');
      const recFxRate = rec.fxRate ?? (GBP_NATIVE ? null : FX_RATE);

      let soldN = toPgSummaryQuad(rec.soldN);
      let soldU = toPgSummaryQuad(rec.soldU);
      let stockN = toPgSummaryQuad(rec.stockN);
      let stockU = toPgSummaryQuad(rec.stockU);
      let finalCurrency = recCurrency;
      const finalFxRate = recFxRate ?? null;

      if (recCurrency !== 'GBP' && recFxRate != null && recFxRate > 0) {
        soldN = convertQuad(soldN, recFxRate);
        soldU = convertQuad(soldU, recFxRate);
        stockN = convertQuad(stockN, recFxRate);
        stockU = convertQuad(stockU, recFxRate);
        finalCurrency = 'GBP'; // values are now GBP-converted; fx_rate records the rate used
      }

      const row = toSummaryCacheRow(
        { itemType, itemNo, colourId },
        { soldN, soldU, stockN, stockU },
        `brickstore_batch${finalFxRate ? `_usd@${finalFxRate}` : ''}`,
        'brickstore_batch',
        {
          currency: finalCurrency,
          fxRate: finalFxRate,
          fetchedAt: rec.ageDays != null ? new Date(Date.now() - rec.ageDays * 86400000).toISOString() : undefined,
        },
      );

      const validation = validateCurrencyBasis(row);
      if (!validation.ok) {
        quarantine.push({ file, record: rec, reason: validation.reason ?? 'currency validation failed' });
        continue;
      }
      goodRows.push(row);
    }
  }

  console.log(`\n[harvest-import] parsed: ${goodRows.length} good, ${quarantine.length} quarantined`);

  if (goodRows.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < goodRows.length; i += CHUNK) {
      const { error } = await supabase
        .from('bricklink_pg_summary_cache')
        .upsert(goodRows.slice(i, i + CHUNK), { onConflict: 'item_type,item_no,colour_id' });
      if (error) {
        console.error(`  ⚠ upsert failed at offset ${i}: ${error.message}`);
        // Move this chunk's records to quarantine rather than lose them silently.
        for (const r of goodRows.slice(i, i + CHUNK)) {
          quarantine.push({ file: 'upsert-batch', record: r, reason: `upsert failed: ${error.message}` });
        }
      }
      if ((i + CHUNK) % 5000 < CHUNK) console.log(`  upserted ${Math.min(i + CHUNK, goodRows.length)}/${goodRows.length}`);
    }

    console.log('[harvest-import] updating bl_pg_refresh_queue for imported tuples...');
    const tiers = await fetchQueueTiers(goodRows.map((r) => ({ item_type: r.item_type, item_no: r.item_no, colour_id: r.colour_id })));
    const updated = await updateQueueRows(goodRows, tiers);
    console.log(`  ${updated}/${goodRows.length} queue rows updated (rest have no queue row yet)`);
  }

  if (quarantine.length > 0) {
    const qFile = QUARANTINE_OVERRIDE ?? path.join(DIR!, `pg-harvest-quarantine-${Date.now()}.json`);
    fs.writeFileSync(qFile, JSON.stringify(quarantine, null, 2));
    console.log(`\n[harvest-import] ${quarantine.length} record(s) quarantined -> ${qFile}`);
  }

  await writeTelemetry(goodRows.length, quarantine.length, startedAt);
  console.log('\n[harvest-import] done.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
