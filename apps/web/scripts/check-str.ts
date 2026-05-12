import * as dotenv from 'dotenv';
import * as path from 'path';
import { createScriptBlContext } from './_bl-client';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { bl } = createScriptBlContext('check-str-script');

interface Q { type: 'PART' | 'MINIFIG'; no: string; color: number; cond: 'N' | 'U'; label: string }

const items: Q[] = [
  { type: 'PART', no: '41535', color: 80, cond: 'U', label: 'Dragon Baby HP Norbert (Dark Green / colour 80) USED' },
  { type: 'PART', no: '75094stk01a', color: 0, cond: 'N', label: 'Sticker Sheet 75094 (no colour) NEW' },
];

(async () => {
  for (const it of items) {
    try {
      const sold = await bl.getPartPriceGuide(it.type, it.no, it.color, {
        condition: it.cond, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK',
      });
      const stock = await bl.getPartPriceGuide(it.type, it.no, it.color, {
        condition: it.cond, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK',
      });
      const sAny = sold as unknown as { total_quantity?: number; unit_quantity?: number };
      const stAny = stock as unknown as { total_quantity?: number; unit_quantity?: number };
      const soldQty = sAny.total_quantity ?? sAny.unit_quantity ?? 0;
      const stockQty = stAny.total_quantity ?? stAny.unit_quantity ?? 0;
      const str = stockQty > 0 ? soldQty / stockQty : 0;
      console.log(`${it.label}`);
      console.log(`  sold(6mo): qty=${soldQty}  lots=${sold.unit_quantity}  avg=£${parseFloat(String(sold.avg_price)).toFixed(2)}  min=£${sold.min_price}  max=£${sold.max_price}`);
      console.log(`  stock NOW: qty=${stockQty}  lots=${stock.unit_quantity}  avg=£${stock.avg_price}  min=£${stock.min_price}`);
      console.log(`  STR = ${soldQty}/${stockQty} = ${str.toFixed(3)}`);
      console.log('');
    } catch (e) {
      console.error('Error for', it.label, ':', (e as Error).message);
    }
  }
})();
