/**
 * Investigate Bricqer API to find part and lot counts
 * Looking for: 19 items, 17 lots for order BrickLink #29891125
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BricqerClient } from '../src/lib/bricqer/client';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function investigateCounts() {
  // Get credentials
  const { data: creds } = await supabase
    .from('platform_credentials')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = creds?.[0]?.user_id;
  if (!userId) {
    console.log('No Bricqer credentials found');
    return;
  }

  const credRepo = new CredentialsRepository(supabase);
  const credentials = await credRepo.getCredentials(userId, 'bricqer');
  if (!credentials) {
    console.log('No Bricqer credentials configured');
    return;
  }

  const client = new BricqerClient(credentials);

  // Find order BrickLink #29891125
  const archivedOrders = await client.getAllOrders({ filed: true });
  const targetOrder = archivedOrders.find(o => o.displayName === 'BrickLink #29891125');

  if (!targetOrder) {
    console.log('Order BrickLink #29891125 not found');
    return;
  }

  console.log('=== ORDER FROM LIST ===');
  console.log('Display Name:', targetOrder.displayName);
  console.log('ID:', targetOrder.id);
  console.log('\nFull list response:');
  console.log(JSON.stringify(targetOrder, null, 2));

  // Get detailed order
  console.log('\n\n=== DETAILED ORDER ===');
  const fullOrder = await client.getOrder(targetOrder.id);
  console.log(JSON.stringify(fullOrder, null, 2));

  // Look specifically for any count-related fields
  console.log('\n\n=== SEARCHING FOR COUNT FIELDS ===');
  const detailObj = fullOrder as Record<string, unknown>;

  function findCountFields(obj: unknown, path = ''): void {
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const currentPath = path ? `${path}.${key}` : key;

        // Look for fields that might contain counts
        if (
          key.toLowerCase().includes('count') ||
          key.toLowerCase().includes('quantity') ||
          key.toLowerCase().includes('lots') ||
          key.toLowerCase().includes('items') ||
          key.toLowerCase().includes('pieces') ||
          key.toLowerCase().includes('total')
        ) {
          console.log(`${currentPath}: ${JSON.stringify(value)}`);
        }

        // Also check for numeric values that might be 17 or 19
        if (typeof value === 'number' && (value === 17 || value === 19)) {
          console.log(`${currentPath}: ${value} <-- MATCHES!`);
        }

        // Recurse into objects and arrays
        if (typeof value === 'object') {
          findCountFields(value, currentPath);
        }
      }
    }
  }

  findCountFields(detailObj);

  // Also try getting items directly
  console.log('\n\n=== TRYING GET ORDER ITEMS ===');
  try {
    const items = await client.getOrderItems(targetOrder.id);
    console.log('Items count:', items.length);
    if (items.length > 0) {
      console.log('First item:', JSON.stringify(items[0], null, 2));
    }
  } catch (err) {
    console.log('Error:', err instanceof Error ? err.message : err);
  }

  // Check batchSet more thoroughly
  console.log('\n\n=== BATCH SET ANALYSIS ===');
  if (detailObj.batchSet) {
    const batches = detailObj.batchSet as Array<Record<string, unknown>>;
    console.log('Number of batches:', batches.length);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nBatch ${i}:`);
      console.log(JSON.stringify(batch, null, 2));
    }
  }

  // Check if there's a different endpoint for order items
  console.log('\n\n=== TRYING ALTERNATIVE ENDPOINTS ===');
  try {
    // @ts-expect-error - accessing private method
    const itemsResponse = await client.request(`/orders/order/${targetOrder.id}/items/`);
    console.log('Items endpoint response:', JSON.stringify(itemsResponse, null, 2));
  } catch (err) {
    console.log('/orders/order/{id}/items/ error:', err instanceof Error ? err.message : err);
  }

  try {
    // @ts-expect-error - accessing private method
    const linesResponse = await client.request(`/orders/order/${targetOrder.id}/lines/`);
    console.log('Lines endpoint response:', JSON.stringify(linesResponse, null, 2));
  } catch (err) {
    console.log('/orders/order/{id}/lines/ error:', err instanceof Error ? err.message : err);
  }
}

investigateCounts().catch(console.error);
