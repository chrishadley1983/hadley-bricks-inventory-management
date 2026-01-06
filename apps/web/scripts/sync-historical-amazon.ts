/**
 * Sync Historical Amazon Orders
 *
 * This script syncs ALL Amazon orders (not just last 90 days) WITHOUT fetching items.
 * Items can then be backfilled gradually using the backfill feature in the UI.
 *
 * Usage:
 *   npx tsx scripts/sync-historical-amazon.ts --days 365     # Last 1 year
 *   npx tsx scripts/sync-historical-amazon.ts --days 730     # Last 2 years
 *   npx tsx scripts/sync-historical-amazon.ts --all          # All time (careful!)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import type { Database } from '@hadley-bricks/database';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Import the sync service
import { AmazonSyncService } from '../src/lib/services/amazon-sync.service';

async function syncHistorical() {
  const args = process.argv.slice(2);

  // Parse arguments
  let daysBack = 90; // default
  const allTimeArg = args.includes('--all');
  const daysArg = args.find(a => a.startsWith('--days'));

  if (allTimeArg) {
    // Go back ~5 years for "all time"
    daysBack = 365 * 5;
    console.log('⚠️  Fetching ALL historical orders (up to 5 years)');
  } else if (daysArg) {
    const match = daysArg.match(/--days[=\s]?(\d+)/);
    if (match) {
      daysBack = parseInt(match[1], 10);
    } else {
      const daysIndex = args.indexOf('--days');
      if (daysIndex !== -1 && args[daysIndex + 1]) {
        daysBack = parseInt(args[daysIndex + 1], 10);
      }
    }
  }

  console.log(`\n📦 Amazon Historical Sync`);
  console.log(`   Going back ${daysBack} days`);
  console.log(`   Items will NOT be fetched (use backfill later)\n`);

  // Get user ID (assuming single user for now)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (!profiles || profiles.length === 0) {
    console.error('No user found!');
    process.exit(1);
  }

  const userId = profiles[0].id;
  console.log('User ID:', userId.substring(0, 8) + '...');

  // Check existing orders
  const { count: existingCount } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('platform', 'amazon');

  console.log('Existing Amazon orders in DB:', existingCount);

  // Create sync service
  const syncService = new AmazonSyncService(supabase);

  // Calculate date range
  const createdAfter = new Date();
  createdAfter.setDate(createdAfter.getDate() - daysBack);

  console.log(`\nFetching orders since: ${createdAfter.toISOString().split('T')[0]}`);
  console.log('This may take a while...\n');

  try {
    const result = await syncService.syncOrders(userId, {
      createdAfter,
      includeItems: false, // Don't fetch items - will use backfill
    });

    console.log('\n✅ Sync Complete!');
    console.log(`   Orders processed: ${result.ordersProcessed}`);
    console.log(`   Orders created: ${result.ordersCreated}`);
    console.log(`   Orders updated: ${result.ordersUpdated}`);

    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
      if (result.errors.length > 5) {
        console.log(`     ... and ${result.errors.length - 5} more`);
      }
    }

    // Check new count
    const { count: newCount } = await supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('platform', 'amazon');

    console.log(`\n   Total Amazon orders in DB now: ${newCount}`);

    // Count orders needing backfill
    const { count: needsBackfill } = await supabase
      .from('platform_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .or('items_count.eq.0,items_count.is.null');

    console.log(`   Orders needing item backfill: ${needsBackfill}`);
    console.log('\n💡 Go to Orders page and click "Fetch Missing Items" to backfill item details');

  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  }
}

syncHistorical();
