/**
 * store-report.ts — THE standard BL store decision report, rendered from
 * persisted data. No Chrome, no scraping, no API calls: reads the stored scrape
 * (bl_store_scrapes) and the price caches, re-scores with the current engine,
 * and renders the common decision report (lib/bl-store-report) to the terminal
 * plus a full markdown file.
 *
 * This is the sanctioned entry point for CONVERSATIONAL store queries ("show me
 * the store table for X", "magnets in X", "what's liquid in X") — never
 * improvise a table in chat when this can render it.
 *
 * Usage:
 *   npx tsx scripts/store-report.ts --slug=<store>
 *     [--min-str=0.5] [--magnets] [--no-dups]      view filters (table only)
 *     [--postage=3.00]                              inbound postage for the standalone maths
 *     [--min-margin=0.20] [--pricing-lens=grounded|estimate|auto]
 *     [--from-assessment]   render from the latest persisted store_assessments row
 *                           (partial top-N rows) instead of re-scoring the scrape
 *     [--max-rows=40] [--json] [--md-only]
 *
 * Falls back to the persisted assessment automatically when no stored scrape
 * exists (flagged PARTIAL ROWS in the output).
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { computeStoreAssessmentWithLots } from '../src/lib/bl-store-assessment/engine';
import type { StoreAssessment, StoreLot, ScoredLot } from '../src/lib/bl-store-assessment/types';
import {
  buildDecisionReport, renderDecisionCli, renderDecisionMd, type BuildOptions,
} from '../src/lib/bl-store-report';
import { DEFAULT_INBOUND_POSTAGE_GBP } from '../src/lib/bricklink/fees';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const SLUG = argv['slug'] ?? argv['store-slug'];
if (!SLUG) { console.error('Required: --slug=<store>'); process.exit(1); }
const FROM_ASSESSMENT = argv['from-assessment'] === 'true';
const JSON_OUT = argv['json'] === 'true';
const MD_ONLY = argv['md-only'] === 'true';
const MAX_ROWS = parseInt(argv['max-rows'] ?? '40', 10);

const buildOpts: BuildOptions = {
  inboundPostage: parseFloat(argv['postage'] ?? String(DEFAULT_INBOUND_POSTAGE_GBP)),
  minStr: argv['min-str'] != null ? parseFloat(argv['min-str']) : undefined,
  magnetsOnly: argv['magnets'] === 'true',
  excludeDups: argv['no-dups'] === 'true',
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env (.env.local)'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

/** Flag → env → sole Bricqer snapshot owner (mirrors store-assessment.ts). */
async function resolveUserId(): Promise<string | null> {
  const fromArgs = argv['user-id'] ?? process.env.STORE_ASSESSMENT_USER_ID;
  if (fromArgs) return fromArgs;
  const res = await supabase.from('bricqer_inventory_snapshot').select('user_id').limit(1000);
  if (res.error) return null;
  const owners = [...new Set((res.data ?? []).map((r) => r.user_id as string))];
  return owners.length === 1 ? owners[0] : null;
}

interface AssessmentRow {
  scanned_at: string;
  store_id: number | null;
  store_name: string | null;
  store_country: string | null;
  assessment: StoreAssessment;
}

async function latestAssessment(): Promise<AssessmentRow | null> {
  const { data, error } = await supabase
    .from('store_assessments')
    .select('scanned_at,store_id,store_name,store_country,assessment')
    .eq('store_slug', SLUG)
    .order('scanned_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`store_assessments read failed: ${error.message}`);
  return (data?.[0] as AssessmentRow | undefined) ?? null;
}

async function main() {
  let assessment: StoreAssessment | null = null;
  let scoredLots: ScoredLot[] | undefined;

  const persisted = await latestAssessment();

  if (!FROM_ASSESSMENT) {
    const { data, error } = await supabase
      .from('bl_store_scrapes')
      .select('store_id,scanned_at,truncated,lots')
      .eq('store_slug', SLUG)
      .limit(1);
    if (error) throw new Error(`bl_store_scrapes read failed: ${error.message}`);
    const scrape = data?.[0] as { store_id: number | null; scanned_at: string; truncated: boolean; lots: StoreLot[] } | undefined;
    if (scrape) {
      console.error(`[store-report] re-scoring stored scrape (${scrape.lots.length} lots, scanned ${scrape.scanned_at.slice(0, 10)}) with current engine…`);
      const userId = await resolveUserId();
      if (!userId) console.error('[store-report] ⚠ no resolvable user id — overlap tags disabled');
      const r = await computeStoreAssessmentWithLots(supabase, {
        slug: SLUG,
        storeMeta: {
          storeId: scrape.store_id ?? persisted?.store_id ?? null,
          storeName: persisted?.store_name ?? null,
          country: persisted?.store_country ?? null,
        },
        lots: scrape.lots,
        profile: persisted?.assessment?.feedback ?? null,
        mode: 'light',
        scanTruncated: scrape.truncated,
        userId,
        scannedAt: scrape.scanned_at,
        // Only set keys explicitly given — an `undefined` value would override the
        // engine's DEFAULT_INPUTS spread.
        inputs: {
          ...(argv['min-margin'] != null ? { minMargin: parseFloat(argv['min-margin']) } : {}),
          // Default = grounded UK-only (Chris 2026-07-21: the full assessment uses UK
          // prices; world is an explicit opt-in, never the silent default). `--pricing-lens=auto`
          // restores the old "grounded once ≥95% checked" behaviour.
          ...(argv['pricing-lens'] === 'estimate' ? { ukGroundedOnly: false }
            : argv['pricing-lens'] === 'auto' ? {} : { ukGroundedOnly: true }),
        },
      });
      assessment = r.assessment;
      scoredLots = r.scoredLots;
    }
  }

  if (!assessment) {
    if (!persisted) {
      console.error(`[store-report] no stored scrape OR assessment for "${SLUG}" — run store-assessment.ts (or bl-basket) first.`);
      process.exit(1);
    }
    console.error(`[store-report] no stored scrape — rendering persisted assessment from ${persisted.scanned_at.slice(0, 10)} (PARTIAL rows)`);
    assessment = persisted.assessment;
  }

  const report = buildDecisionReport(assessment, buildOpts, scoredLots);

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }

  const outDir = path.resolve(__dirname, `../../../tmp/stores/${SLUG}`);
  fs.mkdirSync(outDir, { recursive: true });
  const mdFile = path.join(outDir, `store-report-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(mdFile, renderDecisionMd(report));

  if (!MD_ONLY) console.log(renderDecisionCli(report, { maxRows: MAX_ROWS }));
  console.error(`[store-report] full markdown → ${mdFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
