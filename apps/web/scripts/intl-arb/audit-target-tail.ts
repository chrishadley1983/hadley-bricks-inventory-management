/**
 * Audit the post-2021 target tail (intl-set-arb F6): which targets still lack
 * Tier-1 offers, split into "checked — no listings" (page scraped, no offers to
 * store) vs "pending" (never scraped / stale). No dedicated scrape — pending
 * tuples are already in the lane D queue and heal on the nightly cycle.
 *
 *   npx tsx scripts/intl-arb/audit-target-tail.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

(async () => {
  const t = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../tmp/post2021-sets.json'), 'utf8')) as
    | { tuples: { itemNo?: string; item_no?: string }[] }
    | { itemNo?: string; item_no?: string }[];
  const nos = [...new Set((Array.isArray(t) ? t : t.tuples).map((x) => (x.itemNo ?? x.item_no) as string))];

  const rows = new Map<string, { fetched_at: string; hasOffers: boolean }>();
  for (let i = 0; i < nos.length; i += 300) {
    const { data, error } = await supabase
      .from('bricklink_price_guide_cache')
      .select('item_no,fetched_at,stock_offers')
      .eq('item_type', 'S').in('item_no', nos.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { item_no: string; fetched_at: string; stock_offers: unknown }[]) {
      rows.set(r.item_no, { fetched_at: r.fetched_at, hasOffers: r.stock_offers != null });
    }
  }

  let withOffers = 0, checkedNoListings = 0, pending = 0;
  const pendingList: string[] = [];
  for (const no of nos) {
    const r = rows.get(no);
    if (r?.hasOffers) withOffers++;
    else if (r) checkedNoListings++;   // page scraped; nothing listable to store
    else { pending++; pendingList.push(no); }
  }
  console.log(`[audit-target-tail] targets ${nos.length}: offers ${withOffers} · checked-no-listings ${checkedNoListings} · pending(queue heals) ${pending}`);
  if (pendingList.length) console.log('  pending sample:', pendingList.slice(0, 20).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
