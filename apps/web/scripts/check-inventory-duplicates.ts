/**
 * Check Inventory for Duplicates and Issues
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkInventory() {
  // Check items with "Alien" in the name
  console.log('Checking items with "Alien" in the name...\n');

  const { data: alienItems, error } = await supabase
    .from('inventory_items')
    .select('id, sku, set_number, item_name, storage_location, created_at')
    .ilike('item_name', '%Alien%')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${alienItems?.length || 0} items with "Alien" in name:\n`);

  for (const item of alienItems || []) {
    console.log(`SKU: ${item.sku}`);
    console.log(`  Set: ${item.set_number}`);
    console.log(`  Name: ${item.item_name}`);
    console.log(`  Location: ${item.storage_location}`);
    console.log(`  Created: ${item.created_at}`);
    console.log('');
  }

  // Also check for any items created today
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n--- Items created today (${today}) ---\n`);

  const { data: todayItems, error: todayError } = await supabase
    .from('inventory_items')
    .select('id, sku, set_number, item_name, storage_location, created_at')
    .gte('created_at', today)
    .order('created_at', { ascending: true })
    .limit(20);

  if (todayError) {
    console.error('Error:', todayError);
    return;
  }

  console.log(`Found ${todayItems?.length || 0} items created today:\n`);

  for (const item of todayItems || []) {
    console.log(`${item.created_at} - SKU: ${item.sku} - ${item.item_name?.substring(0, 50)}...`);
  }

  // Check total count
  const { count } = await supabase
    .from('inventory_items')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal inventory items: ${count}`);
}

checkInventory().catch(console.error);
