/**
 * Script to check what fields the Bricqer API returns for orders
 * This helps identify if we can get more customer/shipping details
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BricqerClient } from '../src/lib/bricqer/client';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';
import type { Database } from '@hadley-bricks/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

async function checkBricqerApiFields() {
  // Get the user ID from platform_orders table
  const { data: orders } = await supabase
    .from('platform_orders')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = orders?.[0]?.user_id;

  if (!userId) {
    console.log('No Bricqer orders found - cannot determine user ID');
    return;
  }

  console.log('Found user ID:', userId.substring(0, 8) + '...');

  // Get credentials
  const credRepo = new CredentialsRepository(supabase);
  const credentials = await credRepo.getCredentials(userId, 'bricqer');

  if (!credentials) {
    console.log('No Bricqer credentials configured');
    return;
  }

  console.log('Got Bricqer credentials');

  // Create client
  const client = new BricqerClient(credentials);

  // Fetch a few orders from the list
  console.log('\n=== ORDER LIST RESPONSE (first 2 orders) ===\n');
  const orderList = await client.getOrders({ limit: 2 });

  for (let i = 0; i < Math.min(2, orderList.length); i++) {
    console.log(`\n--- Order ${i + 1} from list ---`);
    console.log(JSON.stringify(orderList[i], null, 2));
  }

  if (orderList.length > 0) {
    // Now fetch full details for the first order
    const orderId = orderList[0].id;
    console.log(`\n=== ORDER DETAIL RESPONSE (order ${orderId}) ===\n`);

    const fullOrder = await client.getOrder(orderId);
    console.log(JSON.stringify(fullOrder, null, 2));

    // Try to get order items separately
    console.log('\n=== ORDER ITEMS (if separate endpoint exists) ===\n');
    try {
      const items = await client.getOrderItems(orderId);
      console.log(`Found ${items.length} items:`);
      if (items.length > 0) {
        console.log(JSON.stringify(items[0], null, 2));
      }
    } catch (err) {
      console.log('Items endpoint error:', err instanceof Error ? err.message : err);
    }

    // Check batchSet.itemSet
    console.log('\n=== BATCH SET CHECK ===\n');
    const detailOrder = fullOrder as Record<string, unknown>;
    if (detailOrder.batchSet) {
      console.log('batchSet:', JSON.stringify(detailOrder.batchSet, null, 2));
    }

    // Check for a non-eBay order (BrickLink, BrickOwl) to compare
    console.log('\n=== LOOKING FOR NON-EBAY ORDER (both archived and active) ===\n');

    // Try archived orders
    const archivedOrders = await client.getAllOrders({ filed: true });
    console.log(`Found ${archivedOrders.length} archived orders`);

    const nonEbayArchived = archivedOrders.find(o => o.orderProvider !== 'eBay');
    if (nonEbayArchived) {
      console.log('Found non-eBay archived order:', nonEbayArchived.orderProvider, nonEbayArchived.displayName);
      const nonEbayDetail = await client.getOrder(nonEbayArchived.id);
      console.log('\nNon-eBay archived order detail:');
      console.log(JSON.stringify(nonEbayDetail, null, 2));
    } else {
      console.log('No non-eBay orders found in archived');

      // Show order providers breakdown
      const providers = new Map<string, number>();
      for (const o of archivedOrders) {
        const p = o.orderProvider || 'Unknown';
        providers.set(p, (providers.get(p) || 0) + 1);
      }
      console.log('\nOrder providers in archived:', Object.fromEntries(providers));
    }

    // Also check one archived eBay order to see if it has items
    const archivedEbay = archivedOrders.find(o => o.orderProvider === 'eBay');
    if (archivedEbay) {
      console.log('\n=== ARCHIVED EBAY ORDER (checking for items) ===');
      console.log('Order:', archivedEbay.displayName);
      const archivedDetail = await client.getOrder(archivedEbay.id);
      const detail = archivedDetail as Record<string, unknown>;
      console.log('batchSet:', JSON.stringify(detail.batchSet, null, 2));

      // Check if invoiceSet has item details
      if (detail.invoiceSet) {
        console.log('invoiceSet:', JSON.stringify(detail.invoiceSet, null, 2));
      }
    }

    // Try fetching batch items endpoint
    console.log('\n=== TRYING BATCH ITEMS ENDPOINT ===');
    try {
      // Get a batch ID from an order
      const anyOrder = archivedOrders[0];
      if (anyOrder) {
        const anyOrderDetail = await client.getOrder(anyOrder.id) as Record<string, unknown>;
        const batches = anyOrderDetail.batchSet as Array<{ id: number; itemSet: unknown[] }>;
        if (batches && batches.length > 0) {
          const batchId = batches[0].id;
          console.log('Trying to get batch', batchId, 'items directly...');

          // Try fetching from a batch endpoint
          // @ts-expect-error - private method access for testing
          const response = await (client as { request: (url: string) => Promise<unknown> }).request(`/orders/batch/${batchId}/`);
          console.log('Batch response:', JSON.stringify(response, null, 2));
        }
      }
    } catch (err) {
      console.log('Batch endpoint error:', err instanceof Error ? err.message : err);
    }
  }
}

checkBricqerApiFields().catch(console.error);
