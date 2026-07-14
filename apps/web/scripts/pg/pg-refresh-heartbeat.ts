/**
 * pg-refresh-heartbeat.ts — dead-man's switch for the nightly lane-D (catalogPG) refresh.
 *
 * The refresh's own alerts (ops/canary) are emitted from INSIDE the tsx job, so if the job
 * never starts — or starts but writes nothing — nothing alerts. This watcher is the
 * absence-based backstop: it reads bl_pg_lane_telemetry (the authoritative record of what
 * the scrape actually did) and fires a Discord alert when no productive lane-D session has
 * landed within the freshness window. It shares NONE of the refresh's moving parts (no CDP,
 * no BrickLink, no scrape loop) — a read-only Supabase query + a Discord post — so it stays
 * up when the thing it watches is down.
 *
 * Healthy state = at least one `lane='catalogpg'` telemetry row with ok > 0 whose started_at
 * is within STALE_HOURS. The refresh runs nightly at 00:05, so the newest productive session
 * should always be < ~24h old; 28h gives slack for a late finish without false alarms.
 *
 * Runs LOCAL-ONLY via a Windows Scheduled Task (see register-pg-tasks.ps1), after the
 * refresh window closes. Never a Vercel cron. Exits 0 whether healthy or alerting, so the
 * scheduler never records a spurious failure; a genuine query/Discord error exits 1.
 *
 * Usage:
 *   npx tsx scripts/pg/pg-refresh-heartbeat.ts               # check + alert if stale
 *   npx tsx scripts/pg/pg-refresh-heartbeat.ts --dry-run     # log verdict, never post
 *   npx tsx scripts/pg/pg-refresh-heartbeat.ts --stale-hours=0  # tune/test the window
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { discordService } from '../../src/lib/notifications/discord.service';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const DRY_RUN = process.argv.includes('--dry-run');
const staleArg = process.argv.find((a) => a.startsWith('--stale-hours='));
const STALE_HOURS = staleArg ? Number(staleArg.split('=')[1]) : 28;
const LANE = 'catalogpg';

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[pg-heartbeat] Missing Supabase env (.env.local)');
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, supabaseKey);

  // Newest PRODUCTIVE lane-D session (ok > 0). A row with ok = 0 means the run happened but
  // scraped nothing (blocked all night / login wall) — that must NOT count as healthy.
  const { data, error } = await sb
    .from('bl_pg_lane_telemetry')
    .select('started_at, ended_at, requests, ok, failed, session_no, notes')
    .eq('lane', LANE)
    .gt('ok', 0)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error(`[pg-heartbeat] telemetry query failed: ${error.message}`);
    process.exit(1);
  }

  const latest = data?.[0];
  const nowMs = Date.now();
  const lastMs = latest ? new Date(latest.started_at).getTime() : null;
  const ageHours = lastMs === null ? null : (nowMs - lastMs) / 3_600_000;
  const stale = ageHours === null || ageHours > STALE_HOURS;

  const ageStr = ageHours === null ? 'never' : `${ageHours.toFixed(1)}h ago`;
  console.log(
    `[pg-heartbeat] lane=${LANE} newest productive session: ${ageStr}` +
      (latest ? ` (ok=${latest.ok}/${latest.requests}, session ${latest.session_no})` : '') +
      ` | threshold=${STALE_HOURS}h | verdict=${stale ? 'STALE → alert' : 'healthy'}`,
  );

  if (!stale) return; // healthy — stay silent

  const detail =
    ageHours === null
      ? 'No successful lane-D (catalogPG) refresh session has EVER been recorded.'
      : `The last successful lane-D (catalogPG) refresh was ${ageStr} — over the ${STALE_HOURS}h freshness window.`;

  if (DRY_RUN) {
    console.log(`[pg-heartbeat] --dry-run: WOULD alert #alerts — ${detail}`);
    return;
  }

  const result = await discordService.send('alerts', {
    title: '🐢 BrickRadar nightly PG refresh looks stalled',
    description:
      `${detail}\n\n` +
      'The nightly lane-D refresh (00:05, domham91 CDP) either did not run or produced no ' +
      'data. Check the pg-refresh Scheduled Task, the domham91 Chrome (:9225) session, and ' +
      'logs/pg-refresh/. Telemetry: `bl_pg_lane_telemetry` where `lane=\'catalogpg\'`.',
    color: 0xe67e22,
    fields: latest
      ? [
          {
            name: 'Last productive session',
            value: `${ageStr} · ok=${latest.ok}/${latest.requests} · failed=${latest.failed}`,
            inline: false,
          },
        ]
      : undefined,
  });

  if (!result.success) {
    console.error(`[pg-heartbeat] Discord alert FAILED: ${result.error}`);
    process.exit(1);
  }
  console.log('[pg-heartbeat] stale — Discord alert sent to #alerts.');
}

main().catch((err) => {
  console.error(`[pg-heartbeat] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
