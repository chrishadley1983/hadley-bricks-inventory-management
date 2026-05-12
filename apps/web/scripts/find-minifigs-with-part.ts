/**
 * Find minifigs in our inventory that contain a given part+colour.
 *
 * Strategy: hit BL API /items/PART/<no>/supersets?color_id=N to get the list of
 * minifigs/sets that contain this part. Intersect with our owned minifig
 * inventory. Avoids per-minifig API calls (1 call regardless of N minifigs we own).
 *
 * Usage:
 *   npx tsx scripts/find-minifigs-with-part.ts --part=3624 --color=7
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createScriptBlContext } from './_bl-client';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const PART = argv['part'];
const COLOR = parseInt(argv['color'] ?? '0', 10);
if (!PART || !COLOR) { console.error('Usage: --part=3624 --color=7'); process.exit(1); }

const { bl, supabase } = createScriptBlContext('find-minifigs-with-part-script');

async function main() {
  // 1. /items/PART/<no>/supersets?color_id=N → returns list of items that contain this part.
  //    Calls go through the daily counter via createScriptBlContext.
  console.log(`[BL] supersets PART/${PART} color_id=${COLOR}`);
  const blocks = await bl.getSupersets('PART', PART, { colorId: COLOR });

  const minifigSupersets: Array<{ no: string; name: string; quantity: number; appearAs: string }> = [];
  for (const block of blocks) {
    if (block.color_id !== COLOR) continue;
    for (const e of block.entries ?? []) {
      if (e.item?.type === 'MINIFIG') {
        minifigSupersets.push({ no: e.item.no, name: e.item.name, quantity: e.quantity, appearAs: e.appear_as });
      }
    }
  }
  console.log(`[BL] ${minifigSupersets.length} minifigs known to use Part ${PART} colour ${COLOR}`);
  if (minifigSupersets.length === 0) {
    console.log('No minifigs use this part+colour, or BL has no superset data.');
    return;
  }

  // 2. Pull ALL Bricqer minifig inventory (paginated past Supabase 1k cap).
  //    NB: item_type stored as 'Minifig' (full word), not 'M'.
  const allBricqer: Array<{ bricqer_item_id: number | null; item_number: string; item_name: string | null; color_id: number | null; condition: string | null; quantity: number | null; storage_location: string | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('bricqer_inventory_snapshot')
      .select('bricqer_item_id, item_number, item_name, color_id, condition, quantity, storage_location')
      .eq('item_type', 'Minifig')
      .range(offset, offset + 999);
    if (error) { console.error(error); break; }
    allBricqer.push(...(data as typeof allBricqer));
    if (!data || data.length < 1000) break;
  }
  console.log(`[ours] Bricqer minifig inventory: ${allBricqer.length} rows`);

  const blIdSetLower = new Set(minifigSupersets.map((m) => m.no.toLowerCase()));
  const bricqerHits = allBricqer.filter((r) => r.item_number && blIdSetLower.has(r.item_number.toLowerCase()));
  console.log(`[ours] Bricqer hits on supersets: ${bricqerHits.length}`);

  // Also check minifig_sync_items for status context (listed vs not).
  const blIds = minifigSupersets.map((m) => m.no);
  const { data: syncRows } = await supabase
    .from('minifig_sync_items')
    .select('bricklink_id, name, listing_status, meets_threshold')
    .in('bricklink_id', blIds);
  console.log(`[ours] minifig_sync_items hits: ${syncRows?.length ?? 0}`);

  // Build per-bricklink-id summary (keyed lowercase to defeat case mismatch)
  type Row = { name: string; bricqerQty: number; storage: string; condition: string; listingStatus?: string; meetsThreshold?: boolean };
  const owned = new Map<string, Row>();
  for (const b of bricqerHits) {
    const k = (b.item_number ?? '').toLowerCase();
    if (!owned.has(k)) owned.set(k, { name: b.item_name ?? '', bricqerQty: 0, storage: '', condition: b.condition ?? '?' });
    const e = owned.get(k)!;
    e.bricqerQty += b.quantity ?? 0;
    if (!e.storage && b.storage_location) e.storage = b.storage_location;
  }
  for (const sr of (syncRows ?? []) as Array<{ bricklink_id: string | null; name: string | null; listing_status: string | null; meets_threshold: boolean | null }>) {
    const k = (sr.bricklink_id ?? '').toLowerCase();
    if (!owned.has(k)) owned.set(k, { name: sr.name ?? '', bricqerQty: 0, storage: '', condition: '?' });
    const e = owned.get(k)!;
    if (!e.name) e.name = sr.name ?? '';
    e.listingStatus = sr.listing_status ?? undefined;
    e.meetsThreshold = sr.meets_threshold ?? undefined;
  }
  // Cross-ref name from BL data if missing (keys are already lowercase)
  for (const m of minifigSupersets) {
    const k = m.no.toLowerCase();
    if (owned.has(k) && !owned.get(k)!.name) owned.get(k)!.name = m.name;
  }

  console.log(`\n=== Owned minifigs that contain Part ${PART} colour ${COLOR} ===`);
  if (owned.size === 0) {
    console.log('None of the supersets are in our inventory.');
    console.log(`\nFor reference, the ${minifigSupersets.length} BL supersets (sample):`);
    for (const m of minifigSupersets.slice(0, 25)) console.log(`  ${m.no.padEnd(12)}  ${m.name}`);
    if (minifigSupersets.length > 25) console.log(`  ...${minifigSupersets.length - 25} more`);
    return;
  }
  // Sort by qty desc, then name
  const sorted = [...owned.entries()].sort((a, b) => b[1].bricqerQty - a[1].bricqerQty);
  for (const [noLower, e] of sorted) {
    const meta = minifigSupersets.find((m) => m.no.toLowerCase() === noLower);
    const displayNo = meta?.no ?? noLower;
    const partQty = meta?.quantity ?? 1;
    const appearAs = meta?.appearAs ?? '';
    console.log(`  ${displayNo.padEnd(12)}  qty ${String(e.bricqerQty).padStart(2)}  ${e.condition.padEnd(5)}  storage=${(e.storage || '-').padEnd(10)}  ${e.listingStatus ? `[${e.listingStatus}]` : ''}  parts=${partQty}${appearAs ? ` (${appearAs})` : ''}  ${e.name}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
