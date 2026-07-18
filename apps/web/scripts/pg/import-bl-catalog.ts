/**
 * Import a BL catalogue download TSV into bl_catalog_items (intl-set-arb F1).
 *
 * Input = the tab-delimited file from https://www.bricklink.com/catalogDownload.asp
 * (downloadType=T, selYear=Y, selWeight=Y, selDim=Y), fetched through the logged-in
 * CDP Chrome. Column layouts differ by item type:
 *   S (sets):  Category ID, Category Name, Number, Name, Year Released, Weight, Dimensions
 *   P (parts): Category ID, Category Name, Number, Name, [Alternate No], Weight, Dimensions
 * The header row is parsed to locate columns by name — never by fixed index.
 *
 * Weight '?' and dims '? x ? x ?' mean BL doesn't know — stored as NULL, never 0.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/import-bl-catalog.ts --file=../../tmp/bl-sets-catalog.tsv --item-type=S
 *   npx tsx scripts/pg/import-bl-catalog.ts --file=../../tmp/bl-parts-catalog.tsv --item-type=P
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => {
  const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a;
}, {});
const FILE = argv['file'];
const ITEM_TYPE = argv['item-type'];
if (!FILE || !ITEM_TYPE || !/^[PSMGBCIO]$/.test(ITEM_TYPE)) {
  console.error('Usage: --file=<tsv> --item-type=P|S|M|...');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || t === '?') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "10 x 20 x 5.5" (cm, may contain '?') -> [x, y, z] with nulls. */
function parseDims(v: string | undefined): [number | null, number | null, number | null] {
  if (!v) return [null, null, null];
  const parts = v.split('x').map((p) => parseNum(p));
  return [parts[0] ?? null, parts[1] ?? null, parts[2] ?? null];
}

async function main() {
  const raw = fs.readFileSync(path.resolve(FILE), 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase().startsWith(name.toLowerCase()));
  const iCat = col('Category ID'), iCatName = col('Category Name'), iNo = col('Number'),
    iName = col('Name'), iYear = col('Year'), iWeight = col('Weight'), iDims = col('Dimensions');
  if (iNo < 0 || iName < 0) throw new Error(`Header missing Number/Name: ${header.join(' | ')}`);

  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split('\t');
    const no = (c[iNo] ?? '').trim();
    if (!no) continue;
    const [dx, dy, dz] = parseDims(iDims >= 0 ? c[iDims] : undefined);
    rows.push({
      item_type: ITEM_TYPE,
      item_no: no,
      category_id: iCat >= 0 ? parseNum(c[iCat]) : null,
      category_name: iCatName >= 0 ? (c[iCatName] ?? '').trim() || null : null,
      item_name: (c[iName] ?? '').trim(),
      year_released: iYear >= 0 ? parseNum(c[iYear]) : null,
      weight_g: iWeight >= 0 ? parseNum(c[iWeight]) : null,
      dim_x_cm: dx, dim_y_cm: dy, dim_z_cm: dz,
      imported_at: new Date().toISOString(),
    });
  }
  console.log(`[import-bl-catalog] ${rows.length} ${ITEM_TYPE} rows parsed from ${path.basename(FILE)}`);

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('bl_catalog_items').upsert(rows.slice(i, i + CHUNK), { onConflict: 'item_type,item_no' });
    if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
    if ((i / CHUNK) % 10 === 0) console.log(`  upserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  const withW = rows.filter((r) => r.weight_g != null).length;
  console.log(`[import-bl-catalog] done — ${rows.length} upserted, ${withW} with weight (${((100 * withW) / rows.length).toFixed(0)}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
