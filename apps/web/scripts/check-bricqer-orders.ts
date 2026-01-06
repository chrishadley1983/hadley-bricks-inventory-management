/**
 * Check what orders Bricqer API returns vs what's in the database
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import * as dotenv from 'dotenv';
import { createDecipheriv, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY!;

const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const supabase = createSupabaseClient<Database>(supabaseUrl, supabaseServiceKey);

async function decrypt<T>(encryptedData: string): Promise<T> {
  let base64Data = encryptedData;
  if (encryptedData.startsWith('\\x')) {
    const hexStr = encryptedData.slice(2);
    base64Data = Buffer.from(hexStr, 'hex').toString('utf8');
  }

  const combined = Buffer.from(base64Data, 'base64');
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = (await scryptAsync(encryptionKey, salt, KEY_LENGTH)) as Buffer;
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

interface BricqerCredentials {
  tenantUrl: string;
  apiKey: string;
}

async function fetchOrders(baseUrl: string, apiKey: string, params: string = '') {
  const url = `${baseUrl}/orders/order/${params ? '?' + params : ''}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Api-Key ${apiKey}`,
      'Accept': 'application/json',
    },
  });
  return res.json();
}

async function run() {
  console.log('🔍 Checking Bricqer API orders\n');
  console.log('='.repeat(70));

  const { data: credData } = await supabase
    .from('platform_credentials')
    .select('credentials_encrypted')
    .eq('platform', 'bricqer')
    .single();

  if (!credData) {
    console.log('❌ No credentials found');
    return;
  }

  const creds = await decrypt<BricqerCredentials>(credData.credentials_encrypted);
  const baseUrl = `${creds.tenantUrl}/api/v1`;

  // Test 1: Default query (no params)
  console.log('\n📋 Test 1: Default API response (no params)');
  let data = await fetchOrders(baseUrl, creds.apiKey);
  console.log('  Raw response type:', typeof data);
  console.log('  Is array:', Array.isArray(data));
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    console.log('  Object keys:', Object.keys(data));
    if (data.results) {
      console.log('  Has results array, length:', data.results.length);
    }
    if (data.count !== undefined) {
      console.log('  Has count:', data.count);
    }
  }
  // Check for paginated response with results key
  let orders = Array.isArray(data) ? data : (data?.results || []);
  console.log('  Orders extracted:', orders.length);

  // Test 2: With high limit
  console.log('\n📋 Test 2: With limit=500');
  data = await fetchOrders(baseUrl, creds.apiKey, 'limit=500');
  orders = Array.isArray(data) ? data : (data?.results || []);
  console.log('  Total returned:', orders.length);

  // Test 3: Check for BrickLink orders specifically
  console.log('\n📋 Test 3: BrickLink orders in API response');
  const brickLinkOrders = orders.filter((o: any) =>
    o.orderProvider?.toLowerCase() === 'bricklink' ||
    o.displayName?.toLowerCase().includes('bricklink')
  );
  console.log('  BrickLink orders found:', brickLinkOrders.length);
  if (brickLinkOrders.length > 0) {
    console.log('  Sample BrickLink orders:');
    brickLinkOrders.slice(0, 5).forEach((o: any, i: number) => {
      console.log(`    ${i + 1}. #${o.id} | ${o.displayName} | ${o.status} | filed: ${o.filed}`);
    });
  }

  // Test 4: Check order providers in API
  console.log('\n📋 Test 4: Order providers breakdown');
  const providers: Record<string, number> = {};
  orders.forEach((o: any) => {
    const provider = o.orderProvider || 'unknown';
    providers[provider] = (providers[provider] || 0) + 1;
  });
  Object.entries(providers).forEach(([provider, count]) => {
    console.log(`  ${provider}: ${count}`);
  });

  // Test 5: Check filed=true vs filed=false with pagination
  console.log('\n📋 Test 5: Filed (archived) filter - with pagination');

  // Fetch ALL pages for filed=true
  let allFiledTrue: any[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    console.log(`    Fetching filed=true page ${page}...`);
    data = await fetchOrders(baseUrl, creds.apiKey, `filed=true&limit=100&page=${page}`);
    const results = Array.isArray(data) ? data : (data?.results || []);
    allFiledTrue.push(...results);
    // Stop if we got less than 100 (last page) or if results is empty
    hasMore = results.length === 100;
    page++;
    if (page > 20) break; // Safety limit
  }
  const filedTrue = allFiledTrue;
  console.log('  filed=true: (all pages)', filedTrue.length, 'orders');

  // Fetch ALL pages for filed=false
  let allFiledFalse: any[] = [];
  page = 1;
  hasMore = true;
  while (hasMore) {
    console.log(`    Fetching filed=false page ${page}...`);
    data = await fetchOrders(baseUrl, creds.apiKey, `filed=false&limit=100&page=${page}`);
    const results = Array.isArray(data) ? data : (data?.results || []);
    allFiledFalse.push(...results);
    // Stop if we got less than 100 (last page) or if results is empty
    hasMore = results.length === 100;
    page++;
    if (page > 20) break; // Safety limit
  }
  const filedFalse = allFiledFalse;
  console.log('  filed=false (all pages):', filedFalse.length, 'orders');

  // Test 6: Check BrickLink in filed=true
  console.log('\n📋 Test 6: BrickLink orders by filed status');
  const blFiledTrue = filedTrue.filter((o: any) => o.orderProvider?.toLowerCase() === 'bricklink');
  const blFiledFalse = filedFalse.filter((o: any) => o.orderProvider?.toLowerCase() === 'bricklink');
  console.log('  BrickLink in filed=true:', blFiledTrue.length);
  console.log('  BrickLink in filed=false:', blFiledFalse.length);

  // Test 7: Check what's in our database
  console.log('\n📋 Test 7: Current database state');
  const { data: dbOrders, count } = await supabase
    .from('platform_orders')
    .select('platform_order_id, status', { count: 'exact' })
    .eq('platform', 'bricqer');

  console.log('  Bricqer orders in DB:', count);
  if (dbOrders && dbOrders.length > 0) {
    dbOrders.forEach((o, i) => {
      console.log(`    ${i + 1}. ${o.platform_order_id} | ${o.status}`);
    });
  }

  // Test 8: Show oldest and newest orders from API
  console.log('\n📋 Test 8: Date range of orders in API');
  if (orders.length > 0) {
    const sorted = [...orders].sort((a: any, b: any) =>
      new Date(a.created || a.paymentDate).getTime() - new Date(b.created || b.paymentDate).getTime()
    );
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    console.log('  Oldest:', oldest.displayName, '|', oldest.created || oldest.paymentDate);
    console.log('  Newest:', newest.displayName, '|', newest.created || newest.paymentDate);
  }

  console.log('\n' + '='.repeat(70));
}

run().catch(console.error);
