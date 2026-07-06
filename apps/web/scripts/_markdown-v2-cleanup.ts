/**
 * _markdown-v2-cleanup.ts
 *
 * One-off cleanup after deploying markdown v2 (position-first Amazon pricing).
 * The old engine's PENDING proposals are untrustworthy:
 *   - Amazon: step-curve priced 258 step-4 items at breakeven floor (median
 *     53% of market); steps 1-3 used a single arbitrary-vintage spot price.
 *   - eBay: every proposal was judged blind with 0 views (Analytics API was
 *     never called by the sweep) → systematic COLD bias + auction spam.
 *
 * This script:
 *   1) REJECTs ALL PENDING proposals (both platforms, incl. auction recs)
 *      with a rejection note explaining why.
 *   2) Resets next_markdown_eval_at = today on the affected inventory items
 *      so the new engine re-evaluates them promptly instead of in 30 days.
 *   3) Sets markdown_config.amazon_step1_days = 30 (agreed design: Amazon
 *      matching eligible from 30 days).
 *
 *   npx tsx scripts/_markdown-v2-cleanup.ts            (dry run)
 *   npx tsx scripts/_markdown-v2-cleanup.ts --apply
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

async function main() {
  const supabase = createClient(URL, KEY);
  const today = new Date().toISOString().split('T')[0];

  // 1. Collect all PENDING proposals (paginated)
  const pending: { id: string; inventory_item_id: string; platform: string; markdown_step: number | null }[] = [];
  let page = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('markdown_proposals')
      .select('id, inventory_item_id, platform, markdown_step')
      .eq('user_id', USER_ID)
      .eq('status', 'PENDING')
      .order('id', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    pending.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  const byPlatform = pending.reduce<Record<string, number>>((acc, p) => {
    acc[p.platform] = (acc[p.platform] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`PENDING proposals to reject: ${pending.length}`, byPlatform);

  const itemIds = Array.from(new Set(pending.map((p) => p.inventory_item_id)));
  console.log(`Inventory items to reset for prompt re-eval: ${itemIds.length}`);
  console.log(`Config change: amazon_step1_days -> 30`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to execute.');
    return;
  }

  // 2. Reject in batches
  const ids = pending.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { error } = await supabase
      .from('markdown_proposals')
      .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
      .in('id', batch);
    if (error) throw new Error(`Reject batch failed: ${error.message}`);
  }
  console.log(`Rejected ${ids.length} proposals.`);

  // 3. Reset eval clocks
  for (let i = 0; i < itemIds.length; i += 200) {
    const batch = itemIds.slice(i, i + 200);
    const { error } = await supabase
      .from('inventory_items')
      .update({ next_markdown_eval_at: today })
      .in('id', batch);
    if (error) throw new Error(`Clock reset failed: ${error.message}`);
  }
  console.log(`Reset next_markdown_eval_at=${today} on ${itemIds.length} items.`);

  // 4. Config: Amazon eligible from 30d
  const { error: cfgErr } = await supabase
    .from('markdown_config')
    .update({ amazon_step1_days: 30, updated_at: new Date().toISOString() })
    .eq('user_id', USER_ID);
  if (cfgErr) throw new Error(`Config update failed: ${cfgErr.message}`);
  console.log('Config updated: amazon_step1_days = 30.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
