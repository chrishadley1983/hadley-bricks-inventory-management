/**
 * PG Market Intelligence — weekly digest (spec §5.3, done-criteria F5).
 *
 * Composes:
 *   - Top-10 STR risers/fallers from pg_screen_trend_movers (combined sold6m qty delta).
 *   - Top-10 fig-radar movers (same view, item_type='M').
 *   - Coverage/freshness health: L1 total, active-tier size + % refreshed within the
 *     28-day cycle, tuples past next_due_at, and the last-7-days lane telemetry
 *     (requests/ok/fail + a first-block-position trend summary) per lane.
 *   - If a tmp/pg-reports/own-store-audit-*.md report exists from the last 7 days, its
 *     top-5 lines per section (most recent report wins if more than one).
 *
 * Output: markdown to tmp/pg-reports/digest-<date>.md AND a Discord post via
 * discordService.sendPgDigest (daily-summary channel; embed description truncated at
 * Discord's 4096-char limit — see discord.service.ts).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-digest.ts [--no-discord]
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  discordService,
  type PgDigestMoverRow,
  type PgDigestLaneTelemetry,
  type PgDigestReportExcerpt,
} from '../../src/lib/notifications/discord.service';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const NO_DISCORD = argv['no-discord'] === 'true';

// This file lives at apps/web/scripts/pg/ -> 4 levels up to repo root.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REPORT_DIR = path.join(REPO_ROOT, 'tmp/pg-reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_FILE = argv['out'] ?? path.join(REPORT_DIR, `digest-${REPORT_DATE}.md`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-digest] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const PAGE = 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000;

function tupleLabel(r: { item_type: string; item_no: string; colour_id: number }): string {
  return r.item_type === 'P' ? `${r.item_type} ${r.item_no} c${r.colour_id}` : `${r.item_type} ${r.item_no}`;
}

// ---------------------------------------------------------------------------
// Trend movers (STR risers/fallers + fig radar movers)
// ---------------------------------------------------------------------------

interface TrendRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  new_qty_delta: number;
  used_qty_delta: number;
  latest_str_new: number | null;
  latest_str_used: number | null;
}

async function loadTrendMovers(): Promise<{ risers: PgDigestMoverRow[]; fallers: PgDigestMoverRow[]; figMovers: PgDigestMoverRow[] }> {
  const rows: TrendRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('pg_screen_trend_movers')
      .select('item_type,item_no,colour_id,new_qty_delta,used_qty_delta,latest_str_new,latest_str_used')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`pg_screen_trend_movers read failed: ${error.message}`);
    const batch = (data ?? []) as TrendRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const toMover = (r: TrendRow): PgDigestMoverRow & { qtyDeltaSort: number } => ({
    label: tupleLabel(r),
    qtyDelta: (r.new_qty_delta ?? 0) + (r.used_qty_delta ?? 0),
    latestStrNew: r.latest_str_new,
    latestStrUsed: r.latest_str_used,
    qtyDeltaSort: (r.new_qty_delta ?? 0) + (r.used_qty_delta ?? 0),
  });

  const all = rows.map(toMover);
  const risers = [...all].sort((a, b) => b.qtyDeltaSort - a.qtyDeltaSort).slice(0, 10);
  const fallers = [...all].sort((a, b) => a.qtyDeltaSort - b.qtyDeltaSort).slice(0, 10);
  const figMovers = rows
    .filter((r) => r.item_type === 'M')
    .map(toMover)
    .sort((a, b) => Math.abs(b.qtyDeltaSort) - Math.abs(a.qtyDeltaSort))
    .slice(0, 10);

  return { risers, fallers, figMovers };
}

// ---------------------------------------------------------------------------
// Quarterly UK↔worldwide divergence re-run reminder (spec §4.6/§7.4).
// Bump NEXT_DIVERGENCE_DUE after each re-run — the study itself is one SQL query
// over L2/L3 comparing uk vs world sold averages on shared tuples.
const NEXT_DIVERGENCE_DUE = '2026-10-01';
function divergenceReminderLines(): string[] {
  if (new Date().toISOString().slice(0, 10) < NEXT_DIVERGENCE_DUE) return [];
  return [
    `## ⚠ Quarterly divergence re-run DUE (scheduled ${NEXT_DIVERGENCE_DUE})`,
    '',
    '- Re-run the UK↔worldwide divergence study (spec §7.4) and bump NEXT_DIVERGENCE_DUE in pg-digest.ts.',
    '',
  ];
}

// Coverage / freshness health
// ---------------------------------------------------------------------------

async function countL1Total(): Promise<number> {
  const { count, error } = await supabase.from('bricklink_pg_summary_cache').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count(bricklink_pg_summary_cache) failed: ${error.message}`);
  return count ?? 0;
}

async function countActiveTier(): Promise<number> {
  const { count, error } = await supabase
    .from('bl_pg_refresh_queue')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'active');
  if (error) throw new Error(`count(bl_pg_refresh_queue, active) failed: ${error.message}`);
  return count ?? 0;
}

async function countActiveWithin28d(cutoffIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('bl_pg_refresh_queue')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'active')
    .gte('last_refreshed_at', cutoffIso);
  if (error) throw new Error(`count(bl_pg_refresh_queue, active within 28d) failed: ${error.message}`);
  return count ?? 0;
}

async function countPastDue(nowIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('bl_pg_refresh_queue')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'active')
    .lt('next_due_at', nowIso);
  if (error) throw new Error(`count(bl_pg_refresh_queue, past due) failed: ${error.message}`);
  return count ?? 0;
}

interface TelemetryRow {
  lane: string;
  requests: number;
  ok: number;
  failed: number;
  first_block_at_request: number | null;
  started_at: string;
}

function summariseFirstBlockTrend(readings: number[]): string {
  if (readings.length === 0) return 'no blocks observed';
  if (readings.length === 1) return `single reading ${readings[0]}`;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
  const spread = Math.max(...readings) - Math.min(...readings);
  if (spread <= avg * 0.15) return `flat ~${Math.round(avg)}`;
  const direction = last < first ? 'tightening' : 'loosening';
  return `${direction} ${first}→${last}`;
}

async function loadCoverageHealth(): Promise<{
  l1Total: number;
  activeTierCount: number;
  activeWithin28dPct: number;
  pastDueCount: number;
  laneTelemetry: PgDigestLaneTelemetry[];
}> {
  const nowIso = new Date().toISOString();
  const cutoff28d = new Date(Date.now() - TWENTY_EIGHT_DAYS_MS).toISOString();

  const [l1Total, activeTierCount, activeWithin28d, pastDueCount] = await Promise.all([
    countL1Total(),
    countActiveTier(),
    countActiveWithin28d(cutoff28d),
    countPastDue(nowIso),
  ]);

  const activeWithin28dPct = activeTierCount > 0 ? (activeWithin28d / activeTierCount) * 100 : 0;

  // Lane telemetry, last 7 days.
  const cutoff7dDate = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);
  const telemetryRows: TelemetryRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('bl_pg_lane_telemetry')
      .select('lane,requests,ok,failed,first_block_at_request,started_at')
      .gte('run_date', cutoff7dDate)
      .order('started_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`bl_pg_lane_telemetry read failed: ${error.message}`);
    const batch = (data ?? []) as TelemetryRow[];
    telemetryRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const byLane = new Map<string, TelemetryRow[]>();
  for (const r of telemetryRows) {
    if (!byLane.has(r.lane)) byLane.set(r.lane, []);
    byLane.get(r.lane)!.push(r);
  }

  const laneTelemetry: PgDigestLaneTelemetry[] = [...byLane.entries()].map(([lane, sessions]) => {
    const requests7d = sessions.reduce((a, s) => a + (s.requests ?? 0), 0);
    const ok7d = sessions.reduce((a, s) => a + (s.ok ?? 0), 0);
    const failed7d = sessions.reduce((a, s) => a + (s.failed ?? 0), 0);
    const readings = sessions.map((s) => s.first_block_at_request).filter((v): v is number => v != null);
    return { lane, requests7d, ok7d, failed7d, firstBlockTrend: summariseFirstBlockTrend(readings) };
  });

  return { l1Total, activeTierCount, activeWithin28dPct, pastDueCount, laneTelemetry };
}

// ---------------------------------------------------------------------------
// Own-store audit excerpt (most recent own-store-audit-*.md within the last 7 days)
// ---------------------------------------------------------------------------

function findRecentOwnStoreAudit(): { filePath: string; mtime: Date } | null {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const files = fs
    .readdirSync(REPORT_DIR)
    .filter((f) => /^own-store-audit-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => {
      const filePath = path.join(REPORT_DIR, f);
      return { filePath, mtime: fs.statSync(filePath).mtime };
    })
    .filter((f) => Date.now() - f.mtime.getTime() <= SEVEN_DAYS_MS)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return files[0] ?? null;
}

/** Top-5 non-blank lines following each "## " section header. */
function extractSectionExcerpts(markdown: string): PgDigestReportExcerpt[] {
  const lines = markdown.split(/\r?\n/);
  const excerpts: PgDigestReportExcerpt[] = [];
  let current: PgDigestReportExcerpt | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) excerpts.push(current);
      current = { title: line.replace(/^##\s+/, '').trim(), lines: [] };
      continue;
    }
    if (line.startsWith('# ')) continue; // top-level report title
    if (current && current.lines.length < 5 && line.trim().length > 0) {
      current.lines.push(line.trim());
    }
  }
  if (current) excerpts.push(current);
  return excerpts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[pg-digest] starting');

  const [{ risers, fallers, figMovers }, coverage] = await Promise.all([loadTrendMovers(), loadCoverageHealth()]);
  console.log(`[pg-digest] trend movers: ${risers.length} risers, ${fallers.length} fallers, ${figMovers.length} fig movers`);
  console.log(`[pg-digest] coverage: L1=${coverage.l1Total} active=${coverage.activeTierCount} within28d=${coverage.activeWithin28dPct.toFixed(1)}% pastDue=${coverage.pastDueCount}`);

  const recentAudit = findRecentOwnStoreAudit();
  let ownStoreAuditExcerpts: PgDigestReportExcerpt[] = [];
  if (recentAudit) {
    console.log(`[pg-digest] own-store audit found: ${recentAudit.filePath} (${((Date.now() - recentAudit.mtime.getTime()) / 3600000).toFixed(1)}h old)`);
    const markdown = fs.readFileSync(recentAudit.filePath, 'utf8');
    ownStoreAuditExcerpts = extractSectionExcerpts(markdown);
  } else {
    console.log('[pg-digest] no own-store-audit-*.md report from the last 7 days');
  }

  // ---- Markdown report ----
  const moverLine = (m: PgDigestMoverRow) => `- **${m.label}**: ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta} qty (STR ${m.latestStrNew?.toFixed(2) ?? '—'}/${m.latestStrUsed?.toFixed(2) ?? '—'})`;

  const md: string[] = [
    `# PG weekly market digest — ${REPORT_DATE}`,
    '',
    '## STR risers (top 10)',
    '',
    ...(risers.length > 0 ? risers.map(moverLine) : ['_None this week._']),
    '',
    '## STR fallers (top 10)',
    '',
    ...(fallers.length > 0 ? fallers.map(moverLine) : ['_None this week._']),
    '',
    '## Fig radar movers (top 10)',
    '',
    ...(figMovers.length > 0 ? figMovers.map(moverLine) : ['_None this week._']),
    '',
    '## Coverage & freshness health',
    '',
    `- L1 total: **${coverage.l1Total.toLocaleString()}**`,
    `- Active tier: **${coverage.activeTierCount.toLocaleString()}**`,
    `- Within 28-day cycle: **${coverage.activeWithin28dPct.toFixed(1)}%**`,
    `- Past due (next_due_at elapsed): **${coverage.pastDueCount.toLocaleString()}**`,
    '',
    '### Lane telemetry (last 7 days)',
    '',
    ...(coverage.laneTelemetry.length > 0
      ? coverage.laneTelemetry.map((l) => `- **${l.lane}**: ${l.requests7d} req, ${l.ok7d} ok / ${l.failed7d} failed — first-403 trend: ${l.firstBlockTrend}`)
      : ['_No telemetry rows in the last 7 days._']),
    '',
    ...divergenceReminderLines(),
    '## Own-store audit (most recent, last 7 days)',
    '',
    ...(ownStoreAuditExcerpts.length > 0
      ? ownStoreAuditExcerpts.flatMap((e) => [`### ${e.title}`, '', ...(e.lines.length > 0 ? e.lines : ['_None._']), ''])
      : ['_No own-store-audit-*.md report from the last 7 days._']),
  ];

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, md.join('\n'));
  console.log(`[pg-digest] report written: ${REPORT_FILE}`);

  if (!NO_DISCORD) {
    const result = await discordService.sendPgDigest({
      runDate: REPORT_DATE,
      strRisers: risers,
      strFallers: fallers,
      figMovers,
      coverage,
      ownStoreAuditExcerpts,
      reportPath: path.relative(REPO_ROOT, REPORT_FILE),
    });
    if (!result.success) console.error(`[pg-digest] Discord send failed: ${result.error}`);
    else console.log('[pg-digest] Discord digest sent (or channel not configured — silent skip)');
  } else {
    console.log('[pg-digest] --no-discord — skipping Discord send');
  }

  await persistReport(REPORT_DATE, {
    risersCount: risers.length,
    fallersCount: fallers.length,
    figMoversCount: figMovers.length,
    l1Total: coverage.l1Total,
    activeTierCount: coverage.activeTierCount,
    activeWithin28dPct: coverage.activeWithin28dPct,
    pastDueCount: coverage.pastDueCount,
  }, md.join('\n'));

  console.log('[pg-digest] done');
}

// ---------------------------------------------------------------------------
// BrickRadar UI persistence (spec §5.1): mirror bl-pg-store-scan.ts's
// persistScanReport — non-fatal (runs whether or not the Discord send
// succeeded), so a Supabase hiccup never fails the digest run.
// ---------------------------------------------------------------------------

interface DigestSummary {
  risersCount: number;
  fallersCount: number;
  figMoversCount: number;
  l1Total: number;
  activeTierCount: number;
  activeWithin28dPct: number;
  pastDueCount: number;
}

async function persistReport(subject: string, summary: DigestSummary, md: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('bl_pg_reports').insert({
      kind: 'digest',
      subject,
      summary,
      report_md: md,
    });
    if (error) console.warn(`  ⚠ bl_pg_reports insert failed: ${error.message}`);
  } catch (err) {
    console.warn(`  ⚠ bl_pg_reports insert failed: ${(err as Error).message}`);
  }
}

main().catch((e) => {
  console.error('[pg-digest] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
