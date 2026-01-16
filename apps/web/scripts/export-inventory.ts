import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function exportInventory() {
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: any[] = [];

  console.log('Fetching inventory items (status != Sold)...');

  while (hasMore) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('storage_location, set_number, item_name, id, listing_platform, status')
      .neq('status', 'SOLD')
      .eq('condition', 'New')
      .order('storage_location', { ascending: true, nullsFirst: false })
      .order('set_number', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error fetching data:', error);
      process.exit(1);
    }

    allData.push(...(data ?? []));
    console.log(`Fetched ${allData.length} items...`);
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  // Write to CSV
  const escapeCsv = (val: string | null) => {
    if (val === null || val === undefined) return '';
    // Strip carriage returns, newlines, and other control characters
    const str = String(val).replace(/[\r\n\t]/g, ' ').trim();
    if (str.includes(',') || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  let csv = 'storage_location,set_number,item_name,inventory_id,listing_platform,status\n';
  for (const row of allData) {
    csv += [
      escapeCsv(row.storage_location),
      escapeCsv(row.set_number),
      escapeCsv(row.item_name),
      escapeCsv(row.id),
      escapeCsv(row.listing_platform),
      escapeCsv(row.status),
    ].join(',') + '\n';
  }

  const outputPath = 'inventory-export.csv';
  fs.writeFileSync(outputPath, csv);
  console.log(`\nExported ${allData.length} items to ${outputPath}`);
}

exportInventory().catch(console.error);
