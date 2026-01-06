import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDuplicates() {
  console.log('Checking for duplicate inventory items...\n');

  // Get total count
  const { count: totalCount } = await supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true });
  console.log('Total items:', totalCount);

  // Check items created today
  const today = new Date().toISOString().split('T')[0];
  const { data: recentItems, count: todayCount } = await supabase
    .from('inventory_items')
    .select('id, sku, set_number, item_name, purchase_date, created_at', { count: 'exact' })
    .gte('created_at', today)
    .order('created_at', { ascending: false })
    .limit(100);

  console.log('Items created today:', todayCount);

  if (recentItems && recentItems.length > 0) {
    console.log('\nMost recent items:');
    recentItems.slice(0, 10).forEach(item => {
      console.log(`  ${item.sku} | ${item.set_number} | ${item.created_at}`);
    });
  }

  // Find duplicates by set_number + purchase_date + item_name
  console.log('\nSearching for duplicates (same set_number, purchase_date, item_name)...');

  // Get all items and find duplicates in memory
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allItems: any[] = [];

  while (hasMore) {
    const { data } = await supabase
      .from('inventory_items')
      .select('id, sku, set_number, item_name, purchase_date, created_at')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (data) {
      allItems.push(...data);
    }
    hasMore = data?.length === pageSize;
    page++;
  }

  // Group by set_number + purchase_date + item_name
  const groups: Record<string, any[]> = {};
  allItems.forEach(item => {
    const key = `${item.set_number}|${item.purchase_date}|${item.item_name}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  // Find groups with more than 1 item (duplicates)
  const duplicateGroups = Object.entries(groups)
    .filter(([_, items]) => items.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`\nFound ${duplicateGroups.length} groups with duplicates`);

  let totalDuplicates = 0;
  duplicateGroups.forEach(([key, items]) => {
    totalDuplicates += items.length - 1; // Count extras, keep 1
  });
  console.log(`Total duplicate items to remove: ${totalDuplicates}`);

  if (duplicateGroups.length > 0) {
    console.log('\nTop 10 duplicate groups:');
    duplicateGroups.slice(0, 10).forEach(([key, items]) => {
      console.log(`  "${key}" has ${items.length} copies`);
      items.forEach(item => {
        console.log(`    - ${item.sku} created ${item.created_at}`);
      });
    });
  }
}

checkDuplicates().catch(console.error);
