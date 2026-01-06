import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
  // Get total count
  const { count } = await supabase
    .from('inventory_items')
    .select('*', { count: 'exact', head: true });
  console.log('Total inventory items:', count);

  // Fetch all SKUs (paginated)
  let allSkus: string[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('sku')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error:', error);
      return;
    }
    if (!data || data.length === 0) break;
    allSkus = allSkus.concat(data.map(d => d.sku));
    page++;
    if (data.length < pageSize) break;
  }

  console.log('Total SKUs fetched:', allSkus.length);

  // Count duplicates
  const skuCounts: Record<string, number> = {};
  for (const sku of allSkus) {
    skuCounts[sku] = (skuCounts[sku] || 0) + 1;
  }

  const uniqueSkus = Object.keys(skuCounts).length;
  const duplicates = Object.entries(skuCounts).filter(([, c]) => c > 1);

  console.log('Unique SKUs:', uniqueSkus);
  console.log('SKUs with duplicates:', duplicates.length);

  if (duplicates.length > 0) {
    console.log('\nRemaining duplicates:');
    duplicates.slice(0, 20).forEach(([sku, count]) => {
      console.log(`  ${sku}: ${count} copies`);
    });
  } else {
    console.log('\n✓ No duplicates found - cleanup successful!');
  }
}

verify();
