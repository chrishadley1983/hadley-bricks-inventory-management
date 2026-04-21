/**
 * Script to check what fields the Bricqer API returns for purchases.
 * Specifically looking for purchase price / cost fields.
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

async function main() {
  const { data: orders } = await supabase
    .from('platform_orders')
    .select('user_id')
    .eq('platform', 'bricqer')
    .limit(1);

  const userId = orders?.[0]?.user_id;
  if (!userId) {
    console.log('No Bricqer user found');
    return;
  }

  const credRepo = new CredentialsRepository(supabase);
  const credentials = await credRepo.getCredentials(userId, 'bricqer');
  if (!credentials) {
    console.log('No credentials');
    return;
  }

  const client = new BricqerClient(credentials);

  // 1. List endpoint - first 3 purchases
  console.log('\n=== /inventory/purchase/ (list) — first 3 purchases raw ===\n');
  const purchases = await client.getPurchases(3);
  for (const p of purchases) {
    console.log(JSON.stringify(p, null, 2));
    console.log('---');
  }

  // 2. Try detail endpoint — purchase #42 (the one in the UI screenshot)
  console.log('\n=== /inventory/purchase/42/ (detail) ===\n');
  try {
    // @ts-expect-error private access
    const detail = await (client as { request: (url: string, opts?: unknown) => Promise<unknown> }).request('/inventory/purchase/42/');
    console.log(JSON.stringify(detail, null, 2));
  } catch (err) {
    console.log('Detail endpoint error:', err instanceof Error ? err.message : err);
  }

  // 3. Look at all field names across the list to find price-ish fields
  console.log('\n=== All top-level fields observed across purchases ===');
  const fields = new Set<string>();
  for (const p of purchases) {
    for (const k of Object.keys(p as Record<string, unknown>)) fields.add(k);
  }
  console.log([...fields].sort());

  // 4. Try with ?expand= or common Bricqer query patterns
  console.log('\n=== Trying /inventory/purchase/ with possible expand params ===');
  for (const qs of ['?expand=batches', '?include=price', '?detail=full']) {
    try {
      // @ts-expect-error private access
      const r = await (client as { request: (url: string) => Promise<unknown> }).request(`/inventory/purchase/${qs}`);
      const first = Array.isArray(r) ? r[0] : (r as { results?: unknown[] }).results?.[0];
      if (first) {
        console.log(`${qs} — fields:`, Object.keys(first as Record<string, unknown>).sort());
      }
    } catch (err) {
      console.log(`${qs} — error:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
