/**
 * POST /api/cron/discord-health
 *
 * Daily dead-man check for the Discord alerting pipeline itself. Born from the
 * 2026-07-10..14 outage where a stale service env silently dropped every eBay
 * opportunity alert for four days while all run logs reported success.
 *
 * Checks:
 * 1. Required DISCORD_WEBHOOK_* env vars are present in the running process
 *    (catches stale-env-after-restart drift).
 * 2. Each configured webhook still exists on Discord's side — a GET on a
 *    webhook URL needs no auth and 404s when it has been deleted in Discord
 *    (this is how the dead daily-summary webhook went unnoticed).
 * 3. No eBay alert rows (auction + BIN share ebay_auction_alerts) are stuck
 *    with discord_sent=false — persistent stuck rows mean deliveries are
 *    failing even though the env looks healthy.
 *
 * Problems are posted to #alerts and always returned in the response so the
 * local runner exits non-zero even when #alerts itself is the broken webhook.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

/** Env vars that must be present and resolve to a live webhook. */
const REQUIRED_WEBHOOKS = [
  'DISCORD_WEBHOOK_ALERTS',
  'DISCORD_WEBHOOK_OPPORTUNITIES',
  'DISCORD_WEBHOOK_SYNC_STATUS',
  'DISCORD_WEBHOOK_DAILY_SUMMARY',
  'DISCORD_WEBHOOK_STORE_ASSESSMENT',
] as const;

/** Env vars that are optional, but must resolve to a live webhook when set. */
const OPTIONAL_WEBHOOKS = ['DISCORD_WEBHOOK_PETER_CHAT'] as const;

async function checkWebhookExists(envName: string, url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    // Unauthenticated GET on a webhook URL returns its metadata while it
    // exists and 404 once deleted in Discord — no message is posted.
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      return `${envName}: webhook dead on Discord's side (HTTP ${response.status} — deleted or invalid)`;
    }
    return null;
  } catch (err) {
    return `${envName}: webhook unreachable (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  const unauthorized = verifyCronAuth(request, 'DiscordHealth');
  if (unauthorized) return unauthorized;

  const problems: string[] = [];
  let webhooksChecked = 0;

  for (const envName of REQUIRED_WEBHOOKS) {
    const url = process.env[envName];
    if (!url) {
      problems.push(`${envName}: MISSING from the running process env (stale service env? restart after fixing .env.local)`);
      continue;
    }
    webhooksChecked++;
    const problem = await checkWebhookExists(envName, url);
    if (problem) problems.push(problem);
  }

  for (const envName of OPTIONAL_WEBHOOKS) {
    const url = process.env[envName];
    if (!url) continue;
    webhooksChecked++;
    const problem = await checkWebhookExists(envName, url);
    if (problem) problems.push(problem);
  }

  // Stuck alert rows: older than 1h (skips rows mid-scan on the pre-save
  // pattern) but within 24h (matches the BIN retry-sweep window).
  let stuckAlerts = 0;
  try {
    const supabase = createServiceRoleClient();
    const { count, error } = await supabase
      .from('ebay_auction_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', DEFAULT_USER_ID)
      .eq('discord_sent', false)
      .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .lt('created_at', new Date(Date.now() - 3_600_000).toISOString());
    if (error) {
      problems.push(`stuck-alert query failed: ${error.message}`);
    } else if (count && count > 0) {
      stuckAlerts = count;
      problems.push(
        `${count} eBay alert row(s) from the last 24h never delivered to Discord (discord_sent=false, older than 1h)`
      );
    }
  } catch (err) {
    problems.push(`stuck-alert query threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (problems.length > 0) {
    // Best-effort: #alerts may itself be the broken webhook — the runner
    // still sees the problems in the response and exits non-zero.
    await discordService.sendAlert({
      title: '🔴 Discord alerting pipeline unhealthy',
      message: problems.map((p) => `• ${p}`).join('\n').slice(0, 3900),
      priority: 'high',
    });
  }

  console.log(
    `[Cron DiscordHealth] ${problems.length === 0 ? 'healthy' : `${problems.length} problem(s)`} — ` +
      `${webhooksChecked} webhooks checked, ${stuckAlerts} stuck alerts (${Date.now() - startTime}ms)`
  );

  return NextResponse.json({
    success: problems.length === 0,
    problems,
    webhooksChecked,
    stuckAlerts,
    durationMs: Date.now() - startTime,
  });
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
