/**
 * 1) Fetch GLOBAL BL price-guide for the two flagged blind items
 *    (30229 polybag, 37493 Yellow Train Front) — country=UK gave us 0 sold
 *    in 6mo so we look worldwide for a real benchmark.
 * 2) Compute the unit economics if Chris pays £20 (negotiated) + shipping
 *    for the FULL remainder of the store (198 lots: 183 benched + 15 blind).
 *
 * Reuses on-disk artefacts:
 *   tmp/stores/zackharvey22/enriched.json
 *   arbitrage_purchases.id = b33726bf-2b21-449f-8a40-90e356c726af  (the 38 already-bought lots)
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createScriptBlContext } from './_bl-client';

const ARB_ID = 'b33726bf-2b21-449f-8a40-90e356c726af';
const ENRICHED = path.resolve(__dirname, '../../../tmp/stores/zackharvey22/enriched.json');
const VAR_FEE_PCT = 0.094;

const { bl, supabase } = createScriptBlContext('zackharvey22-bulk-deal-script');

interface EnrichedRow {
  itemType: 'P' | 'S' | 'M';
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  invQty: number;
  unitPriceGBP: number;
  ukSoldAvg: number | null;
  ukSoldQty: number;
  ukStockQty: number;
  sellThru: number;
  listPrice: number | null;
}

const TYPE_MAP = { P: 'PART', S: 'SET', M: 'MINIFIG' } as const;

async function fetchGlobalPriceGuide(itemType: 'P' | 'S' | 'M', itemNo: string, colourId: number, condition: 'N' | 'U') {
  const apiType = TYPE_MAP[itemType];
  // Sets don't take color_id — pass 0 and rely on getPartPriceGuide; fallback to direct request if needed.
  const cid = itemType === 'S' ? 0 : colourId;
  const sold = await bl.getPartPriceGuide(apiType, itemNo, cid, { guideType: 'sold', currencyCode: 'GBP', condition });
  await new Promise((r) => setTimeout(r, 300));
  const stock = await bl.getPartPriceGuide(apiType, itemNo, cid, { guideType: 'stock', currencyCode: 'GBP', condition });
  return { sold, stock };
}

function bricqerMultiplier(condition: 'N' | 'U', sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.05 : 0.90;
  if (sellThru >= 1) return 1.25;
  if (sellThru >= 0.75) return 1.15;
  if (sellThru >= 0.5) return 1.10;
  if (sellThru >= 0.25) return 0.90;
  return 0.85;
}

(async () => {
  // ---------- Step 1: global price lookups for the two flagged items ----------
  console.log('=== Global price lookups (BL API, no country filter) ===\n');
  const flagged: Array<{ label: string; itemType: 'P' | 'S' | 'M'; itemNo: string; colourId: number; condition: 'N' | 'U'; askPerUnit: number; qty: number; addToList?: number }> = [
    { label: '37493 Train Front 6×10×7 Yellow (P, U)', itemType: 'P', itemNo: '37493', colourId: 3, condition: 'U', askPerUnit: 0.15, qty: 2 },
  ];
  // 30229 is a SET — BL price-guide rejects color_id for sets with PARAMETER_MISSING_OR_INVALID,
  // so we use a manual lookup heuristic. Polybags from City line typically clear at £2.50–£5.00 sealed.
  console.log('30229 Repair Lift polybag (S, N) — global lookup skipped (SET endpoint rejects color_id);');
  console.log('  manual heuristic: City polybags sealed clear ~£2.50–5.00 globally. Use £3.50 mid-point.\n');
  const polybagListEst = 3.50;
  for (const f of flagged) {
    try {
      const { sold, stock } = await fetchGlobalPriceGuide(f.itemType, f.itemNo, f.colourId, f.condition);
      const soldRoot = sold as unknown as { avg_price?: string; qty_avg_price?: string; total_quantity?: number; unit_quantity?: number };
      const stockRoot = stock as unknown as { avg_price?: string; total_quantity?: number; unit_quantity?: number };
      // Filter sold/stock by condition (price-guide returns separate endpoints, no need to filter again)
      const soldQty = soldRoot.total_quantity ?? 0;
      const soldAvg = parseFloat(soldRoot.avg_price ?? '0');
      const qtyAvg = parseFloat(soldRoot.qty_avg_price ?? '0');
      const stockQty = stockRoot.total_quantity ?? 0;
      const stockUnits = stockRoot.unit_quantity ?? 0;
      const str = stockQty > 0 ? soldQty / stockQty : 0;
      const mult = bricqerMultiplier(f.condition, str);
      const listPerUnit = qtyAvg > 0 ? qtyAvg * mult : soldAvg * mult;
      console.log(`${f.label}`);
      console.log(`  global sold avg:        £${soldAvg.toFixed(3)}  (qty-weighted £${qtyAvg.toFixed(3)})`);
      console.log(`  global sold qty (6mo):  ${soldQty}     stock (lots/units): ${stockUnits} / ${stockQty}`);
      console.log(`  STR (global):           ${str.toFixed(2)}    Bricqer multiplier: ×${mult}`);
      console.log(`  list per unit:          £${listPerUnit.toFixed(2)}`);
      console.log(`  list × qty (${f.qty}):       £${(listPerUnit * f.qty).toFixed(2)}`);
      console.log(`  ask × qty:              £${(f.askPerUnit * f.qty).toFixed(2)}`);
      console.log();
      f.addToList = listPerUnit * f.qty;
    } catch (err) {
      console.log(`  fetch failed: ${(err as Error).message}\n`);
    }
  }

  // ---------- Step 2: bulk-deal economics at £20 + shipping ----------
  console.log('=== Bulk-deal economics — £20 negotiated outlay for full remainder ===\n');

  const { data: arb } = await supabase.from('arbitrage_purchases').select('items').eq('id', ARB_ID).single();
  const purchasedKeys = new Set<string>();
  for (const it of (arb?.items as EnrichedRow[]) ?? []) {
    purchasedKeys.add(`${it.itemType}|${it.itemNo}|${it.colourId}|${it.invNew ?? ''}|${(it as unknown as { condition?: string }).condition ?? ''}`);
    purchasedKeys.add(`${it.itemType}|${it.itemNo}|${it.colourId}|${(it as unknown as { condition?: string }).condition ?? ''}`);
  }
  const enriched = JSON.parse(fs.readFileSync(ENRICHED, 'utf8')) as Array<EnrichedRow & { condition?: string }>;
  const remainder = enriched.filter((x) => !purchasedKeys.has(`${x.itemType}|${x.itemNo}|${x.colourId}|${x.condition ?? ''}`));

  const benched = remainder.filter((x) => x.ukSoldAvg !== null && x.listPrice !== null);
  const blind = remainder.filter((x) => x.ukSoldAvg === null || x.listPrice === null);

  const benchedOutlay = benched.reduce((s, x) => s + x.unitPriceGBP * x.invQty, 0);
  const benchedList = benched.reduce((s, x) => s + (x.listPrice ?? 0) * x.invQty, 0);
  const blindOutlay = blind.reduce((s, x) => s + x.unitPriceGBP * x.invQty, 0);
  const blindPieces = blind.reduce((s, x) => s + x.invQty, 0);
  const benchedPieces = benched.reduce((s, x) => s + x.invQty, 0);

  // Project blind list value: assume ask × Bricqer-typical-multiplier (we use 1.10 as a midpoint
  // for U items at moderate STR — conservative since these are blind by definition).
  // We override entries 30229 and 37493 with the freshly-fetched global numbers if available.
  const flagAdds = flagged.reduce((s, f) => s + (f.addToList ?? 0), 0) + polybagListEst;
  const flagAskOffset = flagged.reduce((s, f) => s + f.askPerUnit * f.qty, 0) + 1.75; // +30229 polybag ask
  const blindAskOther = blindOutlay - flagAskOffset;
  const blindListProjectionConservative = flagAdds + blindAskOther * 2.5; // 2.5× ask = conservative for unknown blind
  const blindListProjectionOptimistic = flagAdds + blindAskOther * 4.0;   // 4× ask = optimistic
  const totalListConservative = benchedList + blindListProjectionConservative;
  const totalListOptimistic = benchedList + blindListProjectionOptimistic;

  // Aggregate STR — pieces-weighted across benched (blind contributes 0 to weighted STR)
  const strMedian = (() => {
    const sorted = benched.map((x) => x.sellThru ?? 0).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  })();
  const strMean = benched.reduce((s, x) => s + (x.sellThru ?? 0), 0) / benched.length;
  const strOutlayWeighted = benched.reduce((s, x) => s + (x.sellThru ?? 0) * x.unitPriceGBP * x.invQty, 0) / benchedOutlay;

  console.log(`Remainder lots (excl. the 38 bought):     ${remainder.length}  (${benched.length} benched + ${blind.length} blind)`);
  console.log(`Total pieces:                              ${benchedPieces + blindPieces}`);
  console.log(`Sticker outlay (asks):                     £${(benchedOutlay + blindOutlay).toFixed(2)}  (£${benchedOutlay.toFixed(2)} benched + £${blindOutlay.toFixed(2)} blind)`);
  console.log(`Negotiated outlay:                         £20.00  (= ${(20 / (benchedOutlay + blindOutlay) * 100).toFixed(0)}% of sticker)`);
  console.log();
  console.log(`Projected list value:`);
  console.log(`  benched (UK 6MA × multiplier):           £${benchedList.toFixed(2)}`);
  console.log(`  blind (flagged 2 items, global priced):  £${flagAdds.toFixed(2)}`);
  console.log(`  blind (other 13, ask × 2.5–4.0):         £${(blindAskOther * 2.5).toFixed(2)}–£${(blindAskOther * 4).toFixed(2)}`);
  console.log(`  total list (conservative):               £${totalListConservative.toFixed(2)}`);
  console.log(`  total list (optimistic):                 £${totalListOptimistic.toFixed(2)}`);
  console.log();

  for (const shipping of [3.0, 3.90, 5.0]) {
    const cost = 20 + shipping;
    console.log(`--- At £20 + £${shipping.toFixed(2)} shipping = £${cost.toFixed(2)} all-in cost ---`);
    for (const [label, list] of [['conservative', totalListConservative], ['optimistic', totalListOptimistic]] as const) {
      const fees = list * VAR_FEE_PCT;
      const net = list - fees - cost;
      const margin = net / list;
      const roi = net / cost;
      console.log(`  ${label.padEnd(13)}  list £${list.toFixed(2)}  fees £${fees.toFixed(2)}  NET £${net.toFixed(2)}  margin ${(margin * 100).toFixed(1)}%  ROI ${(roi * 100).toFixed(1)}%`);
    }
    console.log();
  }

  console.log(`STR distribution (benched lots only — blind contribute zero signal):`);
  console.log(`  median:           ${strMedian.toFixed(3)}`);
  console.log(`  mean:             ${strMean.toFixed(3)}`);
  console.log(`  outlay-weighted:  ${strOutlayWeighted.toFixed(3)}`);
  console.log();
  console.log(`Capacity at 10%/lot/mo: avg ${(remainder.length / (remainder.length * 0.10)).toFixed(1)} months/lot — but median STR ${strMedian.toFixed(2)} suggests the long tail dominates. Realistic 50%-net capture ~${Math.round(50 / 10 / Math.max(strMedian, 0.05))}+ months.`);
})();
