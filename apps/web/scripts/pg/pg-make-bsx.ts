/**
 * Lane B BSX generator — manual-assist path for the fortnightly ritual (spec §2.2 lane B,
 * §3 F1: "BSX generator retained as the manual-assist path for the fortnightly lane B
 * ritual"). Promotion of the 2026-07-07 POC (`_build-coverage-bsx.ts`), generalised from
 * "rebuild the whole coverage queue from a Rebrickable dump" to "emit a BrickStore-ready
 * .bsx for whatever tuple set the caller hands it" — the queue-driven `--due-tail` mode is
 * the one the standing ritual actually uses.
 *
 * THE RITUAL (spec §4.6, ~15 min every fortnight, the one manual step in the whole
 * pipeline):
 *   1. Run this script (`--due-tail`, default) to produce one or more .bsx files.
 *   2. Open BrickStore -> File > Open -> select the .bsx (repeat per file if chunked).
 *   3. Select all items -> mass-update Price Guide info (Ctrl+G / the BrickStore batch
 *      price-guide fetch) — this populates BrickStore's LOCAL SQLite price-guide cache
 *      (`%LOCALAPPDATA%\BrickStore\cache\priceguide_cache.sqlite`), NOT the .bsx file
 *      itself (BrickStore's .bsx Item schema carries no price-guide quadrant fields —
 *      see pg-harvest-import.ts's header comment).
 *   4. Save (optional — the SQLite cache is already populated regardless).
 *   5. Decode the SQLite cache to the flat JSON harvest-batch format (see memory
 *      `bl-pg-summary-coverage` for the decoder) and run:
 *        npx tsx scripts/pg/pg-harvest-import.ts --dir=<decoded batch dir> --fx-rate=<rate>
 *      This is the step that actually writes `bricklink_pg_summary_cache` and bumps the
 *      tail tuples' `next_due_at` by 90 days.
 *
 * This script's ONLY job is step 1 — building the input .bsx(es). It never talks to
 * BrickStore itself and never writes price data anywhere.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-make-bsx.ts                                   # --due-tail, days=14
 *   npx tsx scripts/pg/pg-make-bsx.ts --due-tail --days=21
 *   npx tsx scripts/pg/pg-make-bsx.ts --tuples-file=../../tmp/my-tuples.json
 *   npx tsx scripts/pg/pg-make-bsx.ts --chunk=2000 --out-dir=C:/harvest/2026-07-21
 *
 * Flags:
 *   --due-tail            Default mode: pull tuples from `bl_pg_refresh_queue` where
 *                           tier='tail' AND next_due_at < now()+`--days` days.
 *   --days=<n>              Window for --due-tail (default 14 — the fortnightly cadence;
 *                           spec math: ~45k tail tuples / 90d cycle ≈ 7k per 14-day window).
 *   --tuples-file=<path>    Alternative input: a JSON file, either a bare array of tuples or
 *                           `{ "tuples": [...] }`. Each tuple accepts camelCase
 *                           (itemType/itemNo/colourId) or snake_case (item_type/item_no/
 *                           colour_id) keys. Mutually exclusive with --due-tail.
 *   --chunk=<n>              Items per output .bsx file (default 5000).
 *   --out-dir=<path>          Output directory (default repo-root/tmp/bsx/<YYYY-MM-DD>/).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const TUPLES_FILE = argv['tuples-file'] ? path.resolve(process.cwd(), argv['tuples-file']) : null;
const DUE_TAIL = TUPLES_FILE ? argv['due-tail'] === 'true' : true; // default mode when no --tuples-file
if (TUPLES_FILE && argv['due-tail'] === 'true') {
  console.error('Pass only one of --due-tail or --tuples-file, not both.');
  process.exit(1);
}
const DAYS = Math.max(1, parseInt(argv['days'] ?? '14', 10));
const CHUNK = Math.max(1, parseInt(argv['chunk'] ?? '5000', 10));
const REPORT_DATE = new Date().toISOString().slice(0, 10);
// repo-root/tmp/bsx/<date> (this file is apps/web/scripts/pg/ -> 4 levels up to repo root).
const OUT_DIR = argv['out-dir']
  ? path.resolve(process.cwd(), argv['out-dir'])
  : path.resolve(__dirname, '../../../../tmp/bsx', REPORT_DATE);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Tuple type + input resolution
// ---------------------------------------------------------------------------

interface BsxTuple {
  itemType: PgItemType;
  itemNo: string;
  colourId: number;
}

const PAGE = 1000;

/** Pull tail-tier tuples due within the next `days` days (spec §4.1 lane B tail rotation). */
async function loadDueTail(days: number): Promise<BsxTuple[]> {
  const cutoff = new Date(Date.now() + days * 86400000).toISOString();
  const out: BsxTuple[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bl_pg_refresh_queue')
      .select('item_type,item_no,colour_id,next_due_at')
      .eq('tier', 'tail')
      .lt('next_due_at', cutoff)
      .order('next_due_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`due-tail read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) out.push({ itemType: r.item_type as PgItemType, itemNo: r.item_no, colourId: r.colour_id });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Accepts camelCase or snake_case tuple objects from a --tuples-file JSON. */
function normaliseTupleLike(o: Record<string, unknown>): BsxTuple | null {
  const itemType = (o.itemType ?? o.item_type) as string | undefined;
  const itemNo = (o.itemNo ?? o.item_no ?? o.part) as string | undefined;
  const colourIdRaw = o.colourId ?? o.colour_id ?? o.colour ?? 0;
  if (!itemType || !itemNo) return null;
  const t = itemType.toUpperCase();
  if (t !== 'P' && t !== 'S' && t !== 'M') return null;
  const colourId = typeof colourIdRaw === 'number' ? colourIdRaw : parseInt(String(colourIdRaw), 10);
  return { itemType: t as PgItemType, itemNo: String(itemNo), colourId: Number.isFinite(colourId) ? colourId : 0 };
}

function loadFromTuplesFile(file: string): BsxTuple[] {
  if (!fs.existsSync(file)) {
    console.error(`--tuples-file not found: ${file}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.tuples) ? raw.tuples : [];
  const out: BsxTuple[] = [];
  let skipped = 0;
  for (const entry of list) {
    if (entry && typeof entry === 'object') {
      const t = normaliseTupleLike(entry as Record<string, unknown>);
      if (t) out.push(t);
      else skipped++;
    } else {
      skipped++;
    }
  }
  if (skipped > 0) console.warn(`  ⚠ ${skipped} entr(y/ies) in ${path.basename(file)} could not be parsed as a tuple — skipped`);
  return out;
}

// ---------------------------------------------------------------------------
// BSX XML emission — byte-compatible with the POC's shape (_build-coverage-bsx.ts /
// _tmp-jabbz-gapfill-bsx.ts / _tmp-delta-bsx.ts all agree on this tag structure; BrickStore
// accepted it in every 2026-07-07/08 harvest run).
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bsxXml(items: Array<{ tuple: BsxTuple; remark: string }>): string {
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<BrickStoreXML>', ' <Inventory>'];
  for (const { tuple, remark } of items) {
    xml.push(
      `  <Item><ItemID>${esc(tuple.itemNo)}</ItemID><ItemTypeID>${tuple.itemType}</ItemTypeID><ColorID>${tuple.colourId}</ColorID><Qty>1</Qty><Price>0</Price><Condition>N</Condition><Remarks>${esc(remark)}</Remarks></Item>`,
    );
  }
  xml.push(' </Inventory>', '</BrickStoreXML>');
  return xml.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let tuples: BsxTuple[];
  let modeLabel: string;

  if (TUPLES_FILE) {
    tuples = loadFromTuplesFile(TUPLES_FILE);
    modeLabel = `--tuples-file=${path.basename(TUPLES_FILE)}`;
  } else if (DUE_TAIL) {
    tuples = await loadDueTail(DAYS);
    modeLabel = `--due-tail --days=${DAYS}`;
  } else {
    console.error('No input mode resolved — pass --due-tail (default) or --tuples-file=<path>.');
    process.exit(1);
    return;
  }

  // Dedupe on BL identity (defensive — queue/tuples-file should already be unique on the
  // composite key, but a caller-supplied file might not be).
  const seen = new Set<string>();
  const deduped: BsxTuple[] = [];
  for (const t of tuples) {
    const key = `${t.itemType}:${t.itemNo}:${t.itemType === 'P' ? t.colourId : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...t, colourId: t.itemType === 'P' ? t.colourId : 0 });
  }

  const byType = { P: 0, S: 0, M: 0 } as Record<PgItemType, number>;
  for (const t of deduped) byType[t.itemType]++;
  console.log(`[pg-make-bsx] mode: ${modeLabel}`);
  console.log(`[pg-make-bsx] ${tuples.length} tuple(s) resolved, ${deduped.length} unique (P=${byType.P} S=${byType.S} M=${byType.M})`);

  if (deduped.length === 0) {
    console.log('[pg-make-bsx] nothing to write — no tuples resolved.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let fileNo = 0;
  const written: string[] = [];
  for (let i = 0; i < deduped.length; i += CHUNK) {
    fileNo++;
    const slice = deduped.slice(i, i + CHUNK);
    const items = slice.map((tuple, idx) => ({ tuple, remark: `rank${i + idx + 1}` }));
    const xml = bsxXml(items);
    const name = `pg-tail-${REPORT_DATE}-${String(fileNo).padStart(2, '0')}-ranks${i + 1}-${i + slice.length}.bsx`;
    const filePath = path.join(OUT_DIR, name);
    fs.writeFileSync(filePath, xml);
    written.push(filePath);
    console.log(`  wrote ${name} (${slice.length} items)`);
  }

  console.log(`\n[pg-make-bsx] done: ${written.length} file(s), ${deduped.length} total items -> ${OUT_DIR}`);
  console.log(`[pg-make-bsx] next step: open BrickStore, File > Open each .bsx above, mass-update Price Guide info, save,`);
  console.log(`[pg-make-bsx] then decode the SQLite cache and run: npx tsx scripts/pg/pg-harvest-import.ts --dir=<decoded batch dir> --fx-rate=<rate>`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
