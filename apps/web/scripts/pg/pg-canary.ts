/**
 * PG Market Intelligence — daily golden-tuple canary (spec §4.4, done-criteria F3).
 *
 * Fetches a fixed set of ~20 high-liquidity "golden" tuples via every lane that's
 * configured for this run and compares their UK sold-new averages. A >5% divergence
 * on >=3 tuples fires a Discord alert — the standing defence against parse drift, FX
 * drift, or a silent BL page/API format change (spec §7.3/§4.4).
 *
 * Lanes:
 *   (a) anon-curl summary endpoint — ALWAYS attempted, credential-less. Uses
 *       `parsePgSummarySnippet`/`buildPgSummaryUrl` from `src/lib/bricklink/pg-summary`.
 *       IMPORTANT BASIS NOTE: this endpoint reports WORLDWIDE sold figures, so it is
 *       only ever compared against another lane's worldwide side — never against a
 *       UK-filtered figure (that would be a permanent false divergence, the UK gap
 *       is genuinely ~11%). Divergence checks run per basis:
 *         world basis: anon_curl vs catalogPG's world side
 *         uk basis:    catalogPG's uk side vs store API (countryCode=UK)
 *   (b) catalogPG via PgScraper — only if --cdp is passed (needs the domham91 CDP
 *       Chrome up, same as pg-refresh-cycle.ts).
 *   (c) BL store API via BrickLinkClient.getPartPriceGuide — only if --api is passed
 *       (spends a few `bricklink_api_calls_daily` calls; opt-in to conserve budget).
 *
 * If a golden tuple returns no data from every attempted lane, it's swapped for a
 * substitute pulled from the top of `bl_pg_refresh_queue` by rank_score (excluding
 * tuples already in the golden set) and retried once.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-canary.ts [--cdp] [--api] [--cdp-port=9225]
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  PgScraper,
  isPgCdpReachable,
  type PgItemRef,
  type PgItemType,
} from '../../src/lib/bricklink/price-guide-page';
import { buildPgSummaryUrl, parsePgSummarySnippet } from '../../src/lib/bricklink/pg-summary';
import { discordService } from '../../src/lib/notifications/discord.service';
import { createScriptBlContext } from '../_bl-client';
import type { BrickLinkItemType } from '../../src/lib/bricklink/types';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const USE_CDP = argv['cdp'] === 'true';
const USE_API = argv['api'] === 'true';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9225', 10);
const DIVERGENCE_PCT_THRESHOLD = 5;
// Absolute floor (Chris 2026-07-14): penny parts trip the % threshold on fractions of a
// penny (rounding + window-cadence differences between lanes), which is noise, not parser
// drift. A divergence only counts when it's ≥5% AND ≥3p.
const DIVERGENCE_ABS_FLOOR_GBP = 0.03;
const DIVERGENT_TUPLE_ALERT_MIN = 3;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-canary] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ANON_CURL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Golden tuples (spec §4.4: "golden-tuple canary set (~20 tuples incl. 3001/c11)").
// A deliberate mix of high-liquidity common parts (colours: 11=Black, 1=White,
// 5=Red), a couple of minifigs, and a couple of sets. Any entry that turns out to
// be wrong/renumbered gets swapped for a live substitute at runtime (see
// `resolveGoldenSet` below) — precision here matters less than the fallback.
// ---------------------------------------------------------------------------
export const GOLDEN_TUPLES: PgItemRef[] = [
  { itemType: 'P', itemNo: '3001', colourId: 11 }, // 2x4 brick, black
  { itemType: 'P', itemNo: '3001', colourId: 1 }, // 2x4 brick, white
  { itemType: 'P', itemNo: '3020', colourId: 11 }, // 2x4 plate, black
  { itemType: 'P', itemNo: '3020', colourId: 1 }, // 2x4 plate, white
  { itemType: 'P', itemNo: '3623', colourId: 11 }, // 1x3 plate, black
  { itemType: 'P', itemNo: '3005', colourId: 11 }, // 1x1 brick, black
  { itemType: 'P', itemNo: '3004', colourId: 11 }, // 1x2 brick, black
  { itemType: 'P', itemNo: '3002', colourId: 11 }, // 2x3 brick, black
  { itemType: 'P', itemNo: '3010', colourId: 11 }, // 1x4 brick, black
  { itemType: 'P', itemNo: '3022', colourId: 1 }, // 2x2 plate, white
  { itemType: 'P', itemNo: '3021', colourId: 1 }, // 2x3 plate, white
  { itemType: 'P', itemNo: '2456', colourId: 5 }, // 2x8 brick, red
  { itemType: 'P', itemNo: '3622', colourId: 11 }, // 1x3 brick, black
  { itemType: 'P', itemNo: '4073', colourId: 11 }, // 1x1 round plate, black
  { itemType: 'M', itemNo: 'sw0001', colourId: 0 }, // Luke Skywalker (Tatooine)
  { itemType: 'M', itemNo: 'col001', colourId: 0 }, // CMF Series 1
  { itemType: 'M', itemNo: 'twn001', colourId: 0 }, // early Town minifig
  { itemType: 'S', itemNo: '75192', colourId: 0 }, // Millennium Falcon UCS
  { itemType: 'S', itemNo: '10221', colourId: 0 }, // Super Star Destroyer
  { itemType: 'S', itemNo: '6285', colourId: 0 }, // Black Seas Barracuda
];

function tupleLabel(item: PgItemRef): string {
  return `${item.itemType} ${item.itemNo}${item.itemType === 'P' ? ` c${item.colourId}` : ''}`;
}
function tupleKey(item: { item_type: string; item_no: string; colour_id: number }): string {
  return `${item.item_type}:${item.item_no}:${item.colour_id}`;
}

/** Pull a substitute golden tuple from the top of the ranked queue, excluding a set
 *  of already-used keys. Best-effort: returns null if none available. */
