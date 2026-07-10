/**
 * POST /api/cron/pov-freshness-report
 *
 * Daily health report for the BrickLink Part-Out-Value freshness mechanism. Pure read +
 * notify — it does NOT scrape (that's the local, CDP-bound pov-refresh.ts job). This runs on
 * Vercel because that's where the Discord webhooks live; it reads the same
 * `bricklink_pov_refresh_status` view + `pov_refresh_runs` audit log the refresh job writes.
 *
 * Posts a concise daily summary to #daily-summary (freshness % by tier, backlog trend, last-run
 * throughput vs budget, recoveries, no-data composition, cliff radar), and escalates to #alerts
 * ONLY when something needs attention (job missed, a projected due-day over budget, an undrainable
 * backlog, or a stopped-early / errored run) — quiet-by-design, like the Peter heartbeat.
 *
 * Schedule via GCP Cloud Scheduler (Bearer CRON_SECRET) at ~08:00 UK, AFTER the local 03:00 refresh:
 *   gcloud scheduler jobs create http pov-freshness-report --location=europe-west2 \
 *     --schedule="0 8 * * *" --time-zone="Europe/London" --http-method=POST \
 *     --uri="https://hadley-bricks-inventory-management.vercel.app/api/cron/pov-freshness-report" \
 *     --headers="Authorization=Bearer $CRON_SECRET"
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import type { DiscordEmbedField } from '@/lib/notifications/discord.service';
import type { PovRefreshRun } from '@hadley-bricks/database';

export const runtime = 'nodejs';
export const maxDuration = 60;

const JOB_MISSED_HOURS = 36; // local refresh runs daily; >36h since last run = missed

interface TierStat {
  tier: number;
  total: number;
  fresh: number;
  stale: number;
}
interface FreshnessReport {
  generated_at: string;
  budget: number;
  total: number;
  stale: number;
  backed_off: number;
  tiers: TierStat[];
  no_data: { not_partable: number; no_sales_yet: number; unclassified_empty: number };
  cliff: { peak_day_count: number; peak_day: string | null; days_over_budget: number };
}

const TIER_LABEL: Record<number, string> = { 1: '<1yr', 2: '1–3yr', 3: '>3yr' };
const pct = (fresh: number, total: number) => (total > 0 ? ((fresh / total) * 100).toFixed(1) : '—');
const n = (x: number) => x.toLocaleString('en-GB');
const fmtDelta = (d: number | null) => (d == null ? '' : d === 0 ? ' (no change)' : d > 0 ? ` (▲${n(d)})` : ` (▼${n(-d)})`);

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('pov-freshness-report', 'cron');
    const supabase = createServiceRoleClient();

    // 1) Aggregate freshness snapshot (single round trip, computed in SQL).
    const { data: reportData, error: reportErr } = await supabase.rpc('get_pov_freshness_report');
    if (reportErr) throw new Error(`freshness RPC failed: ${reportErr.message}`);
    const report = reportData as unknown as FreshnessReport;

    // 2) Latest two refresh runs — for run-over-run backlog trend + job-missed detection.
    const { data: runsData, error: runsErr } = await supabase
      .from('pov_refresh_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(2);
    if (runsErr) throw new Error(`runs query failed: ${runsErr.message}`);
    const runs = (runsData ?? []) as PovRefreshRun[];
    const latest = runs[0] ?? null;
    const prev = runs[1] ?? null;

    // 3) Health signals.
    const hoursSinceRun = latest ? (Date.now() - new Date(latest.started_at).getTime()) / 3_600_000 : Infinity;
    const jobMissed = hoursSinceRun > JOB_MISSED_HOURS;
    const cliffBreach = report.cliff.days_over_budget > 0;
    const undrainable = report.stale > report.budget; // can't clear in a single budgeted day
    const runFailed = !!latest && (latest.stopped_early || (latest.errors ?? 0) > 0);
    const healthy = !jobMissed && !cliffBreach && !undrainable && !runFailed;

    const backlogTrend =
      latest?.backlog_after != null && prev?.backlog_after != null ? latest.backlog_after - prev.backlog_after : null;

    // 4) Daily summary fields.
    const tiers = [...report.tiers].sort((a, b) => a.tier - b.tier);
    const freshnessValue =
      tiers.map((t) => `${TIER_LABEL[t.tier] ?? `tier${t.tier}`}: ${pct(t.fresh, t.total)}% (${n(t.fresh)}/${n(t.total)})`).join('\n') ||
      '—';

    const lastRunValue = latest
      ? `${n(latest.refreshed)} refreshed / ${n(latest.attempted)} tried · budget ${n(latest.budget)}` +
        `${latest.breathers ? ` · ${latest.breathers} breather(s)` : ''}` +
        `${latest.duration_ms != null ? ` · ${Math.round(latest.duration_ms / 60000)}m` : ''}` +
        `${latest.stopped_early ? `\n⛔ stopped early: ${latest.stop_reason ?? 'unknown'}` : ''}` +
        `\n${hoursSinceRun < 1 ? '<1' : Math.round(hoursSinceRun)}h ago`
      : '⚠️ no refresh run recorded yet';

    const nd = report.no_data;
    const cliffValue =
      `peak ${n(report.cliff.peak_day_count)}/day` +
      `${report.cliff.peak_day ? ` on ${report.cliff.peak_day}` : ''} · budget ${n(report.budget)} · ` +
      (cliffBreach ? `⚠️ ${report.cliff.days_over_budget} day(s) over budget` : '✅ within budget');

    const fields: DiscordEmbedField[] = [
      { name: '🟢 Freshness by age tier', value: freshnessValue, inline: false },
      {
        name: '📦 Backlog (stale)',
        value: `${n(report.stale)} of ${n(report.total)}${fmtDelta(backlogTrend)} · ${n(report.backed_off)} backed-off`,
        inline: true,
      },
      {
        name: '🔁 Last run',
        value: lastRunValue,
        inline: true,
      },
      {
        name: '♻️ Changes (last run)',
        value: latest ? `${n(latest.recoveries)} recovered · ${n(latest.newly_empty)} newly-empty` : '—',
        inline: true,
      },
      {
        name: '🚫 No-data composition',
        value: `not-partable ${n(nd.not_partable)} · no-sales-yet ${n(nd.no_sales_yet)} · unclassified ${n(nd.unclassified_empty)}`,
        inline: false,
      },
      { name: '🪜 Cliff radar (280d)', value: cliffValue, inline: false },
    ];

    await discordService.sendDailySummary({
      title: `${healthy ? '✅' : '⚠️'} POV freshness — ${healthy ? 'healthy' : 'needs attention'}`,
      fields,
    });

    // 5) Escalate only real problems to #alerts (quiet-by-design).
    const problems: string[] = [];
    if (jobMissed) {
      problems.push(
        latest
          ? `Refresh job appears to have missed: last run ${Math.round(hoursSinceRun)}h ago (>${JOB_MISSED_HOURS}h). Is the CDP Chrome / scheduled task up?`
          : 'No POV refresh run has ever been recorded — the local scheduled task may not be registered.',
      );
    }
    if (cliffBreach)
      problems.push(
        `Cliff radar: ${report.cliff.days_over_budget} projected day(s) exceed the ${n(report.budget)}/day budget (peak ${n(
          report.cliff.peak_day_count,
        )} on ${report.cliff.peak_day}). Consider raising the budget or jitter spread.`,
      );
    if (undrainable)
      problems.push(`Backlog ${n(report.stale)} exceeds the ${n(report.budget)}/day budget — it cannot drain in one day.`);
    if (runFailed)
      problems.push(
        `Last refresh run had issues: ${latest?.errors ?? 0} error(s)${latest?.stopped_early ? `, stopped early (${latest?.stop_reason ?? 'unknown'})` : ''}.`,
      );

    if (problems.length > 0) {
      await discordService.sendAlert({
        title: '⚠️ POV freshness needs attention',
        message: problems.map((p) => `• ${p}`).join('\n'),
        priority: 'high',
      });
    }

    await execution.complete({ healthy, stale: report.stale, problems: problems.length }, 200, report.total, problems.length);

    return NextResponse.json({ success: true, healthy, report, latestRun: latest, backlogTrend, problems });
  } catch (error) {
    console.error('[Cron POV Freshness Report] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
}

// Manual testing (same auth).
export async function GET(request: NextRequest) {
  return POST(request);
}
