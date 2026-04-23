/**
 * POST /api/cron/bricqer-sync-status
 *
 * Daily external-inventory sync report. Fetches Bricqer's per-marketplace
 * sync status (undocumented GET /api/v1/inventory/problems/ endpoint that
 * backs the "Check external inventory" UI dialog), filters to BrickLink and
 * BrickOwl, and sends both a Discord embed to #sync-status and an email.
 *
 * Recommended schedule: Daily at 07:35 Europe/London
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { BricqerClient } from '@/lib/bricqer/client';
import type { BricqerCredentials, BricqerInventoryProblem } from '@/lib/bricqer/types';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';
import { discordService, DiscordColors } from '@/lib/notifications';
import { emailService } from '@/lib/email/email.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TARGET_PROVIDERS = ['BrickLink', 'BrickOwl'] as const;
const USER_EMAIL = 'chris@hadleybricks.co.uk';

function formatChecked(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function handler(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron BricqerSyncStatus] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('bricqer-sync-status', 'cron');

    const supabase = createServiceRoleClient();
    const credRepo = new CredentialsRepository(supabase);
    const creds = await credRepo.getCredentials<BricqerCredentials>(DEFAULT_USER_ID, 'bricqer');
    if (!creds) {
      throw new Error('Bricqer credentials not configured');
    }

    const client = new BricqerClient(creds);
    const all = await client.getInventoryProblems();

    const rows: BricqerInventoryProblem[] = TARGET_PROVIDERS.map((p) =>
      all.find((r) => r.provider === p)
    ).filter((r): r is BricqerInventoryProblem => r !== undefined);

    const missing = TARGET_PROVIDERS.filter((p) => !rows.find((r) => r.provider === p));
    if (missing.length > 0) {
      throw new Error(`Bricqer response missing providers: ${missing.join(', ')}`);
    }

    const totalProblems = rows.reduce((s, r) => s + r.problems, 0);
    const hasProblems = totalProblems > 0;

    await discordService.send('sync-status', {
      title: 'Bricqer external inventory — sync status',
      color: hasProblems ? DiscordColors.RED : DiscordColors.GREEN,
      fields: rows.map((r) => ({
        name: r.provider,
        value: `**${r.problems === 0 ? 'In sync' : `${r.problems} problem${r.problems === 1 ? '' : 's'}`}**\nChecked ${formatChecked(r.lastChecked)}`,
        inline: true,
      })),
    });

    await emailService.sendBricqerSyncStatus({
      userEmail: USER_EMAIL,
      rows,
    });

    const durationMs = Date.now() - startTime;
    console.log(
      `[Cron BricqerSyncStatus] Complete: totalProblems=${totalProblems}, duration=${durationMs}ms`
    );

    await execution.complete(
      {
        providers: rows.map((r) => ({
          provider: r.provider,
          problems: r.problems,
          lastChecked: r.lastChecked,
        })),
        totalProblems,
      },
      200
    );

    return NextResponse.json({
      success: true,
      totalProblems,
      rows,
      duration: durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron BricqerSyncStatus] Error:', error);
    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: '🔴 Bricqer sync-status report failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(durationMs / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      { success: false, error: errorMsg, duration: durationMs },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handler(request);
}

// Support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return handler(request);
}
