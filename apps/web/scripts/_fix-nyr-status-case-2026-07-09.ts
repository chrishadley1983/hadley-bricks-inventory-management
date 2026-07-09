/**
 * _fix-nyr-status-case-2026-07-09.ts
 *
 * Normalize the 43 inventory rows whose status is the mixed-case
 * 'Not Yet Received' (written by the review-queue approve / batch-import
 * routes) to the canonical 'NOT YET RECEIVED'. The mixed-case rows are
 * invisible to every status-filtered view — dashboard Inventory Value rows,
 * Inventory by Status, the Alerts card and the /inventory status filter —
 * while still being counted in totals (the £486.65 / £1,115.68 dashboard
 * total-row discrepancy).
 *
 * Updates go through InventoryService.update so the Google Sheet mirror runs
 * (dual-write). Re-run safe: selects by current status, so a second run finds
 * nothing to do.
 *
 *   npx tsx scripts/_fix-nyr-status-case-2026-07-09.ts --dry-run
 *   npx tsx scripts/_fix-nyr-status-case-2026-07-09.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { InventoryService } from '@/lib/services';

const DRY_RUN = process.argv.includes('--dry-run');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = process.env.SERVICE_USER_ID!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!URL || !KEY || !USER_ID) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SERVICE_USER_ID');
    process.exit(1);
  }

  const supabase = createClient(URL, KEY);
  const service = new InventoryService(supabase, USER_ID);

  const { data: rows, error } = await supabase
    .from('inventory_items')
    .select('id, set_number, item_name, sku, status')
    .eq('status', 'Not Yet Received')
    .order('created_at', { ascending: true });

  if (error) throw error;
  console.log(`Found ${rows?.length ?? 0} rows with mixed-case 'Not Yet Received'`);
  if (!rows?.length) return;

  let done = 0;
  for (const row of rows) {
    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}${row.set_number} · ${row.sku ?? 'no-sku'} · ${(row.item_name ?? '').slice(0, 50)}`
    );
    if (!DRY_RUN) {
      await service.update(row.id, { status: 'NOT YET RECEIVED' });
      done++;
      await sleep(1100); // Google Sheet mirror throttle
    }
  }

  console.log(DRY_RUN ? 'Dry run complete.' : `Updated ${done}/${rows.length} rows.`);

  if (!DRY_RUN) {
    const { count } = await supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Not Yet Received');
    console.log(`Remaining mixed-case rows: ${count}`);
  }
})();
