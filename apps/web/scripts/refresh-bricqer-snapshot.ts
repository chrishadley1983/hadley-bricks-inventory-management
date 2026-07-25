/**
 * Bricqer inventory snapshot refresh.
 *
 * Re-syncs bricqer_inventory_snapshot from the Bricqer API so the store-quality
 * scorecard, the demand-gap tool and the Set Lookup part-out OVERLAP panel run on
 * current stock. This is the ONE place that deliberately hits the Bricqer API.
 *
 * Cost: one Bricqer API call per 100 inventory items (see SnapshotSyncService —
 * `/inventory/item/?limit=100`). At ~31k items that is ~312 calls per full refresh.
 * No BrickLink calls are made.
 *
 * Two things this wraps around SnapshotSyncService.sync(), both of which matter for
 * an unattended run:
 *
 *  1. **The 300-page cap.** `MAX_PAGES_PER_INVOCATION` exists so the Vercel route
 *     can't time out, which means a single default sync() call cannot finish an
 *     inventory larger than 30,000 items. That is not merely slow — stale-item
 *     removal only runs on an invocation that starts at page 1 AND completes, so a
 *     capped run can never prune. We raise the cap (there is no serverless timeout
 *     here) so one invocation covers everything.
 *  2. **`--full` (the default).** A resumed sync starts at the stored cursor, and
 *     SnapshotSyncService deliberately skips stale-item removal unless it started at
 *     page 1 — yet it still stamps `last_full_sync`. Left alone, a resume would claim
 *     a full sync while most rows were weeks old. `--full` clears the cursor first so
 *     every scheduled run is a true full sweep with stale removal. Pass `--resume` to
 *     continue an interrupted sync instead.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/refresh-bricqer-snapshot.ts
 *   npx tsx scripts/refresh-bricqer-snapshot.ts --resume
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
const USER_ID =
  argv['user-id'] ?? process.env.BRICQER_SNAPSHOT_USER_ID ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
/** Resume an interrupted sync instead of forcing a fresh full sweep. */
const RESUME = argv['resume'] === 'true';
/**
 * Pages per invocation. 100 items/page, so this covers 500k items — far above the ~31k
 * we hold, which is the point: the whole sweep must land in ONE invocation for stale
 * removal to run. Overridable for testing.
 */
const MAX_PAGES = Number(argv['max-pages'] ?? 5000);
/** Safety rail on the resume loop. With MAX_PAGES set this should never exceed 1. */
const MAX_PASSES = 5;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Clear a stored cursor so the next sync starts at page 1.
 *
 * Without this a run that previously hit the page cap (or died) resumes mid-way and
 * never removes stale rows, while still stamping last_full_sync.
 */
async function resetCursor(): Promise<void> {
  const { data: meta } = await supabase
    .from('bricqer_snapshot_meta')
    .select('sync_status,sync_cursor,last_full_sync')
    .eq('user_id', USER_ID)
    .maybeSingle();

  if (meta && (meta.sync_status === 'running' || (meta.sync_cursor ?? 0) > 0)) {
    console.log(
      `  Clearing stored cursor (status=${meta.sync_status}, cursor=${meta.sync_cursor}, ` +
        `last full sync ${meta.last_full_sync ?? 'never'}) — starting a fresh full sweep.`
    );
  }

  await supabase.from('bricqer_snapshot_meta').upsert({
    user_id: USER_ID,
    sync_status: 'idle',
    sync_cursor: 0,
    sync_error: null,
    updated_at: new Date().toISOString(),
  });
}

async function main() {
  console.log(
    `Refreshing Bricqer inventory snapshot (Bricqer API) — ${RESUME ? 'resume' : 'full sweep'}…`
  );
  if (!RESUME) await resetCursor();

  const svc = new SnapshotSyncService(supabase, USER_ID);
  let totalSynced = 0;
  let totalRemoved = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    let lastLine = 0;
    const res = await svc.sync({
      maxPages: MAX_PAGES,
      onProgress: (p) => {
        if (p.page - lastLine >= 10 || p.status !== 'running') {
          lastLine = p.page;
          process.stdout.write(
            `\r  pass ${pass} · page ${p.page}/${p.totalPages || '?'} — ${p.itemsFetched}/${p.totalItems} items   `
          );
        }
      },
    });
    process.stdout.write('\n');

    if (res.error) {
      console.error('  Sync failed:', res.error);
      process.exit(1);
    }

    totalSynced += res.itemsSynced;
    totalRemoved += res.itemsRemoved;

    if (res.complete) {
      console.log(
        `  Done in ${pass} pass(es). ${totalSynced} items synced, ${totalRemoved} stale removed, ` +
          `${res.totalLots} lots total.`
      );
      return;
    }

    // Hit the per-invocation page cap. The cursor is stored, so the next pass picks up
    // where this one stopped.
    console.log(`  Pass ${pass} hit the page cap at ${res.itemsSynced} items — continuing.`);

    if (res.itemsSynced === 0) {
      console.error('  Pass made no progress; aborting rather than looping.');
      process.exit(1);
    }
  }

  console.error(`  Still incomplete after ${MAX_PASSES} passes — aborting. Re-run to continue.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
