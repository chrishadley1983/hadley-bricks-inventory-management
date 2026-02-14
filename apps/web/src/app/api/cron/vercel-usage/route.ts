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
import { vercelUsageService } from '@/lib/services/vercel-usage.service';
import type { ManualUsageData, VercelUsageReport } from '@/lib/services/vercel-usage.service';
import { emailService } from '@/lib/email/email.service';
import { discordService, DiscordColors } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 30;

const USER_EMAIL = 'chris@hadleybricks.co.uk';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret (skip if not set - development mode)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron VercelUsage] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      userEmail: USER_EMAIL,
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

  description += `\n\nPeriod: ${report.period.formatted}`;
  if (!report.fromApi) {
    description += '\n_Data: manual input (API unavailable)_';
  }

  await discordService.send('alerts', {
    title: `${statusEmoji[report.overallStatus]} Vercel Usage Report`,
    description,
    color: colorMap[report.overallStatus],
  });
}
