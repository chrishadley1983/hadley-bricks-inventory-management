/**
 * Verify the stale platform='bricqer' rows have BL/BO equivalents and delete.
 *
 * The 'bricqer' aggregation path was deprecated by PRs #376 (BO dual-write)
 * and #378 (orders dashboard reads BL/BO directly). The 212 historical rows
 * with platform='bricqer' are an old snapshot from Jan 2026.
 *
 * For each bricqer row:
 *  - parse raw_data.orderProvider to determine the underlying platform
 *  - BrickLink: look for a platform_orders row with platform='bricklink' and
 *    matching platform_order_id
 *  - BrickOwl: look for a brickowl_transactions row with matching
 *    brickowl_order_id (also covers platform_orders(brickowl) post-#376)
 *
 * Run modes:
 *   npx tsx scripts/delete-stale-bricqer-rows.ts          # DRY RUN — report only
 *   npx tsx scripts/delete-stale-bricqer-rows.ts --delete # Actually delete covered rows
 *
 * Uncovered rows are NEVER deleted; they are reported for manual review.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DELETE_MODE = process.argv.includes('--delete');

interface BricqerRow {
  id: string;
  user_id: string;
  platform_order_id: string;
  total: number | null;
  order_date: string | null;
  raw_data: unknown;
}

function detectProvider(rawData: unknown): 'bricklink' | 'brickowl' | 'ebay' | 'unknown' {
  if (!rawData || typeof rawData !== 'object') return 'unknown';
  const r = rawData as Record<string, unknown>;
  const provider = (r.orderProvider as string | undefined) ?? '';
  const display = (r.displayName as string | undefined) ?? '';
  const haystack = `${provider} ${display}`.toLowerCase();
  if (haystack.includes('bricklink')) return 'bricklink';
  if (haystack.includes('brickowl')) return 'brickowl';
  if (haystack.includes('ebay')) return 'ebay';
  return 'unknown';
}

function extractNativeOrderId(rawData: unknown, fallback: string): string {
  if (!rawData || typeof rawData !== 'object') return fallback;
  const r = rawData as Record<string, unknown>;
  // Bricqer's displayName is "BrickLink #29557934" — strip the prefix
  const display = r.displayName as string | undefined;
  if (display) {
    const m = display.match(/#\s*(\S+)/);
    if (m) return m[1];
  }
  return fallback;
}

async function main() {
  console.log(`Mode: ${DELETE_MODE ? 'DELETE' : 'DRY RUN (use --delete to actually delete)'}\n`);

  // Read all bricqer rows (paginate to avoid 1000 cap)
  const all: BricqerRow[] = [];
  let from = 0;
  const pageSize = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('platform_orders')
      .select('id, user_id, platform_order_id, total, order_date, raw_data')
      .eq('platform', 'bricqer')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as BricqerRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`Found ${all.length} platform='bricqer' rows\n`);
  if (all.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Categorise by provider
  const byProvider: Record<string, BricqerRow[]> = {
    bricklink: [],
    brickowl: [],
    ebay: [],
    unknown: [],
  };
  for (const row of all) {
    const provider = detectProvider(row.raw_data);
    byProvider[provider].push(row);
  }
  console.log('Provider breakdown:');
  for (const [p, rows] of Object.entries(byProvider)) {
    console.log(`  ${p.padEnd(10)}: ${rows.length}`);
  }

  // For each, check coverage
  const covered: BricqerRow[] = [];
  const uncovered: { row: BricqerRow; provider: string; reason: string }[] = [];

  // BrickLink coverage check: platform_orders WHERE platform='bricklink' AND platform_order_id=...
  for (const row of byProvider.bricklink) {
    const nativeId = extractNativeOrderId(row.raw_data, row.platform_order_id);
    const { data, error } = await supabase
      .from('platform_orders')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('platform', 'bricklink')
      .eq('platform_order_id', nativeId)
      .limit(1);
    if (error) {
      uncovered.push({ row, provider: 'bricklink', reason: `lookup error: ${error.message}` });
      continue;
    }
    if (data && data.length > 0) covered.push(row);
    else
      uncovered.push({
        row,
        provider: 'bricklink',
        reason: `no platform_orders(bricklink) row with platform_order_id=${nativeId}`,
      });
  }

  // BrickOwl coverage check: brickowl_transactions WHERE brickowl_order_id=...
  for (const row of byProvider.brickowl) {
    const nativeId = extractNativeOrderId(row.raw_data, row.platform_order_id);
    const { data, error } = await supabase
      .from('brickowl_transactions')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('brickowl_order_id', nativeId)
      .limit(1);
    if (error) {
      uncovered.push({ row, provider: 'brickowl', reason: `lookup error: ${error.message}` });
      continue;
    }
    if (data && data.length > 0) covered.push(row);
    else
      uncovered.push({
        row,
        provider: 'brickowl',
        reason: `no brickowl_transactions row with brickowl_order_id=${nativeId}`,
      });
  }

  // eBay rows: bricqer was filtering eBay out anyway (BricqerSyncService line 162),
  // so any bricqer-platform row tagged as eBay is anomalous. Don't auto-delete.
  for (const row of byProvider.ebay) {
    uncovered.push({
      row,
      provider: 'ebay',
      reason: 'eBay rows under platform=bricqer are anomalous — review manually',
    });
  }
  for (const row of byProvider.unknown) {
    uncovered.push({
      row,
      provider: 'unknown',
      reason: 'cannot detect provider from raw_data — review manually',
    });
  }

  console.log(`\n=== Coverage ===`);
  console.log(`  covered:   ${covered.length}`);
  console.log(`  uncovered: ${uncovered.length}`);

  if (uncovered.length > 0) {
    console.log(`\nUncovered rows (will NOT be deleted):`);
    for (const u of uncovered.slice(0, 20)) {
      console.log(
        `  ${u.row.platform_order_id.padEnd(20)}  provider=${u.provider.padEnd(10)}  ${u.reason}`
      );
    }
    if (uncovered.length > 20) console.log(`  ... and ${uncovered.length - 20} more`);
  }

  if (!DELETE_MODE) {
    console.log(
      `\nDRY RUN. Re-run with --delete to delete the ${covered.length} covered row(s).`
    );
    return;
  }

  if (covered.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log(`\nDeleting ${covered.length} covered row(s)…`);
  const ids = covered.map((r) => r.id);
  // Delete in chunks to stay within URL/payload limits
  const chunkSize = 500;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await supabase.from('platform_orders').delete().in('id', chunk);
    if (error) throw new Error(`Delete failed: ${error.message}`);
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${ids.length}`);
  }

  // Final verification
  const { count } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'bricqer');
  console.log(`\nRemaining platform='bricqer' rows: ${count}`);
  console.log(`  expected: ${uncovered.length} (uncovered rows preserved)`);
  console.log(`  match: ${count === uncovered.length ? 'OK' : 'MISMATCH'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
