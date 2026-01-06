/**
 * Debug script to check what data is being returned from Bricqer API
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { BricqerClient, normalizeOrder } from '../src/lib/bricqer';
import { CredentialsRepository } from '../src/lib/repositories/credentials.repository';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugBricqerData() {
  // Get the user ID from platform_credentials
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

  console.log('Found user ID:', userId.substring(0, 8) + '...');

  // Get credentials
  const credRepo = new CredentialsRepository(supabase);
  const credentials = await credRepo.getCredentials(userId, 'bricqer');

  if (!credentials) {
    console.log('No Bricqer credentials configured');
    return;
  }

  // Create client
  const client = new BricqerClient(credentials);

  // Fetch one archived order with full details
  console.log('\n=== FETCHING ONE ORDER WITH FULL DETAILS ===\n');

  const archivedOrders = await client.getAllOrders({ filed: true });
  const nonEbayOrder = archivedOrders.find(o => o.orderProvider !== 'eBay');

  if (!nonEbayOrder) {
    console.log('No non-eBay orders found');
    return;
  }

  console.log('Order from list:', nonEbayOrder.displayName, '- provider:', nonEbayOrder.orderProvider);

  // Fetch full order details
  const { order: fullOrder, items } = await client.getOrderWithItems(nonEbayOrder.id);

  console.log('\n=== RAW ORDER DETAIL ===');
  console.log('journal:', JSON.stringify(fullOrder.journal, null, 2));
  console.log('costShipping:', fullOrder.costShipping);
  console.log('invoiceSet:', JSON.stringify(fullOrder.invoiceSet, null, 2));
  console.log('items from getOrderWithItems:', items.length);

  // Now normalize it
  console.log('\n=== NORMALIZED ORDER ===');
  const normalized = normalizeOrder(fullOrder, items);

  console.log('buyerName:', normalized.buyerName);
  console.log('buyerEmail:', normalized.buyerEmail);
  console.log('shipping:', normalized.shipping);
  console.log('items.length:', normalized.items.length);
  console.log('items type:', typeof normalized.items, Array.isArray(normalized.items));
  console.log('lotCount:', normalized.lotCount);
  console.log('pieceCount:', normalized.pieceCount);

  // Check the itemsCount calculation
  const itemsCount = normalized.pieceCount || normalized.lotCount || normalized.items.length || 0;
  console.log('\nFinal itemsCount:', itemsCount, 'type:', typeof itemsCount);

  // Check if items is actually an array
  if (!Array.isArray(normalized.items)) {
    console.log('\n!!! WARNING: normalized.items is NOT an array !!!');
    console.log('normalized.items:', normalized.items);
  }
}

debugBricqerData().catch(console.error);
