/**
 * POST /api/cron/vercel-usage
 *
 * Daily Vercel usage monitoring report.
 * Fetches usage metrics, calculates RAG status, emails report,
 * and sends Discord summary to #alerts.
 *
 * Supports manual data override via POST body for when the
 * Vercel API is unavailable on Hobby plans:
 *
 * ```json
 * {
 *   "manualData": {
 *     "fluidActiveCpuSeconds": 10920,
 *     "functionInvocations": 450000,
 *     "functionDurationGbSeconds": 320,
 *     "edgeRequests": 2500000,
 *     "sourceImages": 120,
 *     "dataTransferGb": 18.5,
 *     "buildMinutes": 1200
 *   }
 * }
 * ```
 *
 * Recommended schedule: Daily at 7am UK time (Europe/London)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { vercelUsageService } from '@/lib/services/vercel-usage.service';
import type { ManualUsageData, VercelUsageReport } from '@/lib/services/vercel-usage.service';
import { emailService } from '@/lib/email/email.service';
import { discordService, DiscordColors } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import { createServiceRoleClient } from '@/lib/supabase/server';

// Human-readable per-day slope in the metric's base unit.
function formatSlope(perDay: number, unit: string): string {
  const v = Math.abs(perDay);
  if (unit === 'seconds') {
    if (v >= 3600) return `${(v / 3600).toFixed(1)}h`;
    return `${Math.round(v / 60)}m`;
  }
  if (unit === 'GB-Hrs' || unit === 'GB') return `${v.toFixed(1)} ${unit}`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

// metric.name -> scraped_metrics.key, for the trend lookup
const METRIC_KEY_BY_NAME: Record<string, string> = {
  'Fluid Active CPU': 'vercel_fluid_active_cpu',
  'Fluid Provisioned Memory': 'vercel_fluid_provisioned_memory',
  'Function Duration': 'vercel_function_duration',
  'Function Invocations': 'vercel_function_invocations',
  'Edge Requests': 'vercel_edge_requests',
  'Fast Data Transfer': 'vercel_fast_data_transfer',
};

export const runtime = 'nodejs';
export const maxDuration = 30;

const USER_EMAILS = ['chris@hadleybricks.co.uk', 'chrishadley1983@gmail.com'];

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret (skip if not set - development mode)
    const unauthorized = verifyCronAuth(request, 'VercelUsage');
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('vercel-usage', 'cron');

    console.log('[Cron VercelUsage] Starting usage report');

    // Check for manual data override in POST body
    let report: VercelUsageReport;
    let manualData: ManualUsageData | undefined;

    try {
      const body = await request.json();
      if (body?.manualData && typeof body.manualData === 'object') {
        manualData = body.manualData as ManualUsageData;
        console.log('[Cron VercelUsage] Using manual data override');
      }
    } catch {
      // No body or invalid JSON - proceed with API fetch
    }

    if (manualData) {
      report = vercelUsageService.buildReportFromManualData(manualData);
    } else {
      // fetchUsage() tries v2 API first, falls back to scraped dashboard data
      report = (await vercelUsageService.fetchUsage())!;
    }

    // Send email report
    await emailService.sendVercelUsageReport({
      userEmail: USER_EMAILS,
      report,
    });

    // Send Discord summary to #alerts
    await sendDiscordSummary(report);

    const durationMs = Date.now() - startTime;

    console.log(
      `[Cron VercelUsage] Complete: overall=${report.overallStatus}, fromApi=${report.fromApi}, duration=${durationMs}ms`
    );

    await execution.complete(
      {
        overallStatus: report.overallStatus,
        fromApi: report.fromApi,
        ...(report.apiError ? { apiError: report.apiError } : {}),
        metricsCount: report.metrics.length,
        redCount: report.metrics.filter((m) => m.status === 'RED').length,
        amberCount: report.metrics.filter((m) => m.status === 'AMBER').length,
      },
      200
    );

    return NextResponse.json({
      success: true,
      overallStatus: report.overallStatus,
      fromApi: report.fromApi,
      ...(report.apiError ? { apiError: report.apiError } : {}),
      period: report.period.formatted,
      duration: durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron VercelUsage] Error:', error);
    await execution.fail(error, 500);

    // Send failure notification to Discord
    await discordService.sendAlert({
      title: '🔴 Vercel Usage Report Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(durationMs / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        duration: durationMs,
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendDiscordSummary(report: VercelUsageReport): Promise<void> {
  const statusEmoji: Record<string, string> = { GREEN: '✅', AMBER: '🟡', RED: '🔴' };
  const colorMap: Record<string, number> = {
    GREEN: DiscordColors.GREEN,
    AMBER: DiscordColors.YELLOW,
    RED: DiscordColors.RED,
  };

  // Build description with non-GREEN metrics (or a green summary)
  let description: string;
  const nonGreenMetrics = report.metrics.filter((m) => m.status !== 'GREEN');

  if (nonGreenMetrics.length > 0) {
    description = nonGreenMetrics
      .map(
        (m) =>
          `${statusEmoji[m.status]} **${m.name}**: ${m.currentFormatted} / ${m.limitFormatted} (${m.usedPercent.toFixed(1)}%)`
      )
      .join('\n');
  } else {
    description = 'All metrics below 50% of Hobby plan limits.';
  }

  // The dashboard (and scraper) report a ROLLING 30-day window, not the
  // billing cycle — so a naive "X% of an N-day cycle" projection is wrong
  // (a rolling aggregate is already a full window). The actionable signal
  // is TREND: compare each over-limit metric to ~3 days ago. A falling
  // rolling-30d number is the real proof a change (e.g. the Jun 2026 GCP
  // cron migration) is working; it takes days to surface as old high days
  // roll off the back of the window.
  try {
    const supabase = createServiceRoleClient();
    const dayMs = 86_400_000;
    // Use the EARLIEST history point within the last 5 days as the baseline
    // (vercel_usage_history keeps one row per key per day; scraped_metrics
    // itself can't — its PK is `key` so it overwrites). Works with as little
    // as 2 days of history rather than requiring exactly a 3-day-old point.
    const windowStart = new Date(Date.now() - 5 * dayMs).toISOString().slice(0, 10);
    const trends: string[] = [];
    for (const m of nonGreenMetrics) {
      const key = METRIC_KEY_BY_NAME[m.name];
      if (!key) continue;
      // vercel_usage_history isn't in the generated Supabase types — cast.
      const { data } = await (supabase as unknown as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from: (t: string) => any;
      })
        .from('vercel_usage_history')
        .select('value, scrape_date')
        .eq('key', key)
        .gte('scrape_date', windowStart)
        .order('scrape_date', { ascending: true })
        .limit(1);
      const row = (data as Array<{ value: number | string | null; scrape_date: string }> | null)?.[0];
      const prior = row?.value != null ? Number(row.value) : null;
      const priorAt = row?.scrape_date ? new Date(row.scrape_date).getTime() : null;
      const now = m.current;
      // need a baseline at least ~1 day old to compute a slope
      if (prior == null || priorAt == null || !isFinite(prior) || prior === 0) {
        trends.push(`▪️ ${m.name}: ${m.currentFormatted} now (building trend — needs a few days of history)`);
        continue;
      }
      const daysElapsed = (Date.now() - priorAt) / dayMs;
      if (daysElapsed < 0.5) {
        trends.push(`▪️ ${m.name}: ${m.currentFormatted} now (building trend)`);
        continue;
      }

      const deltaPct = ((now - prior) / prior) * 100;
      const arrow = deltaPct > 2 ? '🔺' : deltaPct < -2 ? '🔻' : '▪️';
      const dStr = daysElapsed >= 1.5 ? `${Math.round(daysElapsed)}d` : '1d';
      let line = `${arrow} ${m.name}: ${m.currentFormatted} now (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}% vs ${dStr} ago)`;

      // Rolling-30d window: the recent per-day slope shows where it's headed.
      // Deliberately NOT a precise ETA — a 2-point slope over a few days is
      // a direction, not a forecast — so phrase it as "trending under limit
      // in roughly N days".
      const slopePerDay = (now - prior) / daysElapsed; // signed
      if (slopePerDay < -1e-9) {
        const overLimit = m.current - m.limit;
        if (overLimit > 0) {
          const weeks = overLimit / -slopePerDay / 7;
          const when = weeks < 1 ? 'within ~a week' : `in roughly ${Math.round(weeks)} week(s)`;
          line += `\n   → falling ~${formatSlope(slopePerDay, m.unit)}/day; on current trend, under limit ${when}`;
        } else {
          line += `\n   → falling ~${formatSlope(slopePerDay, m.unit)}/day`;
        }
      } else {
        line += `\n   → not yet falling — migration effect surfaces as pre-change days roll off (~5d)`;
      }
      trends.push(line);
    }
    if (trends.length > 0) {
      description += '\n\nRolling-30d window — actual + trend:\n' + trends.join('\n');
    }
  } catch {
    // trend is best-effort context, never block the report
  }

  description += `\n\nRolling 30-day window (vs Hobby per-cycle limits)`;
  if (!report.fromApi) {
    description += '\n_Data: manual input (API unavailable)_';
  }

  await discordService.send('alerts', {
    title: `${statusEmoji[report.overallStatus]} Vercel Usage Report`,
    description,
    color: colorMap[report.overallStatus],
  });
}
