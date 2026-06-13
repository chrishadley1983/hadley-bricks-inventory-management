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
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const trends: string[] = [];
    for (const m of nonGreenMetrics) {
      const key = METRIC_KEY_BY_NAME[m.name];
      if (!key) continue;
      const { data } = await supabase
        .from('scraped_metrics')
        .select('value, scraped_at')
        .eq('key', key)
        .lte('scraped_at', threeDaysAgo)
        .order('scraped_at', { ascending: false })
        .limit(1);
      const prior = data?.[0]?.value != null ? Number(data[0].value) : null;
      const now = m.current;
      if (prior == null || !isFinite(prior) || prior === 0) continue;
      const deltaPct = ((now - prior) / prior) * 100;
      const arrow = deltaPct > 2 ? '🔺' : deltaPct < -2 ? '🔻' : '▪️';
      trends.push(`${arrow} ${m.name}: ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}% vs 3d ago`);
    }
    if (trends.length > 0) {
      description += '\n\n3-day trend (rolling-30d window):\n' + trends.join('\n');
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
