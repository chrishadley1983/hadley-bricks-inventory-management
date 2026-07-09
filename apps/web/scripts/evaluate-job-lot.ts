/**
 * Job-lot evaluator (cached-only).
 *
 * Scores a prospective bulk lot for part-out quality BEFORE buying — expected
 * list value (Bricqer formula), liquidity mix (liquid vs dead vs blind), picking
 * drag, and a BUY/PASS verdict vs the asking price. Makes ZERO external API
 * calls; uses the unified price cache (readPriceGuide) + a snapshot-derived
 * colour crosswalk.
 *
 * Colour bridge (framework §1.1): BSX carries BrickLink colour-ids. We chain
 * BL colour-id → colour name (from our own BL order_items) → Bricqer colour-id
 * (from the snapshot), then hand readPriceGuide the Bricqer id with
 * scheme:'bricqer' — the shared colour map normalises it back to the canonical
 * BL id used by bricklink_price_guide_cache.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/evaluate-job-lot.ts --bsx=lot.bsx --asking=25
 *   npx tsx scripts/evaluate-job-lot.ts --csv=lot.csv --asking=25 --min-roi=1.0
 *
 * CSV manifest columns (header row): item_number, color_name|color_id, condition, quantity
 *
 * Flags:
 *   --bsx=<path> | --csv=<path>   manifest (one required)
 *   --asking=<gbp>                total asking price for the lot (for the verdict)
 *   --min-roi=<x>                 required profit ÷ outlay to BUY (default 1.0 = 2×)
 *   --top=<n>                     rows in the value table (default 20)
 *   --user-id=<uuid>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { projectListPrice, VAR_FEE_PCT } from '../src/lib/store-quality/pricing';
import { readPriceGuide, pgKey, type ItemRef } from '../src/lib/bricklink/price-guide/read';
import { loadColourMap } from '../src/lib/bricklink/colour-map';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});
const BSX = argv['bsx'] && argv['bsx'] !== 'true' ? argv['bsx'] : null;
const CSV = argv['csv'] && argv['csv'] !== 'true' ? argv['csv'] : null;
const ASKING = argv['asking'] ? parseFloat(argv['asking']) : null;
const MIN_ROI = parseFloat(argv['min-roi'] ?? '1.0');
const TOP = parseInt(argv['top'] ?? '20', 10);
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

if (!BSX && !CSV) {
  console.error('Required: --bsx=<path> or --csv=<path>');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();
const num = (v: any) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

interface ManifestItem {
  itemType: 'P' | 'M'; // BSX ItemTypeID (CSV manifests default to 'P')
  itemNumber: string;
  colorId: number | null; // BL colour id (from BSX) — may be null for CSV-by-name
  colorName: string | null;
  condition: 'N' | 'U';
  qty: number;
}

function parseBsx(file: string): ManifestItem[] {
  const xml = fs.readFileSync(file, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml);
  const inv = doc?.BrickStoreXML?.Inventory?.Item ?? doc?.Inventory?.Item ?? [];
  const arr = Array.isArray(inv) ? inv : [inv];
  return arr
    .filter((it: any) => (it.ItemTypeID ?? 'P') === 'P' || (it.ItemTypeID ?? 'P') === 'M')
    .map((it: any) => ({
      itemType: ((it.ItemTypeID ?? 'P') === 'M' ? 'M' : 'P') as 'P' | 'M',
      itemNumber: String(it.ItemID),
      colorId: it.ColorID != null ? parseInt(String(it.ColorID), 10) : null,
      colorName: it.ColorName ? String(it.ColorName) : null,
      condition: (String(it.Condition) === 'U' ? 'U' : 'N') as 'N' | 'U',
      qty: parseInt(String(it.Qty ?? '1'), 10) || 1,
    }));
}

function parseCsv(file: string): ManifestItem[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const out: ManifestItem[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const cond = (c[idx('condition')] ?? 'U').trim();
    out.push({
      itemType: 'P',
      itemNumber: (c[idx('item_number')] ?? '').trim(),
      colorId: idx('color_id') >= 0 && c[idx('color_id')]?.trim() ? parseInt(c[idx('color_id')], 10) : null,
      colorName: idx('color_name') >= 0 ? (c[idx('color_name')] ?? '').trim() : null,
      condition: cond === 'U' || cond === 'Used' ? 'U' : 'N',
      qty: parseInt((c[idx('quantity')] ?? '1').trim(), 10) || 1,
    });
  }
  return out.filter((i) => i.itemNumber);
}

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const items = BSX ? parseBsx(BSX) : parseCsv(CSV!);
  if (items.length === 0) {
    console.error('No part/minifig items parsed from manifest.');
    process.exit(1);
  }

  // colour crosswalk: BL colour-id → name (our BL orders), name → Bricqer colour-id (snapshot)
  const blIdToName = new Map<number, string>();
  const nameToBricqerId = new Map<string, number>();
  const blRows = await fetchAll<any>((from, to) =>
    (supabase as any)
      .from('order_items')
      .select('id,color_id,color_name,platform_orders!inner(platform)')
      .eq('platform_orders.platform', 'bricklink')
      .not('color_id', 'is', null)
      .not('color_name', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  );
  for (const r of blRows) if (r.color_id != null && r.color_name) blIdToName.set(r.color_id, r.color_name);

  const snapRows = await fetchAll<any>((from, to) =>
    (supabase as any)
      .from('bricqer_inventory_snapshot')
      .select('bricqer_item_id,color_id,color_name')
      .eq('user_id', USER_ID)
      .not('color_id', 'is', null)
      .not('color_name', 'is', null)
      .order('bricqer_item_id', { ascending: true })
      .range(from, to)
  );
  for (const r of snapRows) if (r.color_name) nameToBricqerId.set(norm(r.color_name), r.color_id);

  // Resolve each item's Bricqer colour-id, then read the unified price cache.
  // Provenance: lookup colour ids come out of the bricqer_inventory_snapshot crosswalk,
  // so refs use scheme:'bricqer' — readPriceGuide normalises them to canonical BL ids
  // via the shared colour map (pagination past the 1000-row cap happens inside it too).
  const resolved = items.map((it) => {
    const colourResolved = it.colorName ?? (it.colorId != null ? blIdToName.get(it.colorId) ?? null : null);
    const bricqerColorId = colourResolved ? nameToBricqerId.get(norm(colourResolved)) ?? null : null;
    return { it, colourResolved, bricqerColorId };
  });
  const cmap = await loadColourMap(supabase);
  const viewKey = (it: ManifestItem, bricqerColorId: number) =>
    pgKey(it.itemType, it.itemNumber, it.itemType === 'P' ? cmap.toBl(bricqerColorId, 'bricqer') : 0);
  const refs: ItemRef[] = [
    ...new Map(
      resolved
        .filter((r) => r.bricqerColorId != null)
        .map((r) => [
          viewKey(r.it, r.bricqerColorId!),
          { itemType: r.it.itemType, itemNo: r.it.itemNumber, colourId: r.bricqerColorId!, scheme: 'bricqer' as const },
        ] as const)
    ).values(),
  ];
  const views = await readPriceGuide(supabase, refs, { ttlDays: 90, allowWorldFallback: false });

  type Row = ManifestItem & {
    colourResolved: string | null;
    bricqerColorId: number | null;
    ma6: number | null;
    strRatio: number | null;
    unitList: number | null;
    lineList: number | null;
    liquidity: 'LIQUID' | 'SLOW' | 'DEAD' | 'PRICED?' | 'BLIND';
  };

  const rows: Row[] = resolved.map(({ it, colourResolved, bricqerColorId }) => {
    const view = bricqerColorId != null ? views.get(viewKey(it, bricqerColorId)) : undefined;
    const side = view && view.coverage === 'uk' ? (it.condition === 'N' ? view.new : view.used) : null;
    const ma6 = side?.soldAvg && side.soldAvg > 0 ? side.soldAvg : null;
    // Legacy sell_through_rate_* stored the qty-based STR ×100 and strRatioFromCache
    // divided it back down — view.strQty IS that raw qty ratio, exactly equivalent.
    const strRatio = side ? side.strQty : null;
    const unitList = projectListPrice(ma6, it.condition === 'N' ? 'New' : 'Used', strRatio);
    const lineList = unitList != null ? unitList * it.qty : null;
    let liquidity: Row['liquidity'];
    if (ma6 == null && strRatio == null) liquidity = 'BLIND';
    else if (strRatio == null) liquidity = 'PRICED?';
    else if (strRatio >= 0.5) liquidity = 'LIQUID';
    else if (strRatio >= 0.05) liquidity = 'SLOW';
    else liquidity = 'DEAD';
    return { ...it, colourResolved, bricqerColorId, ma6, strRatio, unitList, lineList, liquidity };
  });

  // aggregate
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalLots = rows.length;
  const measured = rows.filter((r) => r.lineList != null);
  const measuredValue = measured.reduce((s, r) => s + (r.lineList ?? 0), 0);
  const coverageLots = totalLots ? measured.length / totalLots : 0;
  const valByLiq = (liq: Row['liquidity']) =>
    rows.filter((r) => r.liquidity === liq).reduce((s, r) => s + (r.lineList ?? 0), 0);
  const liquidValue = valByLiq('LIQUID') + valByLiq('SLOW');
  const deadValue = valByLiq('DEAD');
  const blindLots = rows.filter((r) => r.liquidity === 'BLIND').length;
  const subFloorLots = rows.filter((r) => (r.unitList ?? 0) > 0 && (r.unitList ?? 0) < 0.1).length;
  const extrapolatedValue = coverageLots > 0 ? measuredValue / coverageLots : 0;

  // report
  const money = (n: number | null) => (n == null ? '—' : `£${n.toFixed(2)}`);
  const pad = (s: any, w: number) => String(s).padEnd(w);
  const padL = (s: any, w: number) => String(s).padStart(w);

  console.log('═'.repeat(82));
  console.log(`  JOB-LOT EVALUATION — ${path.basename(BSX || CSV || '')}`);
  console.log('═'.repeat(82));
  console.log(`  ${totalLots} lots · ${totalQty} pieces · ${measured.length} lots measured (${Math.round(coverageLots * 100)}% of lots)`);
  console.log('');
  console.log('  VALUE');
  console.log(`    Measured list value      ${money(measuredValue)}  (cached parts only)`);
  console.log(`    Extrapolated (÷coverage) ~${money(extrapolatedValue)}  (rough, if blind parts match measured)`);
  console.log(`    Net of ${(VAR_FEE_PCT * 100).toFixed(1)}% sell fees      ${money(measuredValue * (1 - VAR_FEE_PCT))}`);
  console.log('');
  console.log('  LIQUIDITY MIX (by measured value)');
  const mv = measuredValue || 1;
  console.log(`    Liquid+slow (sellable)   ${money(liquidValue)}  (${Math.round((liquidValue / mv) * 100)}%)`);
  console.log(`    Dead (market STR ~0)     ${money(deadValue)}  (${Math.round((deadValue / mv) * 100)}%)`);
  console.log(`    Priced, STR unknown      ${money(valByLiq('PRICED?'))}`);
  console.log(`    Blind (unmeasured)       ${blindLots} lots`);
  console.log('');
  console.log('  PICKING DRAG');
  console.log(`    ${subFloorLots} lots (${Math.round((subFloorLots / totalLots) * 100)}%) list under 10p · ~${totalLots} picks to list the lot`);
  console.log('');

  // verdict
  const netProceeds = measuredValue * (1 - VAR_FEE_PCT);
  const maxBuy = netProceeds / (1 + MIN_ROI);
  console.log('  VERDICT');
  console.log(`    Confident sell value uses LIQUID+SLOW only: ${money(liquidValue)} (net ${money(liquidValue * (1 - VAR_FEE_PCT))}).`);
  console.log(`    Max buy for ${MIN_ROI.toFixed(1)}× ROI on measured value: ${money(maxBuy)}.`);
  if (ASKING != null) {
    const profit = netProceeds - ASKING;
    const roi = ASKING > 0 ? profit / ASKING : 0;
    const verdict = ASKING <= maxBuy ? 'BUY' : 'PASS';
    console.log(`    Asking ${money(ASKING)} → net profit ${money(profit)}, ROI ${(roi * 100).toFixed(0)}%  ⇒  ${verdict}`);
    if (deadValue / mv > 0.3) console.log('    ⚠ >30% of measured value is DEAD stock — discount the estimate.');
    if (coverageLots < 0.6) console.log('    ⚠ <60% of lots measurable from cache — consider an opt-in BL enrichment before trusting this.');
  } else {
    console.log('    (pass --asking=<gbp> for a BUY/PASS verdict.)');
  }
  console.log('');

  // worst-offenders + best table
  const top = [...measured].sort((a, b) => (b.lineList ?? 0) - (a.lineList ?? 0)).slice(0, TOP);
  console.log(`  TOP ${Math.min(TOP, top.length)} LOTS BY VALUE`);
  console.log(`    ${pad('Item', 26)} ${pad('Cond', 4)} ${padL('Qty', 4)} ${padL('UnitList', 9)} ${padL('Line', 9)}  Liq`);
  for (const r of top) {
    console.log(
      `    ${pad(r.itemNumber + (r.colourResolved ? ' ' + r.colourResolved : ''), 26)} ${pad(r.condition, 4)} ${padL(r.qty, 4)} ${padL(money(r.unitList), 9)} ${padL(money(r.lineList), 9)}  ${r.liquidity}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
