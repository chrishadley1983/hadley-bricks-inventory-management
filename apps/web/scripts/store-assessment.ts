/**
 * store-assessment.ts — the "assess" lens of the BL Arbitrage skill.
 *
 * Scrapes an external BrickLink seller once, then scores its whole inventory against
 * the cached price-guide / STR / worldwide-supply layers to produce a store scorecard:
 * size & value, pricing strategy, feedback & order rate, part mix, lots within our
 * buying margin, high-STR lots, and magnets (scarce + selling). Persists to
 * `store_assessments` and renders a terminal report.
 *
 * Modes:
 *   --mode=light   (default) scrape → join CACHES ONLY. Fast. Reuses a fresh
 *                  tmp/stores/<slug>/inventory.json (e.g. from a prior bl-basket run).
 *   --mode=full    scrape → live gap-fill UK price guides for the top uncovered
 *                  high-value part/minifig lots → richer scorecard.
 *
 * Usage:
 *   npx tsx scripts/store-assessment.ts --store-slug=<name> [--mode=full] [--json]
 *     [--min-margin=0.20] [--min-str=0.5] [--magnet-max-supply=3] [--inbound-per-unit=0]
 *     [--cache-ttl-days=90] [--gapfill-budget=120] [--force-rescrape] [--no-persist]
 *     [--allow-non-uk] [--cdp-port=9222] [--user-id=<uuid>]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { BrickLinkClient } from '../src/lib/bricklink/client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, pgKey } from '../src/lib/bricklink/price-guide/read';
import { computeStoreAssessment, ENGINE_VERSION } from '../src/lib/bl-store-assessment/engine';
import { renderAssessment } from '../src/lib/bl-store-assessment/format';
import type { StoreLot, AssessMode } from '../src/lib/bl-store-assessment/types';
import { connectCdp, preflight, scrapeStoreInventory, scrapeStoreProfile } from './lib/store-scrape';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const STORE_SLUG = argv['store-slug'];
if (!STORE_SLUG) { console.error('Required: --store-slug=<name>'); process.exit(1); }
const MODE: AssessMode = argv['mode'] === 'full' ? 'full' : 'light';
const JSON_OUT = argv['json'] === 'true';
const NO_PERSIST = argv['no-persist'] === 'true';
const ALLOW_NON_UK = argv['allow-non-uk'] === 'true';
const FORCE_RESCRAPE = argv['force-rescrape'] === 'true';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const MAX_PAGES = Math.min(200, parseInt(argv['max-pages'] ?? '50', 10));
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10));
const INVENTORY_TTL_DAYS = parseFloat(argv['inventory-ttl-days'] ?? '7');
const GAPFILL_BUDGET = parseInt(argv['gapfill-budget'] ?? '120', 10);
const GAPFILL_DELAY_MS = parseInt(argv['gapfill-delay-ms'] ?? '400', 10);

const inputs = {
  minAsk: parseFloat(argv['min-ask'] ?? '0.10'),
  minMargin: parseFloat(argv['min-margin'] ?? '0.20'),
  minStr: parseFloat(argv['min-str'] ?? '0.5'),
  magnetMaxSupplyLots: parseInt(argv['magnet-max-supply'] ?? '3', 10),
  inboundPerUnit: parseFloat(argv['inbound-per-unit'] ?? '0'),
  cacheTtlDays: parseInt(argv['cache-ttl-days'] ?? '90', 10),
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

const OUT_DIR = path.resolve(__dirname, `../../../tmp/stores/${STORE_SLUG}`);
const INVENTORY_FILE = path.join(OUT_DIR, 'inventory.json');
const INVENTORY_META_FILE = path.join(OUT_DIR, 'inventory.meta.json');
const log = (m: string) => { if (!JSON_OUT) console.log(m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the owning user for the persisted row: flag → env → the sole profiles row.
 * Errors out rather than guessing when several profiles exist.
 */
