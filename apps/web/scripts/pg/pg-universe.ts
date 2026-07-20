/**
 * Lane E universe build/diff (spec §2.2 lane E, §4.1, §4.6 monthly ~7th-10th job).
 *
 * Two independent, idempotent modes:
 *
 *   --seed-from-cache
 *     Reads every tuple already in `bricklink_pg_summary_cache` (the 111k-tuple L1
 *     layer built by the 2026-07-07 BrickStore harvest) and inserts any missing
 *     `bl_pg_refresh_queue` rows for them (tier='tail', next_due_at spread randomly
 *     over the next 90 days — avoids a thundering herd on day 1 of the refresh
 *     cycle). Ranking (`rank_score`) is left at 0; that's `pg-rank.ts`'s job (P1).
 *
 *   --catalog-dir=<dir>
 *     Parses BrickLink catalog-download files (tab-separated .txt) and diffs them
 *     against the existing queue, inserting genuinely new tuples with
 *     `grace_until = now() + 6 months`, `tier='active'`, `next_due_at=now()` — the
 *     new-release grace rule (spec §4.1): new tuples get UK-grade detail
 *     immediately regardless of rank, because they have no sales history yet.
 *
 *     Expected files in the directory (BrickLink source: manually downloaded/CDP'd
 *     from https://www.bricklink.com/catalogDownload.asp — one POST per file,
 *     "Number of Records" -> "Save As" tab-separated text):
 *       - Parts.txt              (Category, Number, Name, ...)              — logged only
 *       - "Part and Color Codes" / codes.txt (Number, Colour, ...)          — generates P tuples
 *       - Minifigs.txt            (Number, Name, ...)                       — generates M tuples
 *       - Sets.txt                (Number, Name, ...)                       — generates S tuples
 *     Header names vary release to release — detection below is deliberately liberal
 *     (case-insensitive, several aliases per column).
 *
 * Both modes are safe to re-run: seed-from-cache only inserts rows that don't
 * already exist (`ignoreDuplicates`); catalog-dir diffs against the current queue
 * before inserting.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-universe.ts --seed-from-cache
 *   npx tsx scripts/pg/pg-universe.ts --catalog-dir="C:/Users/Chris Hadley/Downloads/bl-catalog-2026-07"
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const SEED_FROM_CACHE = argv['seed-from-cache'] === 'true';
const CATALOG_DIR = argv['catalog-dir'] ? path.resolve(process.cwd(), argv['catalog-dir']) : null;

if (!SEED_FROM_CACHE && !CATALOG_DIR) {
  console.error('Required: --seed-from-cache OR --catalog-dir=<dir>');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

interface Tuple {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
}

function tupleKey(t: Tuple): string {
  return `${t.item_type}:${t.item_no}:${t.colour_id}`;
}

// ---------------------------------------------------------------------------
// --seed-from-cache
// ---------------------------------------------------------------------------

async function readAllSummaryCacheTuples(): Promise<Tuple[]> {
  const PAGE = 1000;
  const out: Tuple[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bricklink_pg_summary_cache')
      .select('item_type,item_no,colour_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`summary-cache read failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Tuple[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (out.length % 10000 === 0) console.log(`  read ${out.length} tuples so far...`);
  }
  return out;
}

async function seedFromCache(): Promise<void> {
  console.log('[seed-from-cache] reading bricklink_pg_summary_cache (paginated)...');
  const tuples = await readAllSummaryCacheTuples();
  console.log(`[seed-from-cache] ${tuples.length} tuples in L1`);

  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 86400000;
  const rows = tuples.map((t) => ({
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    tier: 'tail' as const,
    rank_score: 0,
    // These tuples are L1-covered — stamp seeded_at so gap-fill mode
    // (`pg-residual-fill.ts`, which selects last_refreshed_at IS NULL AND seeded_at
    // IS NULL) never has to wade through 111k covered rows to find genuine gaps.
    // NEVER last_refreshed_at: that field means "actually scraped" and pre-stamping
    // it made ~78k rows read as UK-fresh when they'd never been fetched
    // (2026-07-20 coverage audit — the whole seed-stamp lie).
    seeded_at: new Date(now).toISOString(),
    // Spread next_due_at randomly over the next 90 days to avoid a thundering herd
    // when the tail rotation (lane B) first turns this queue on.
    next_due_at: new Date(now + Math.random() * NINETY_DAYS_MS).toISOString(),
  }));

  const CHUNK = 1000;
  let attempted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('bl_pg_refresh_queue')
      .upsert(slice, { onConflict: 'item_type,item_no,colour_id', ignoreDuplicates: true });
    if (error) throw new Error(`queue upsert failed at offset ${i}: ${error.message}`);
    attempted += slice.length;
    if (attempted % 10000 === 0) console.log(`  upserted ${attempted}/${rows.length} (existing rows left untouched)`);
  }
  console.log(`[seed-from-cache] done — ${rows.length} tuples offered to the queue (ignoreDuplicates: existing rows untouched).`);
}

// ---------------------------------------------------------------------------
// --catalog-dir
// ---------------------------------------------------------------------------

/** Liberal tab-separated parser: header row → column-index lookup by name aliases. */
function parseTsv(filePath: string): { headers: string[]; rows: string[][] } {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split('\t'));
  return { headers, rows };
}

