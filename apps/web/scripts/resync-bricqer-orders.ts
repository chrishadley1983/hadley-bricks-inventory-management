/**
 * Script to delete all Bricqer orders and re-sync with full details
 * This forces fetching detailed data including customer name and shipping cost
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BricqerSyncService } from '../src/lib/services/bricqer-sync.service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resyncBricqerOrders() {
  // Get the user ID from platform_credentials table (since orders may have been deleted)
  const { data: creds } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = creds?.[0]?.user_id;

  if (!userId) {
    console.log('No Bricqer credentials found - cannot determine user ID');
    return;
  }

  console.log('Found user ID:', userId.substring(0, 8) + '...');

  // Count existing Bricqer orders
  const { count: existingCount } = await supabase
    .from('platform_orders')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('platform', 'bricqer');

  console.log(`Found ${existingCount} existing Bricqer orders`);

  // Delete all Bricqer orders for this user
  console.log('\nDeleting all Bricqer orders...');
  const { error: deleteError } = await supabase
    .from('platform_orders')
    .delete()
    .eq('user_id', userId)
    .eq('platform', 'bricqer');

  if (deleteError) {
    console.error('Failed to delete orders:', deleteError);
    return;
  }

  console.log('Deleted all Bricqer orders');

  // Re-sync with includeItems: true to get full details
  console.log('\nRe-syncing with full details (includeItems: true)...');
  console.log('This will fetch detailed data for each order (customer name, shipping cost, item count)');
  console.log('This may take a while...\n');

  const syncService = new BricqerSyncService(supabase);

  const result = await syncService.syncOrders(userId, {
    includeItems: true,  // This fetches detailed data for each order
    includeArchived: true,
  });

  console.log('\n=== SYNC RESULT ===');
  console.log('Success:', result.success);
  console.log('Orders processed:', result.ordersProcessed);
  console.log('Orders created:', result.ordersCreated);
  console.log('Orders updated:', result.ordersUpdated);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.slice(0, 10).forEach(e => console.log(' -', e));
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more errors`);
    }
  }

  // Verify the fix by checking a few orders
  console.log('\n=== VERIFYING FIX ===');
  const { data: verifyOrders } = await supabase
    .from('platform_orders')
    .select('platform_order_id, buyer_name, shipping, items_count')
    .eq('user_id', userId)
    .eq('platform', 'bricqer')
    .limit(5);

  if (verifyOrders && verifyOrders.length > 0) {
    console.log('\nSample orders after re-sync:');
    for (const order of verifyOrders) {
      console.log(`  ${order.platform_order_id}: buyer="${order.buyer_name}", shipping=£${order.shipping?.toFixed(2) || '0.00'}, items=${order.items_count || 0}`);
    }
  }
}

resyncBricqerOrders().catch(console.error);
