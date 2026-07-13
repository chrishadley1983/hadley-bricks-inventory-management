/**
 * Smoke test for the wanted-list dedupe in bl-basket.ts.
 * Reproduces the zackharvey22 case: two scraped lots with the same
 * (itemType, itemNo, colourId, condition) — the second of which BL was
 * rejecting before the fix.
 */
import { dedupeWantedEntries } from './bl-basket';

type EnrichedItem = Parameters<typeof dedupeWantedEntries>[0][number];

function lot(over: Partial<EnrichedItem>): EnrichedItem {
  return {
    invID: 0,
    itemType: 'P',
    itemNo: '2412b',
    colourId: 5,
    colourName: 'Red',
    itemName: 'Tile, Modified 1 x 2 Grille',
    invNew: 'U',
    invComplete: null,
    invQty: 1,
    unitPriceGBP: 0.01,
    description: null,
    condition: 'U',
    ukSoldAvg: 0.02,
    ukSoldQty: 100,
    ukStockQty: 200,
    sellThru: 0.5,
    bricqerMultiplier: 1.10,
    listPrice: 0.022,
    inboundPerUnit: 0,
    netPerUnit: 0.01,
    lotProfit: 0.24,
    ...over,
  } as EnrichedItem;
}

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
}

// Case 1: zackharvey22 reproducer — two 2412b Red Used lots, different asks
{
  console.log('\n[case 1] two lots same (P, 2412b, 5, U) at different asks');
  const passed: EnrichedItem[] = [
    lot({ invID: 1, invQty: 22, unitPriceGBP: 0.01, lotProfit: 0.24 }),
    lot({ invID: 2, invQty: 4, unitPriceGBP: 0.02, lotProfit: 0.03 }),
  ];
  const out = dedupeWantedEntries(passed);
  check('1 entry emitted (2 collapsed)', out.length === 1, `got ${out.length}`);
  check('totalQty = 26 (22+4)', out[0].totalQty === 26, `got ${out[0].totalQty}`);
  check('mergedFrom = 2', out[0].mergedFrom === 2);
  check('highestAsk = 0.02', Math.abs(out[0].highestAsk - 0.02) < 1e-9);
  check('totalLotProfit = 0.27', Math.abs(out[0].totalLotProfit - 0.27) < 1e-9);
  // maxPrice: per-lot cap is min(ceil(ask*1.05), breakEven) but never below ceil(ask).
  // listPrice 0.022 → breakEven = floor(0.022 * 0.906) = 0.01.
  // lot1: max(min(0.02,0.01), 0.01) = 0.01.   lot2: max(min(0.03,0.01), 0.02) = 0.02.
  // merged max = 0.02 (the higher of the two per-lot caps).
  check('maxPrice = max of per-lot caps (0.02)', Math.abs(out[0].maxPrice - 0.02) < 1e-9, `got ${out[0].maxPrice}`);
}

// Case 2: same item, different colour — must NOT merge
{
  console.log('\n[case 2] same (P, 2412b) but different colours');
  const passed: EnrichedItem[] = [
    lot({ colourId: 5, colourName: 'Red', invQty: 22 }),
    lot({ colourId: 18, colourName: 'Trans-Neon Orange', invQty: 1 }),
  ];
  const out = dedupeWantedEntries(passed);
  check('2 entries emitted (no merge)', out.length === 2, `got ${out.length}`);
  check('both have mergedFrom=1', out.every((e) => e.mergedFrom === 1));
}

// Case 3: same item+colour, different condition — one entry, higher-profit side wins
{
  console.log('\n[case 3] same (P, X, 5) but different condition (N vs U)');
  // BL allows one entry per item/colour (dupe rejection, live-proven P 12885 c86) AND
  // its uploader requires a concrete CONDITION (omitting it draws a "null" error,
  // both live-proven 2026-07-13). Keep the higher-profit condition; surface the
  // dropped side via droppedOtherCondLots for the remarks.
  const passed: EnrichedItem[] = [
    lot({ condition: 'N', invNew: 'N', invQty: 5, lotProfit: 1.00 }),
    lot({ condition: 'U', invNew: 'U', invQty: 3, lotProfit: 0.40 }),
  ];
  const out = dedupeWantedEntries(passed);
  check('1 entry emitted', out.length === 1, `got ${out.length}`);
  check('higher-profit condition kept (N)', out[0].condition === 'N', `got ${out[0].condition}`);
  check('qty from kept side only', out[0].totalQty === 5, `got ${out[0].totalQty}`);
  check('dropped side surfaced', out[0].droppedOtherCondLots === 1, `got ${out[0].droppedOtherCondLots}`);
}

// Case 4: 3+ way merge
{
  console.log('\n[case 4] three lots same (P, 3020, 11, U)');
  const passed: EnrichedItem[] = [
    lot({ itemNo: '3020', colourId: 11, invQty: 5, unitPriceGBP: 0.02, lotProfit: 0.05 }),
    lot({ itemNo: '3020', colourId: 11, invQty: 3, unitPriceGBP: 0.03, lotProfit: 0.06 }),
    lot({ itemNo: '3020', colourId: 11, invQty: 2, unitPriceGBP: 0.04, lotProfit: 0.07 }),
  ];
  const out = dedupeWantedEntries(passed);
  check('1 entry emitted (3 collapsed)', out.length === 1);
  check('totalQty = 10', out[0].totalQty === 10);
  check('mergedFrom = 3', out[0].mergedFrom === 3);
  check('totalLotProfit = 0.18', Math.abs(out[0].totalLotProfit - 0.18) < 1e-9);
}

// Case 5: minifig (no colour) — colour id is set to 0 by scraper but the dedupe
// key still treats it consistently so identical (M, X, 0, U) merges
{
  console.log('\n[case 5] minifig dupes (colourId=0)');
  const passed: EnrichedItem[] = [
    lot({ itemType: 'M', itemNo: 'sw0810', colourId: 0, invQty: 1, unitPriceGBP: 3.00 }),
    lot({ itemType: 'M', itemNo: 'sw0810', colourId: 0, invQty: 1, unitPriceGBP: 3.50 }),
  ];
  const out = dedupeWantedEntries(passed);
  check('1 entry emitted', out.length === 1);
  check('totalQty = 2', out[0].totalQty === 2);
  check('highestAsk = 3.50', Math.abs(out[0].highestAsk - 3.50) < 1e-9);
}

// Case 6: empty input
{
  console.log('\n[case 6] empty input');
  const out = dedupeWantedEntries([]);
  check('empty array', out.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
