#!/usr/bin/env npx tsx

/**
 * One-time repair script: Backfill Amazon order items + link to inventory
 *
 * Fixes the Feb 2025 bug where order headers were synced but items were
 * never fetched, causing the LISTED->SOLD pipeline to break.
 *
 * Steps:
 * 1. Reset false-positive 'complete' orders that have items_count=0
 * 2. Backfill order items from Amazon API for orders with items_count=0
 * 3. Run inventory linking on orders with inventory_link_status=null
 *
 * Usage: npx tsx apps/web/src/scripts/backfill-and-link-amazon-orders.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from apps/web/.env.local
config({ path: resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { AmazonBackfillService } from '../lib/services/amazon-backfill.service';
import { AmazonInventoryLinkingService } from '../lib/amazon/amazon-inventory-linking.service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('=== Amazon Order Items Backfill & Link ===\n');

  // Get the user (single-tenant assumption)
  const { data: users } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'amazon')
    .limit(1);

  if (!users || users.length === 0) {
    console.error('No users with Amazon credentials found');
    process.exit(1);
  }

  const userId = users[0].user_id;
  console.log(`User: ${userId.substring(0, 8)}...`);

  // Step 1: Reset false-positive 'complete' orders
  console.log('\n--- Step 1: Reset false-positive complete orders ---');
  const { data: resetData, error: resetError } = await supabase
    .from('platform_orders')
    .update({ inventory_link_status: null })
    .eq('platform', 'amazon')
    .eq('user_id', userId)
    .eq('inventory_link_status', 'complete')
    .or('items_count.eq.0,items_count.is.null')
    .select('id, platform_order_id');

  if (resetError) {
    console.error('Reset error:', resetError.message);
  } else {
    console.log(`Reset ${resetData?.length ?? 0} false-positive complete orders`);
    if (resetData && resetData.length > 0) {
      for (const order of resetData) {
        console.log(`  - ${order.platform_order_id}`);
      }
    }
  }

  // Step 2: Count orders needing backfill
  console.log('\n--- Step 2: Backfill order items from Amazon API ---');
  const backfillService = new AmazonBackfillService(supabase);
  const needsBackfill = await backfillService.countOrdersNeedingBackfill(userId);
  console.log(`Orders needing backfill: ${needsBackfill}`);

  if (needsBackfill > 0) {
    const progress = await backfillService.startBackfill(userId, {
      batchSize: 100, // No Vercel timeout to worry about
      delayMs: 1200,
    });

    console.log(`Started backfill for ${progress.total} orders...`);

    // Poll progress until complete (no timeout limit in CLI)
    while (true) {
      const current = backfillService.getProgress(userId);
      if (!current.isRunning) {
        console.log(`\nBackfill complete:`);
        console.log(`  Total: ${current.total}`);
        console.log(`  Success: ${current.success}`);
        console.log(`  Failed: ${current.failed}`);
        if (current.errors.length > 0) {
          console.log(`  Errors:`);
          for (const err of current.errors) {
            console.log(`    - ${err}`);
          }
        }
        break;
      }

      process.stdout.write(
        `\r  Processing: ${current.processed}/${current.total} (${current.success} ok, ${current.failed} failed) - ETA: ${current.estimatedSecondsRemaining ?? '?'}s`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } else {
    console.log('No orders need backfill - skipping');
  }

  // Step 3: Run inventory linking
  console.log('\n--- Step 3: Link orders to inventory ---');
  const linkingService = new AmazonInventoryLinkingService(supabase, userId);
  const linkingResult = await linkingService.processHistoricalOrders({
    mode: 'auto',
    includeSold: true,
    onProgress: (current, total, autoLinked, queued) => {
      process.stdout.write(
        `\r  Processing: ${current}/${total} (${autoLinked} linked, ${queued} queued)`
      );
    },
  });

  console.log(`\n\nLinking complete:`);
  console.log(`  Orders processed: ${linkingResult.ordersProcessed}`);
  console.log(`  Orders complete: ${linkingResult.ordersComplete}`);
  console.log(`  Orders partial: ${linkingResult.ordersPartial}`);
  console.log(`  Orders pending: ${linkingResult.ordersPending}`);
  console.log(`  Auto-linked: ${linkingResult.totalAutoLinked}`);
  console.log(`  Queued for resolution: ${linkingResult.totalQueuedForResolution}`);
  if (linkingResult.errors.length > 0) {
    console.log(`  Errors:`);
    for (const err of linkingResult.errors.slice(0, 10)) {
      console.log(`    - ${err}`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