async function resolveUserId(sb: ReturnType<typeof createClient>): Promise<string> {
  const fromArgs = argv['user-id'] ?? process.env.STORE_ASSESSMENT_USER_ID;
  if (fromArgs) return fromArgs;
  const { data, error } = await sb.from('profiles').select('id').limit(2);
  if (error) throw new Error(`resolveUserId: profiles read failed: ${error.message}`);
  if (!data || data.length !== 1) {
    throw new Error(`resolveUserId: ${data?.length ?? 0} profiles found — pass --user-id=<uuid> or set STORE_ASSESSMENT_USER_ID`);
  }
  return data[0].id as string;
}

/** Cached inventory + whether that scrape was truncated (sidecar meta; absent = assume complete). */
function readCachedInventory(): { lots: StoreLot[]; truncated: boolean } | null {
  if (FORCE_RESCRAPE || !fs.existsSync(INVENTORY_FILE)) return null;
  const ageDays = (Date.now() - fs.statSync(INVENTORY_FILE).mtimeMs) / 86400000;
  if (ageDays > INVENTORY_TTL_DAYS) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')) as StoreLot[];
    if (cached.length > 0) {
      let truncated = false;
      try { truncated = (JSON.parse(fs.readFileSync(INVENTORY_META_FILE, 'utf8')) as { truncated?: boolean }).truncated ?? false; } catch { /* pre-meta cache */ }
      log(`[scrape] reusing cached inventory (${ageDays.toFixed(1)}d old, ${cached.length} lots${truncated ? ', TRUNCATED scrape' : ''})`);
      return { lots: cached, truncated };
    }
  } catch { /* fall through to fresh scrape */ }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`\n=== BL STORE ASSESSMENT (${MODE}) — ${STORE_SLUG} ===`);

  const cdp = await connectCdp(CDP_PORT, STORE_SLUG!);
  try {
    await run(cdp);
  } finally {
    cdp.close();
  }
}

