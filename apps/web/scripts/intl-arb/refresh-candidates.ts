/**
 * Refresh bl_set_arb_candidates from the latest Tier-1 offers (intl-set-arb F3).
 * Scheduled nightly after the 00:05 lane D cycle (pg-refresh-cycle.ps1 post-step)
 * and runnable ad hoc:
 *
 *   npx tsx scripts/intl-arb/refresh-candidates.ts [--offers-max-age-days=10]
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';
import { refreshCandidates } from '../../src/lib/intl-set-arb/flagger.service';

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => {
  const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a;
}, {});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

refreshCandidates(supabase, { offersMaxAgeDays: parseFloat(argv['offers-max-age-days'] ?? '10') })
  .then((r) => {
    console.log(`[refresh-candidates] sets scanned ${r.setsScanned} · candidates ${r.candidatesWritten} · staled ${r.staleMarked} · no-weight ${r.skippedNoWeight} · no-sell-side ${r.skippedNoSellSide}`);
  })
  .catch((e) => { console.error('[refresh-candidates] fatal:', e); process.exit(1); });
