/**
 * Consignment builder CLI (intl-set-arb F4) — Tier-2 of the intl set-arb.
 *
 * Default: rank sellers by candidate depth (active candidates grouped by store)
 * and print the top consignment baskets with exact landed cost + margins.
 *
 * --store-id=<n>: deep-dive one seller. With --scan-store, also scrape the
 * seller's FULL store inventory over CDP (Tier-2 proper) to find arb sets
 * beyond the cheapest-10 capture, valuing extra sets through the same
 * flagger inputs (weights + Amazon quotes).
 *
 *   npx tsx scripts/intl-arb/build-consignment.ts                     # seller leaderboard
 *   npx tsx scripts/intl-arb/build-consignment.ts --store-id=510132  # one basket
 *   npx tsx scripts/intl-arb/build-consignment.ts --store-id=510132 --scan-store --cdp-port=9225
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';
import { buildConsignment, type ConsignmentItem } from '../../src/lib/intl-set-arb/consignment';
import type { ZoneCosts } from '../../src/lib/intl-set-arb/landed-cost';

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => {
  const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a;
}, {});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Cand {
  item_no: string; source_zone: string; source_country: string | null;
  source_store_id: number; source_store_name: string | null;
  buy_price_gbp: number; buy_qty: number; weight_g: number | null;
  sell_net_gbp: number | null; net_margin_gbp: number | null; velocity_drops90: number | null;
}

async function main() {
  const { data: zonesData, error: zErr } = await supabase.from('bl_import_zone_costs').select('*');
  if (zErr) throw new Error(zErr.message);
  const zones = (zonesData ?? []) as ZoneCosts[];

  const { data: candsData, error: cErr } = await supabase
    .from('bl_set_arb_candidates').select('*').eq('status', 'active').limit(5000);
  if (cErr) throw new Error(cErr.message);
  const cands = (candsData ?? []) as Cand[];

  const byStore = new Map<number, Cand[]>();
  for (const c of cands) {
    if (!byStore.has(c.source_store_id)) byStore.set(c.source_store_id, []);
    byStore.get(c.source_store_id)!.push(c);
  }

  const storeIdArg = argv['store-id'] ? Number(argv['store-id']) : null;
  const targets = storeIdArg ? [storeIdArg] : [...byStore.keys()];

  const baskets = targets
    .map((sid) => {
      const items = byStore.get(sid) ?? [];
      if (items.length === 0) return null;
      const zone = zones.find((z) => z.zone === items[0].source_zone)!;
      const cItems: ConsignmentItem[] = items
        .filter((c) => c.weight_g != null)
        .map((c) => ({
          itemNo: c.item_no,
          buyPriceGbp: Number(c.buy_price_gbp),
          weightG: Number(c.weight_g),
          sellNetGbp: c.sell_net_gbp == null ? null : Number(c.sell_net_gbp),
          qty: 1, // one of each flagged set — the buyer scales qty manually
        }));
      if (cItems.length === 0) return null;
      const b = buildConsignment(zone, cItems);
      return { sid, name: items[0].source_store_name, cc: items[0].source_country, zone: zone.zone, sets: cItems.length, b };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.b.netMarginGbp - a.b.netMarginGbp);

  console.log(`\n=== CONSIGNMENT BASKETS (${baskets.length} sellers with active candidates) ===`);
  for (const k of baskets.slice(0, storeIdArg ? 1 : 15)) {
    const fl = k.b.clearsFloor ? '' : '  ⚠ under £135 floor';
    console.log(`\n${(k.name ?? String(k.sid)).padEnd(28)} [${k.cc} ${k.zone}] ${k.sets} set(s)${fl}`);
    console.log(`  items £${k.b.itemsGbp} + ship £${k.b.shippingGbp} + duty £${k.b.dutyGbp} + VAT £${k.b.vatGbp} + handling £${k.b.handlingGbp} = landed £${k.b.landedGbp}`);
    console.log(`  sell net £${k.b.sellNetGbp} → NET £${k.b.netMarginGbp}${k.b.netMarginPct != null ? ` (${(100 * k.b.netMarginPct).toFixed(0)}%)` : ''}`);
    if (storeIdArg) {
      for (const i of k.b.perItem) {
        console.log(`    ${i.itemNo.padEnd(10)} buy £${String(i.buyPriceGbp).padStart(7)} · landed share £${String(i.landedShareGbp).padStart(7)} · margin £${i.itemMarginGbp ?? '—'}`);
      }
    }
  }
  if (argv['scan-store'] && storeIdArg) {
    console.log('\n[tier-2] --scan-store: full store scan not run here — use scripts/store-assessment.ts');
    console.log(`  npx tsx scripts/store-assessment.ts --store-slug=<slug> --cdp-port=${argv['cdp-port'] ?? '9225'}`);
    console.log('  (store slug from the store page; assessment reuses the same scrape + caches)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