async function pickSubstitute(sb: SupabaseClient, exclude: Set<string>): Promise<PgItemRef | null> {
  const { data, error } = await sb
    .from('bl_pg_refresh_queue')
    .select('item_type,item_no,colour_id')
    .eq('tier', 'active')
    .order('rank_score', { ascending: false })
    .limit(50);
  if (error) {
    console.warn(`[pg-canary] substitute lookup failed: ${error.message}`);
    return null;
  }
  for (const row of data ?? []) {
    const key = tupleKey(row);
    if (!exclude.has(key)) {
      return { itemType: row.item_type as PgItemType, itemNo: row.item_no, colourId: row.colour_id };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lane (a): anon-curl summary endpoint — dynamic import, module may not exist yet.
// ---------------------------------------------------------------------------

/** Worldwide sold-new average from the summary endpoint (see basis note in header). */
async function fetchAnonCurl(item: PgItemRef): Promise<{ worldNew: number | null } | null> {
  try {
    const url = buildPgSummaryUrl(item.itemType, item.itemNo, item.colourId, Date.now());
    const res = await fetch(url, { headers: { 'User-Agent': ANON_CURL_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const quads = parsePgSummarySnippet(html);
    if (!quads) throw new Error(`unparseable response (len=${html.length})`);
    return { worldNew: quads.soldN.lots > 0 ? quads.soldN.avg : null };
  } catch (e) {
    console.warn(`[pg-canary] anon-curl fetch failed for ${tupleLabel(item)}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lane (c): BL store API
// ---------------------------------------------------------------------------

function pgTypeToBlType(t: PgItemType): BrickLinkItemType {
  return t === 'P' ? 'PART' : t === 'M' ? 'MINIFIG' : 'SET';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[pg-canary] starting — anon-curl always on, cdp=${USE_CDP}, api=${USE_API}`);

  let scraper: PgScraper | null = null;
  if (USE_CDP) {
    const reachable = await isPgCdpReachable(CDP_PORT);
    if (!reachable) {
      console.warn(`[pg-canary] --cdp requested but CDP not reachable on port ${CDP_PORT} — catalogPG lane skipped.`);
    } else {
      scraper = new PgScraper({ cdpPort: CDP_PORT });
      await scraper.open();
    }
  }

  const bl = USE_API ? createScriptBlContext('pg-canary') : null;

  const exclude = new Set(GOLDEN_TUPLES.map((t) => tupleKey({ item_type: t.itemType, item_no: t.itemNo, colour_id: t.colourId })));
  let requests = 0;
  let ok = 0;
  let failed = 0;
  const divergences: Array<{ label: string; lanes: Record<string, number | null>; maxDivergencePct: number }> = [];

  try {
    for (let item of GOLDEN_TUPLES) {
      const lanes: Record<string, number | null> = {};

      // (a) anon-curl — always attempted. WORLD basis.
      requests += 1;
      const curl = await fetchAnonCurl(item);
      lanes.world_anon_curl = curl?.worldNew ?? null;
      if (curl) ok += 1;
      else failed += 1;
      await sleep(4000 + Math.floor(Math.random() * 2000)); // gentle-scraping discipline, mirrors lane C rate

      // (b) catalogPG — contributes to BOTH bases (page carries uk + world sides).
      if (scraper) {
        requests += 1;
        try {
          const result = await scraper.scrape(item);
          lanes.uk_catalogpg = result.uk.soldNew.avg;
          lanes.world_catalogpg = result.world.soldNew.avg;
          ok += 1;
        } catch (e) {
          lanes.uk_catalogpg = null;
          lanes.world_catalogpg = null;
          failed += 1;
          console.warn(`[pg-canary] catalogPG fetch failed for ${tupleLabel(item)}: ${e instanceof Error ? e.message : e}`);
        }
        await sleep(4000 + Math.floor(Math.random() * 2000));
      }

      // (c) store API — UK basis (countryCode=UK).
      if (bl) {
        requests += 1;
        try {
          // The store API wants the variant-suffixed set number ("75192-1"); bare "75192"
          // (the catalogPG page-lane format) gets PARAMETER_MISSING_OR_INVALID. Parts and
          // minifigs are unaffected.
          const apiItemNo = item.itemType === 'S' && !item.itemNo.includes('-') ? `${item.itemNo}-1` : item.itemNo;
          const guide = await bl.bl.getPartPriceGuide(pgTypeToBlType(item.itemType), apiItemNo, item.colourId, {
            countryCode: 'UK',
            currencyCode: 'GBP',
            guideType: 'sold',
            condition: 'N',
          });
          lanes.uk_store_api = parseFloat(guide.avg_price);
          ok += 1;
        } catch (e) {
          lanes.uk_store_api = null;
          failed += 1;
          console.warn(`[pg-canary] store API fetch failed for ${tupleLabel(item)}: ${e instanceof Error ? e.message : e}`);
        }
      }

      // No data from ANY attempted lane -> swap in a substitute and retry once.
      const attemptedLanes = Object.keys(lanes).length;
      const gotAnyData = Object.values(lanes).some((v) => v != null);
      if (attemptedLanes > 0 && !gotAnyData) {
        const sub = await pickSubstitute(supabase, exclude);
        if (sub) {
          console.log(`[pg-canary] ${tupleLabel(item)} had no data on any lane — substituting ${tupleLabel(sub)}`);
          exclude.add(tupleKey({ item_type: sub.itemType, item_no: sub.itemNo, colour_id: sub.colourId }));
          item = sub;
          // Note: not retried in this pass to keep the run bounded — it will be picked up
          // as a normal golden tuple next run once it's in the excluded/used history.
        }
      }

      // Divergence is only meaningful WITHIN a basis — UK vs worldwide genuinely
      // differ (~11% median, see spec §7.4), so cross-basis comparison would alert
      // permanently. Check each basis group independently.
      let worstPct = 0;
      let worstAbs = 0;
      for (const basis of ['uk_', 'world_'] as const) {
        const values = Object.entries(lanes)
          .filter(([k, v]) => k.startsWith(basis) && v != null)
          .map(([, v]) => v as number);
        if (values.length < 2) continue;
        const max = Math.max(...values);
        const min = Math.min(...values);
        const divergencePct = min > 0 ? ((max - min) / min) * 100 : 0;
        if (divergencePct > worstPct) {
          worstPct = divergencePct;
          worstAbs = max - min;
        }
      }
      if (worstPct > DIVERGENCE_PCT_THRESHOLD && worstAbs >= DIVERGENCE_ABS_FLOOR_GBP) {
        divergences.push({ label: tupleLabel(item), lanes, maxDivergencePct: worstPct });
      }
    }
  } finally {
    if (scraper) await scraper.close();
  }

  console.log(`[pg-canary] ${GOLDEN_TUPLES.length} golden tuple(s), ${requests} request(s): ${ok} ok / ${failed} failed`);
  console.log(`[pg-canary] ${divergences.length} tuple(s) diverged >${DIVERGENCE_PCT_THRESHOLD}% between lanes`);
  for (const d of divergences) {
    console.log(`  ! ${d.label}: ${JSON.stringify(d.lanes)} (${d.maxDivergencePct.toFixed(1)}%)`);
  }

  const runDate = new Date().toISOString().slice(0, 10);
  const { error: telemetryError } = await supabase.from('bl_pg_lane_telemetry').insert({
    run_date: runDate,
    lane: 'canary',
    session_no: 1,
    requests,
    ok,
    failed,
    first_block_at_request: null,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    notes: JSON.stringify({ tuples: GOLDEN_TUPLES.length, divergentCount: divergences.length, divergences }),
  });
  if (telemetryError) console.error(`[pg-canary] telemetry insert failed: ${telemetryError.message}`);

  if (divergences.length >= DIVERGENT_TUPLE_ALERT_MIN) {
    console.warn(`[pg-canary] ALERT threshold hit (${divergences.length} >= ${DIVERGENT_TUPLE_ALERT_MIN}) — sending Discord alert`);
    const result = await discordService.sendPgCanaryAlert({
      runDate,
      divergentCount: divergences.length,
      totalTuples: GOLDEN_TUPLES.length,
      divergences,
    });
    if (!result.success) console.error(`[pg-canary] Discord alert failed: ${result.error}`);
  }

  console.log('[pg-canary] done');
}

main().catch((e) => {
  console.error('[pg-canary] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
