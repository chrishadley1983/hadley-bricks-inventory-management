import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function countDuplicates() {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('sku');

  if (error) { console.error(error); return; }

  const skuCounts: Record<string, number> = {};
  for (const item of data || []) {
    skuCounts[item.sku] = (skuCounts[item.sku] || 0) + 1;
  }

  const duplicates = Object.entries(skuCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => (b[1] as number) - (a[1] as number));

  console.log('Total items:', data?.length);
  console.log('Unique SKUs:', Object.keys(skuCounts).length);
  console.log('SKUs with duplicates:', duplicates.length);
  console.log('Total duplicate records:', duplicates.reduce((sum, [, c]) => sum + (c as number - 1), 0));
  console.log('\nTop 20 duplicated SKUs:');
  duplicates.slice(0, 20).forEach(([sku, count]) => {
    console.log(`  ${sku}: ${count} copies`);
  });
}

countDuplicates();
