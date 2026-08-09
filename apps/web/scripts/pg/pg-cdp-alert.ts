/**
 * PG ops alert from a PowerShell wrapper.
 *
 * The .ps1 runners can detect that the CDP Chrome is unrecoverable, but they have no
 * sanctioned way to reach Discord — the webhook routing lives in discordService. Rather
 * than let a wrapper POST a raw webhook (wrong channel, no embed, duplicated routing),
 * it shells out to this. Same sendPgOpsAlert path the driver itself uses, so a skipped
 * run reads identically to an in-run failure in #alerts.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-cdp-alert.ts "<title>" "<line1>" "<line2>" ...
 *
 * Never exits non-zero: alerting must not turn a skipped run into a failed scheduled
 * task. A failure to alert is logged and swallowed.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { discordService } from '../../src/lib/notifications/discord.service';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

async function main(): Promise<void> {
  const [title, ...lines] = process.argv.slice(2);
  if (!title) {
    console.error('[pg-cdp-alert] usage: pg-cdp-alert.ts "<title>" "<line>" ...');
    return;
  }

  try {
    const result = await discordService.sendPgOpsAlert({
      title,
      lines: lines.length > 0 ? lines : ['(no detail supplied)'],
    });
    console.log(`[pg-cdp-alert] sent: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[pg-cdp-alert] alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

void main();
