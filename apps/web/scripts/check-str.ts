import * as dotenv from 'dotenv';
import * as path from 'path';
import { createScriptBlContext } from './_bl-client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import type { SideView } from '../src/lib/bricklink/price-guide/read';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { bl, supabase } = createScriptBlContext('check-str-script');

const TTL_DAYS = 90;

interface Q { type: 'P' | 'M'; no: string; color: number; cond: 'N' | 'U'; label: string }

// Colour ids here are BL-scheme (they were fed straight to the BL API before the
// unified-price-cache migration), so ensurePriceGuide's default scheme:'bl' applies.
const items: Q[] = [
  { type: 'P', no: '41535', color: 80, cond: 'U', label: 'Dragon Baby HP Norbert (Dark Green / colour 80) USED' },
  { type: 'P', no: '75094stk01a', color: 0, cond: 'N', label: 'Sticker Sheet 75094 (no colour) NEW' },
];

/** Sold min/max derived from the sold-side qty histogram (price(4dp) -> qty; 'other' bucket ignored). */
const histBounds = (side: SideView): { min: number | null; max: number | null } => {
  const prices = Object.keys(side.hist ?? {}).map(Number).filter((p) => Number.isFinite(p));
  if (prices.length === 0) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
};
const gbp = (n: number | null, dp = 4) => (n == null ? 'n/a' : n.toFixed(dp));

(async () => {
  for (const it of items) {
    try {
      // One ensurePriceGuide replaces the old sold+stock API pair: cache-first against the
      // unified price cache; on miss/stale it fetches all FOUR UK quadrants (both conditions,
      // 4 calls) and captures a complete row automatically — no manual upsert-back.
      const view = await ensurePriceGuide(
        bl, supabase,
        { itemType: it.type, itemNo: it.no, colourId: it.color },
        { ttlDays: TTL_DAYS }
      );
      const side = it.cond === 'U' ? view.used : view.new;
      const { min: soldMin, max: soldMax } = histBounds(side);
      // Qty-based STR — same maths as the legacy total_quantity ratio (== side.strQty).
      const str = side.stockQty > 0 ? side.soldQty / side.stockQty : 0;
      console.log(`${it.label}`);
      console.log(`  sold(6mo): qty=${side.soldQty}  lots=${side.soldLots}  avg=£${(side.soldAvg ?? 0).toFixed(2)}  min=£${gbp(soldMin)}  max=£${gbp(soldMax)}`);
      console.log(`  stock NOW: qty=${side.stockQty}  lots=${side.stockLots}  avg=£${gbp(side.stockAvg)}  min=£${gbp(side.stockMin)}`);
      console.log(`  STR = ${side.soldQty}/${side.stockQty} = ${str.toFixed(3)}`);
      console.log('');
    } catch (e) {
      console.error('Error for', it.label, ':', (e as Error).message);
    }
  }
})();
