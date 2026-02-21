/**
 * Export all minifig_sync_items to CSV.
 *
 * Usage:
 *   cd apps/web
 *   npx tsx scripts/export-minifig-items.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const COLUMNS = [
  'bricqer_item_id',
  'bricklink_id',
  'name',
  'condition_notes',
  'bricqer_price',
  'ebay_avg_sold_price',
  'ebay_min_sold_price',
  'ebay_max_sold_price',
  'ebay_sold_count',
  'ebay_active_count',
  'ebay_sell_through_rate',
  'ebay_avg_shipping',
  'ebay_research_date',
  'meets_threshold',
  'recommended_price',
  'best_offer_auto_accept',
  'best_offer_auto_decline',
  'ebay_sku',
  'ebay_listing_id',
  'ebay_listing_url',
  'listing_status',
  'ebay_title',
  'created_at',
  'updated_at',
] as const;

function escapeCsv(val: unknown): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const allRows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('minifig_sync_items')
      .select(COLUMNS.join(','))
      .order('name')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw new Error(error.message);
    allRows.push(...(data ?? []));
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  const header = COLUMNS.join(',');
  const rows = allRows.map((row) =>
    COLUMNS.map((col) => escapeCsv(row[col])).join(','),
  );

  const csv = [header, ...rows].join('\n');
  const outPath = resolve(__dirname, '../minifig-items-export.csv');
  writeFileSync(outPath, csv, 'utf-8');

  console.log(`Exported ${allRows.length} items to ${outPath}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
