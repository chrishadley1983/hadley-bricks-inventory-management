/**
 * Ad-hoc catalogPG page sweep — the QUOTA-FREE bulk alternative to pg-live-check.
 *
 * Why (Chris 2026-07-14): BL's 5k/day store-API quota is SHARED with Bricqer repricing,
 * so our scripts get ~1,400/day absolute max (enforced in liveCheckBatch). One catalogPG
 * page load returns ALL FOUR quadrants plus six months of monthly detail — better data
 * than 4 API calls, no quota, at similar wall-clock. Rule of thumb: ≤50 tuples → API
 * live-check; anything bigger → this.
 *
 * Drives the dedicated BrickLink CDP Chrome on :9225 (launch-cdp-chrome.bat) and writes
 * through PriceGuideCacheService (source='catalogpg'), same as the nightly refresh lane.
 * On success it also pushes matching bl_pg_refresh_queue rows' next_due_at out, so the
 * nightly lane doesn't redo tonight what was swept today.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-page-sweep.ts --item=P:3001:11 --item=S:col10-6:0
 *   npx tsx scripts/pg/pg-page-sweep.ts --from-report=../../tmp/stores/<slug>/tuples.json
 *
 * Flags:
 *   --item=<T>:<no>:<colourId>  Repeatable. T is P|S|M; colourId 0 for S/M.
 *   --from-report=<path>        JSON: bare array of tuples or { "tuples": [...] };
 *                               camelCase (itemType/itemNo/colourId) or snake_case keys.
 *   --cdp-port=<n>              Chrome CDP port (default 9225).
 *   --nav-delay-ms=<n>          Delay between page loads (default 4500 + jitter).
 *   --limit=<n>                 Stop after n tuples.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  PgScraper,
  PgBlockError,
  PgCaptchaError,
  PgLoginError,
  PgCurrencyError,
  PgNotFoundError,
  PgNoDataError,
  isPgCdpReachable,
  reduceStockOffers,
  type PgItemRef,
  type PgItemType,
  type PgScrapeResult,
} from '../../src/lib/bricklink/price-guide-page';
import { PriceGuideCacheService } from '../../src/lib/bricklink/price-guide-cache.service';
import { fetchSetShipsMap } from '../../src/lib/bricklink/set-ships';
import { createScriptBlContext } from '../_bl-client';

const argv = process.argv.slice(2).reduce<Record<string, string[]>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  (acc[k] ??= []).push(v ?? 'true');
  return acc;
}, {});

const CDP_PORT = parseInt(argv['cdp-port']?.[0] ?? '9225', 10);
const NAV_DELAY_MS = Math.max(3000, parseInt(argv['nav-delay-ms']?.[0] ?? '4500', 10));
const LIMIT = parseInt(argv['limit']?.[0] ?? '0', 10);
const FLUSH_AT = 25;
// Ships-to-me API budget (Tier-1 intl set-arb): max API CALLS this run for enriching set
// offers with shipping_available (2 calls/set). Default 300 keeps the 1k test inside the
// shared BL quota; --no-ships disables entirely (page-only, UK offers).
const SHIPS_BUDGET = argv['no-ships'] ? 0 : parseInt(argv['ships-budget']?.[0] ?? '300', 10);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseTuples(): PgItemRef[] {
  const out: PgItemRef[] = [];
  for (const spec of argv['item'] ?? []) {
    const [t, no, colour] = spec.split(':');
    if (!t || !no || !/^[PSM]$/i.test(t)) { console.error(`bad --item=${spec} (want T:no:colourId)`); process.exit(1); }
    out.push({ itemType: t.toUpperCase() as PgItemType, itemNo: no, colourId: parseInt(colour ?? '0', 10) || 0 });
  }
  for (const p of argv['from-report'] ?? []) {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    const arr = Array.isArray(raw) ? raw : (raw as { tuples?: unknown[] }).tuples;
    if (!Array.isArray(arr)) { console.error(`--from-report=${p}: no tuples array`); process.exit(1); }
    for (const r of arr as Record<string, unknown>[]) {
      const t = String(r.itemType ?? r.item_type ?? '').toUpperCase();
      const no = String(r.itemNo ?? r.item_no ?? '');
      const colour = parseInt(String(r.colourId ?? r.colour_id ?? '0'), 10) || 0;
      if (!/^[PSM]$/.test(t) || !no) continue;
      out.push({ itemType: t as PgItemType, itemNo: no, colourId: colour });
    }
  }
  // Dedupe
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.itemType}:${r.itemNo}:${r.colourId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main(): Promise<void> {
  const tuples0 = parseTuples();
  const tuples = LIMIT > 0 ? tuples0.slice(0, LIMIT) : tuples0;
  if (!tuples.length) { console.error('no tuples — pass --item or --from-report'); process.exit(1); }

  if (!(await isPgCdpReachable(CDP_PORT))) {
    console.error(`[pg-page-sweep] CDP Chrome not reachable on :${CDP_PORT} — start C:\\chrome-cdp\\launch-cdp-chrome.bat`);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env (.env.local)'); process.exit(1); }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const cacheService = new PriceGuideCacheService(supabase);
  // BL API client for ships-to-me enrichment (sets only). Null when disabled.
  const bl = SHIPS_BUDGET > 0 ? createScriptBlContext('pg-page-sweep-ships') : null;

  console.log(`[pg-page-sweep] ${tuples.length} tuple(s), cdpPort=${CDP_PORT}, navDelay=${NAV_DELAY_MS}ms, shipsBudget=${SHIPS_BUDGET}`);

  const scraper = new PgScraper({ cdpPort: CDP_PORT });
  await scraper.open();

  const results: PgScrapeResult[] = [];
  const okRefs: PgItemRef[] = [];
  let ok = 0, noData = 0, notFound = 0, failed = 0, reestablishes = 0;
  let shipsSpent = 0, shipsEnriched = 0;

  const flush = async () => {
    if (!results.length) return;
    await cacheService.upsert(results.splice(0));
    // Best-effort: push matching queue rows out so tonight's lane doesn't redo this work.
    const due = new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString();
    for (const r of okRefs.splice(0)) {
      await supabase
        .from('bl_pg_refresh_queue')
        .update({ last_refreshed_at: new Date().toISOString(), next_due_at: due })
        .eq('item_type', r.itemType).eq('item_no', r.itemNo).eq('colour_id', r.colourId);
    }
  };

  try {
    for (let i = 0; i < tuples.length; i++) {
      const item = tuples[i];
      const label = `${item.itemType} ${item.itemNo}${item.itemType === 'P' ? ` c${item.colourId}` : ''}`;
      if (i > 0) await sleep(NAV_DELAY_MS + Math.floor(Math.random() * 1500));
      let attempt = 0;
      for (;;) {
        try {
          const result = await scraper.scrape(item);
          // Ships-to-me enrichment (sets with cheap international supply only). UK listings
          // always ship, so we only spend the API when the cheapest ~15 include an intl
          // seller — and only up to the run's --ships-budget cap.
          if (
            bl && result.stockListings && shipsSpent < SHIPS_BUDGET &&
            [...result.stockListings.new, ...result.stockListings.used].slice(0, 30).some((o) => o.intl)
          ) {
            try {
              const shipsMap = await fetchSetShipsMap(bl.bl, item.itemNo);
              result.stockOffers = {
                new: reduceStockOffers(result.stockListings.new, shipsMap),
                used: reduceStockOffers(result.stockListings.used, shipsMap),
              };
              shipsSpent += 2;
              shipsEnriched++;
            } catch (e) {
              console.warn(`  ships enrich failed for ${label}: ${(e as Error).message}`);
            }
          }
          results.push(result);
          okRefs.push(item);
          ok++;
          break;
        } catch (err) {
          if (err instanceof PgNoDataError) { noData++; break; }
          if (err instanceof PgNotFoundError) { notFound++; console.warn(`  not in catalog: ${label}`); break; }
          const transient = err instanceof PgBlockError && attempt < 2;
          const sessionShaped = (err instanceof PgLoginError || err instanceof PgCurrencyError) && reestablishes < 3;
          if (transient) {
            attempt++;
            console.warn(`  transient block on ${label} — retry ${attempt}/2 in 20s`);
            await sleep(20_000);
            continue;
          }
          if (sessionShaped) {
            reestablishes++;
            console.warn(`  session-shaped failure on ${label} (${(err as Error).name}) — 60s pause then retry (${reestablishes}/3)`);
            await sleep(60_000);
            continue;
          }
          if (err instanceof PgCaptchaError) {
            console.error(`[pg-page-sweep] CAPTCHA at ${label} — stopping (${ok} done)`);
            throw err;
          }
          failed++;
          console.warn(`  failed: ${label}: ${(err as Error).message}`);
          break;
        }
      }
      if (results.length >= FLUSH_AT) await flush();
      if ((i + 1) % 50 === 0) console.log(`[pg-page-sweep] ${i + 1}/${tuples.length} (${ok} ok)`);
    }
  } finally {
    await flush().catch((e: Error) => console.error(`[pg-page-sweep] final flush failed: ${e.message}`));
    await scraper.close();
  }

  console.log(`[pg-page-sweep] done: ${ok} ok, ${noData} no-data, ${notFound} not-in-catalog, ${failed} failed of ${tuples.length}; ships-enriched ${shipsEnriched} set(s) (${shipsSpent} API calls)`);
  process.exitCode = failed > tuples.length / 2 ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
