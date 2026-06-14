/**
 * One-off Bricqer inventory snapshot refresh.
 *
 * Re-syncs bricqer_inventory_snapshot from the Bricqer API so the store-quality
 * scorecard and demand-gap tool run on current stock. This is the ONE place that
 * deliberately hits the Bricqer API — run it on request, not automatically.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/refresh-bricqer-snapshot.ts
 *   npx tsx scripts/refresh-bricqer-snapshot.ts --user-id=<uuid>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { SnapshotSyncService } from '../src/lib/inventory-explorer/snapshot-sync.service';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Refreshing Bricqer inventory snapshot (Bricqer API)…');
  const svc = new SnapshotSyncService(supabase, USER_ID);
  let lastLine = 0;
  const res = await svc.sync({
    onProgress: (p) => {
      if (p.page - lastLine >= 10 || p.status !== 'running') {
        lastLine = p.page;
        process.stdout.write(
          `\r  page ${p.page}/${p.totalPages || '?'} — ${p.itemsFetched}/${p.totalItems} items   `
        );
      }
    },
  });
  process.stdout.write('\n');
  if (res.error) {
    console.error('  Sync failed:', res.error);
    process.exit(1);
  }
  if (!res.complete) {
    console.warn(
      `  Partial sync (${res.itemsSynced} items) — Bricqer paging not finished; re-run to resume.`
    );
    return;
  }
  console.log(
    `  Done. ${res.itemsSynced} items synced, ${res.itemsRemoved} stale removed, ` +
      `${res.totalLots} lots total.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