function findColumn(headers: string[], aliases: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.toLowerCase());
    if (idx >= 0) return idx;
  }
  // fallback: partial match
  for (const alias of aliases) {
    const idx = lower.findIndex((h) => h.includes(alias.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function findFile(dir: string, candidates: string[]): string | null {
  const entries = fs.readdirSync(dir);
  for (const cand of candidates) {
    const hit = entries.find((e) => e.toLowerCase() === cand.toLowerCase());
    if (hit) return path.join(dir, hit);
  }
  // liberal: any file whose name contains the first candidate's stem
  const stem = candidates[0].replace(/\.txt$/i, '').toLowerCase();
  const hit = entries.find((e) => e.toLowerCase().includes(stem));
  return hit ? path.join(dir, hit) : null;
}

function parsePartColourCodes(filePath: string): Tuple[] {
  const { headers, rows } = parseTsv(filePath);
  const numCol = findColumn(headers, ['Number', 'Part Number', 'PartNumber', 'No']);
  const colCol = findColumn(headers, ['Color', 'Colour', 'Color ID', 'ColorID', 'ColourID']);
  if (numCol < 0 || colCol < 0) {
    console.warn(`  ⚠ ${path.basename(filePath)}: couldn't find Number/Colour columns (headers: ${headers.join(', ')})`);
    return [];
  }
  const out: Tuple[] = [];
  for (const r of rows) {
    const no = (r[numCol] ?? '').trim();
    const colourRaw = (r[colCol] ?? '').trim();
    if (!no || colourRaw === '') continue;
    const colour = parseInt(colourRaw, 10);
    if (!Number.isFinite(colour)) continue;
    out.push({ item_type: 'P', item_no: no, colour_id: colour });
  }
  return out;
}

function parseSimpleNumberList(filePath: string, itemType: PgItemType): Tuple[] {
  const { headers, rows } = parseTsv(filePath);
  const numCol = findColumn(headers, ['Number', 'Set Number', 'Minifig Number', 'No', 'ItemID', 'Item No']);
  if (numCol < 0) {
    console.warn(`  ⚠ ${path.basename(filePath)}: couldn't find a Number column (headers: ${headers.join(', ')})`);
    return [];
  }
  const out: Tuple[] = [];
  for (const r of rows) {
    const no = (r[numCol] ?? '').trim();
    if (!no) continue;
    out.push({ item_type: itemType, item_no: no, colour_id: 0 });
  }
  return out;
}

async function readAllQueueTuples(): Promise<Set<string>> {
  const PAGE = 1000;
  const set = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bl_pg_refresh_queue')
      .select('item_type,item_no,colour_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`queue read failed at offset ${from}: ${error.message}`);
    const rows = (data ?? []) as Tuple[];
    for (const r of rows) set.add(tupleKey(r));
    if (rows.length < PAGE) break;
  }
  return set;
}

async function catalogDirDiff(): Promise<void> {
  const dir = CATALOG_DIR!;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`--catalog-dir not found or not a directory: ${dir}`);
    process.exit(1);
  }
  console.log(`[catalog-dir] scanning ${dir}...`);

  const partsFile = findFile(dir, ['Parts.txt']);
  const codesFile = findFile(dir, ['Part and Color Codes.txt', 'codes.txt', 'PartColorCodes.txt']);
  const minifigsFile = findFile(dir, ['Minifigs.txt']);
  const setsFile = findFile(dir, ['Sets.txt']);

  if (partsFile) {
    const { rows } = parseTsv(partsFile);
    console.log(`  Parts.txt: ${rows.length} part rows (catalog reference only — colour combos come from the codes file)`);
  } else {
    console.log('  Parts.txt: not found (informational only, not required)');
  }

  const newTuples: Tuple[] = [];
  const counts: Record<string, number> = { P: 0, M: 0, S: 0 };

  if (codesFile) {
    const codeTuples = parsePartColourCodes(codesFile);
    console.log(`  ${path.basename(codesFile)}: ${codeTuples.length} part+colour combos parsed`);
    newTuples.push(...codeTuples);
  } else {
    console.warn('  ⚠ Part and Color Codes file not found — no P tuples will be diffed this run');
  }

  if (minifigsFile) {
    const figTuples = parseSimpleNumberList(minifigsFile, 'M');
    console.log(`  ${path.basename(minifigsFile)}: ${figTuples.length} minifigs parsed`);
    newTuples.push(...figTuples);
  } else {
    console.warn('  ⚠ Minifigs.txt not found — no M tuples will be diffed this run');
  }

  if (setsFile) {
    const setTuples = parseSimpleNumberList(setsFile, 'S');
    console.log(`  ${path.basename(setsFile)}: ${setTuples.length} sets parsed`);
    newTuples.push(...setTuples);
  } else {
    console.warn('  ⚠ Sets.txt not found — no S tuples will be diffed this run');
  }

  if (newTuples.length === 0) {
    console.log('[catalog-dir] nothing parsed — check the directory contents/headers.');
    return;
  }

  console.log('[catalog-dir] reading existing queue tuples for diff (paginated)...');
  const existing = await readAllQueueTuples();
  console.log(`  ${existing.size} tuples already in bl_pg_refresh_queue`);

  const seenThisRun = new Set<string>();
  const toInsert: Tuple[] = [];
  for (const t of newTuples) {
    const key = tupleKey(t);
    if (existing.has(key) || seenThisRun.has(key)) continue;
    seenThisRun.add(key);
    toInsert.push(t);
    counts[t.item_type] = (counts[t.item_type] ?? 0) + 1;
  }
  console.log(`[catalog-dir] ${toInsert.length} genuinely new tuples (P=${counts.P ?? 0}, M=${counts.M ?? 0}, S=${counts.S ?? 0})`);

  if (toInsert.length === 0) {
    console.log('[catalog-dir] queue already covers the full parsed catalog — nothing to insert.');
    return;
  }

  const now = new Date();
  const graceUntil = new Date(now.getTime() + 6 * 30 * 86400000).toISOString(); // ~6 months
  const rows = toInsert.map((t) => ({
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    tier: 'active' as const,
    rank_score: 0,
    rank_floor: 'new_release',
    grace_until: graceUntil,
    next_due_at: now.toISOString(),
  }));

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('bl_pg_refresh_queue')
      .upsert(slice, { onConflict: 'item_type,item_no,colour_id', ignoreDuplicates: true });
    if (error) throw new Error(`new-tuple insert failed at offset ${i}: ${error.message}`);
    if ((i + CHUNK) % 10000 < CHUNK) console.log(`  inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  console.log(`[catalog-dir] done — ${rows.length} new-release tuples inserted (active tier, 6-month grace).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (SEED_FROM_CACHE) await seedFromCache();
  if (CATALOG_DIR) await catalogDirDiff();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
