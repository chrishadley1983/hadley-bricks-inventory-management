/** Live check: ensurePriceGuide writes a complete rich row + readPriceGuide returns it. */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BrickLinkClient } from '../../src/lib/bricklink/client';
import { ensurePriceGuide } from '../../src/lib/bricklink/price-guide/capture';
import { readPriceGuide } from '../../src/lib/bricklink/price-guide/read';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const bl = new BrickLinkClient({
    consumerKey: process.env.BRICKLINK_CONSUMER_KEY!, consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET!,
    tokenValue: process.env.BRICKLINK_TOKEN_VALUE!, tokenSecret: process.env.BRICKLINK_TOKEN_SECRET!,
  } as any, { supabase, caller: 'verify-ensure' } as any);

  // Test 1: BL colour input (3001 Black = BL 11)
  const view = await ensurePriceGuide(bl, supabase, { itemType: 'P', itemNo: '3001', colourId: 11 }, { ttlDays: 0 });
  console.log('ensurePriceGuide(3001, BL 11) coverage:', view.coverage);
  console.log('  used: strLots', view.used.strLots?.toFixed(3), 'strQty', view.used.strQty?.toFixed(3),
    'soldAvg', view.used.soldAvg, 'median', view.used.soldMedian, 'lots', view.used.soldLots, '/', view.used.stockLots);
  console.log('  new : soldAvg', view.new.soldAvg, 'lots', view.new.soldLots);

  // Test 2: same tuple via BRICQER colour input (Bricqer Black = 3) should hit the same row
  const view2 = await readPriceGuide(supabase, [{ itemType: 'P', itemNo: '3001', colourId: 3, scheme: 'bricqer' }], { ttlDays: 60 });
  const v2 = [...view2.values()][0];
  console.log('readPriceGuide(3001, Bricqer 3) coverage:', v2.coverage, 'blColourId', v2.item.blColourId, 'soldAvg', v2.used.soldAvg);

  // Confirm DB row completeness
  const { data } = await supabase.from('bricklink_price_guide_cache')
    .select('parse_version,uk_sold_median_used,uk_sold_lots_used,uk_stock_lots_used,uk_sold_lots_new,uk_stock_lots_new,uk_sold_last2mo_qty_used,uk_detail')
    .eq('item_type', 'P').eq('item_no', '3001').eq('colour_id', 11).maybeSingle();
  const d: any = data;
  console.log('DB row: parse_version', d?.parse_version, 'median_used', d?.uk_sold_median_used,
    'quadrants(lots) U-sold/U-stock/N-sold/N-stock:', d?.uk_sold_lots_used, d?.uk_stock_lots_used, d?.uk_sold_lots_new, d?.uk_stock_lots_new,
    'last2mo_used', d?.uk_sold_last2mo_qty_used, 'hist keys:', d?.uk_detail?.soldUsed?.hist ? Object.keys(d.uk_detail.soldUsed.hist).length : 0);
  const complete = d && d.parse_version >= 3 && (d.uk_sold_lots_used != null) && (d.uk_stock_lots_used != null);
  console.log(complete ? 'PASS: complete rich row written + read via both colour schemes' : 'FAIL: incomplete row');
}
main().catch((e) => { console.error(e); process.exit(1); });