async function run(cdp: Awaited<ReturnType<typeof connectCdp>>) {
  log('[1/5] Preflight...');
  const meta = await preflight(cdp, STORE_SLUG!);
  log(`  ${meta.storeName} (${meta.country}, ID ${meta.storeId})`);
  if (!meta.isUK && !ALLOW_NON_UK) {
    console.error(`[preflight] Store country is "${meta.country}", not UK — aborting (arbitrage is UK-only; pass --allow-non-uk to override).`);
    process.exit(1);
  }

  log('[2/5] Inventory...');
  let inv = readCachedInventory();
  if (!inv) {
    inv = await scrapeStoreInventory(cdp, meta.storeId, { maxPages: MAX_PAGES, pageDelayMs: PAGE_DELAY_MS, onProgress: log });
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inv.lots, null, 2));
    fs.writeFileSync(INVENTORY_META_FILE, JSON.stringify({ truncated: inv.truncated, scrapedAt: new Date().toISOString() }, null, 2));
    log(`  scraped ${inv.lots.length} lots → inventory.json${inv.truncated ? '  ⚠ TRUNCATED' : ''}`);
  }
  const { lots, truncated } = inv;

  log('[3/5] Store profile (feedback / order rate)...');
  const profile = await scrapeStoreProfile(cdp, STORE_SLUG!, meta);
  log(`  feedback ${profile.feedbackScore ?? '—'} · ${profile.positivePct != null ? profile.positivePct + '% pos' : '—'} · ~${profile.ordersPerMonth ?? '—'}/mo`);

  // Full mode: live gap-fill UK price guides for the top uncovered high-value P/M lots.
  if (MODE === 'full') {
    log(`[4/5] Full-mode gap-fill (budget ${GAPFILL_BUDGET} tuples)...`);
    const creds = {
      consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
      consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
      tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
      tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
    };
    if (!creds.consumerKey) {
      log('  ⚠ Missing BrickLink API creds — skipping gap-fill (running as light).');
    } else {
      const bl = new BrickLinkClient(creds, { supabase, caller: 'store-assessment' });
      // Highest-value P/M tuple for each item (sets are priced from brickset elsewhere).
      const tuples = new Map<string, { itemType: 'P' | 'M'; itemNo: string; colourId: number; value: number }>();
      for (const l of lots) {
        if (l.itemType === 'S') continue;
        const key = `${l.itemType}:${l.itemNo}:${l.itemType === 'P' ? l.colourId : 0}`;
        const value = l.unitPriceGBP * l.invQty;
        const prev = tuples.get(key);
        if (!prev || value > prev.value) tuples.set(key, { itemType: l.itemType, itemNo: l.itemNo, colourId: l.colourId, value });
      }
      // Keep only those lacking fresh UK coverage, ranked by value, capped at the budget.
      const pg = await readPriceGuide(supabase, [...tuples.values()].map((t) => ({ itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId, scheme: 'bl' as const })), { ttlDays: inputs.cacheTtlDays });
      const ranked = [...tuples.values()]
        .filter((t) => pg.get(pgKey(t.itemType, t.itemNo, t.itemType === 'P' ? t.colourId : 0))?.coverage !== 'uk')
        .sort((a, b) => b.value - a.value)
        .slice(0, GAPFILL_BUDGET);
      log(`  ${ranked.length} uncovered high-value tuples to fill`);
      let filled = 0;
      for (const t of ranked) {
        try {
          await ensurePriceGuide(bl, supabase, { itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId }, { ttlDays: inputs.cacheTtlDays, scheme: 'bl' });
          filled++;
          if (filled % 20 === 0) log(`  gap-filled ${filled}/${ranked.length}`);
        } catch (e) {
          log(`  gap-fill miss ${t.itemType}:${t.itemNo}:${t.colourId} — ${(e as Error).message}`);
        }
        await sleep(GAPFILL_DELAY_MS);
      }
      log(`  gap-filled ${filled} tuples`);
    }
  }

  log(`[5/5] Scoring ${lots.length} lots...`);
  const assessment = await computeStoreAssessment(supabase, { slug: STORE_SLUG!, storeMeta: meta, lots, profile, mode: MODE, scanTruncated: truncated, inputs });
  const report = renderAssessment(assessment);

  const reportFile = path.join(OUT_DIR, `assessment-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(reportFile, report);

  if (!NO_PERSIST) {
    const userId = await resolveUserId(supabase);
    const v = assessment.verdict;
    const { error } = await supabase.from('store_assessments').insert({
      user_id: userId,
      scanned_at: assessment.scannedAt,
      store_slug: STORE_SLUG,
      store_id: meta.storeId,
      store_name: meta.storeName,
      store_country: meta.country,
      mode: MODE,
      engine_version: ENGINE_VERSION,
      scan_truncated: assessment.scanTruncated,
      grade: v.grade,
      verdict: v.label,
      total_lots: assessment.size.totalLots,
      total_pieces: assessment.size.totalPieces,
      total_value: assessment.size.totalValue,
      avg_value_per_lot: assessment.size.avgValuePerLot,
      median_ask_vs_market: assessment.pricing.weightedMedianAskVsMarket,
      buyable_lots: assessment.withinMargin.lots,
      buyable_outlay_gbp: assessment.withinMargin.outlay,
      buyable_net_gbp: assessment.withinMargin.projectedNet,
      blended_margin_pct: assessment.withinMargin.blendedMarginPct,
      high_str_lots: assessment.highStr.lots,
      magnet_lots: assessment.magnets.lots,
      feedback_score: profile.feedbackScore,
      positive_pct: profile.positivePct,
      orders_per_month: profile.ordersPerMonth,
      price_coverage: assessment.confidence.ukValueShare,
      assessment,
      report_md: report,
    });
    if (error) console.error(`[persist] failed: ${error.message}`);
    else log(`[persist] saved to store_assessments`);
  }

  if (JSON_OUT) console.log(JSON.stringify(assessment, null, 2));
  else console.log(report);
}

main().catch((e) => { console.error(e); process.exit(1); });
