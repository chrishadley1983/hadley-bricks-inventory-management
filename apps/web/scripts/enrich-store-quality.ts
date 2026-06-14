/**
 * Opt-in BrickLink STR/price enrichment for the store-quality blind spots.
 *
 * The store-quality scorecard is cached-only and surfaces a BLIND-HIGH-VALUE
 * shortlist (high-value lots with no market sell-through reading). This script
 * sizes that shortlist and, ONLY with --run, fills it via the BrickLink API
 * (reusing EnrichmentService, which is rate-limited and value-prioritised).
 *
 * Default (no --run): print the shortlist size + API-call estimate and STOP.
 * It never calls the BL API unless you pass --run.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/enrich-store-quality.ts                 # estimate only
 *   npx tsx scripts/enrich-store-quality.ts --run --max=200 # bounded fill
 *
 * Flags:
 *   --max=<n>     cap items to enrich (default 200; BL ~1,500/day usable headroom)
 *   --run         actually call the BL API (otherwise estimate-only)
 *   --segment=…   passed through to the scorecard (default all)
 *   --user-id=…
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { computeStoreQuality } from '../src/lib/store-quality';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});
const MAX = parseInt(argv['max'] ?? '200', 10);
const RUN = argv['run'] === 'true';
const SEGMENT = (argv['segment'] ?? 'all') as 'parts' | 'minifigs' | 'all';
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const DAILY_HEADROOM = 1500; // BL API calls/day usable to our code (see bricqer-bl-api-base-load memory)
const CALLS_PER_ITEM = 2; // EnrichmentService makes 2 calls/item (stock + sold)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const result = await computeStoreQuality(supabase, { userId: USER_ID, segment: SEGMENT });
  const blind = result.coverage.blindHighValue;
  const blindValue = blind.reduce((s, b) => s + b.listValue, 0);
  const target = Math.min(MAX, blind.length);
  const estCalls = target * CALLS_PER_ITEM;

  console.log('BLIND-HIGH-VALUE enrichment shortlist');
  console.log(`  ${blind.length} lots with no market STR reading, £${blindValue.toFixed(2)} of value.`);
  console.log(
    `  Filling the top ${target} ≈ ${estCalls} BL API calls ≈ ${Math.round((estCalls / DAILY_HEADROOM) * 100)}% of daily headroom.`
  );
  console.log('  Top 10:');
  for (const b of blind.slice(0, 10)) {
    console.log(`    ${b.itemNumber} ${b.colorName ?? ''} ${b.condition} ×${b.quantity}  £${b.listValue.toFixed(2)}`);
  }

  if (!RUN) {
    console.log('\n  Estimate only. Re-run with --run --max=<n> to fill via the BL API.');
    return;
  }

  console.log(`\n  --run set: enriching up to ${MAX} highest-value uncached items via BL API…`);
  const { EnrichmentService } = await import('../src/lib/inventory-explorer/enrichment.service');
  const svc = new EnrichmentService(supabase, USER_ID, 'store-quality-enrich');
  const res = await svc.enrich({
    maxItems: MAX,
    onProgress: (p: any) => {
      if (p?.processed && p.processed % 20 === 0) {
        process.stdout.write(`\r  enriched ${p.processed}/${p.total ?? MAX}   `);
      }
    },
  });
  process.stdout.write('\n');
  console.log(
    `  Done. processed ${res.totalProcessed}, newly fetched ${res.newlyFetched}, ` +
      `already cached ${res.alreadyCached}, errors ${res.errors}.`
  );
  console.log('  Re-run the scorecard to see coverage improve.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
