/**
 * Profile-enrichment runner for the BL store queue.
 *
 * For each queue entry missing blMetadata.lastActivityAt, fetches the BL feedback page
 * (https://www.bricklink.com/feedback.asp?u=<slug>&fbType=I) and parses:
 *   - feedbackCount   (from "(N)" after the slug in the page header)
 *   - memberSince     (the first date — store creation)
 *   - lastActivityAt  (the second date — most recent feedback received)
 *   - locationText    ("Location: <country>, <region>")
 *
 * One fetch per store, 3s rate-limited (BL safe). Batched: pass --count=N to limit.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/bl-store-queue-enrich.ts --count=50
 *   cd apps/web && npx tsx scripts/bl-store-queue-enrich.ts --count=50 --dry-run
 *   cd apps/web && npx tsx scripts/bl-store-queue-enrich.ts                   # processes all missing
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import WebSocket from 'ws';
import { loadQueue, saveQueue } from './bl-store-queue';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const COUNT = argv['count'] ? parseInt(argv['count'], 10) : null; // null = all missing
const DRY_RUN = argv['dry-run'] === 'true';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9225', 10);
const PAGE_DELAY_MS = parseInt(argv['page-delay-ms'] ?? '3000', 10);
const FORCE = argv['force'] === 'true'; // re-enrich even if already populated

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ParsedProfile {
  feedbackCount: number | null;
  memberSinceISO: string | null;
  lastActivityISO: string | null;
  locationText: string | null;
}

function parseDateMonDDYYYY(s: string): string | null {
  // Parse "Aug 24, 2016" → ISO
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const mm = months[m[1]];
  if (!mm) return null;
  const dd = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}T00:00:00.000Z`;
}

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json()).catch(() => null) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }> | null;
  if (!tabs) { console.error('CDP not reachable on :' + CDP_PORT); process.exit(1); }
  const tab = tabs.find((t) => t.type === 'page' && (t.url || '').includes('bricklink')) ?? tabs.find((t) => t.type === 'page');
  if (!tab) { console.error('No page tab in CDP Chrome'); process.exit(1); }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });

  let id = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: { message: string } };
    if (m.id && pending.has(m.id)) { const h = pending.get(m.id)!; pending.delete(m.id); m.error ? h.reject(new Error(m.error.message)) : h.resolve(m.result); }
  });
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve: resolve as (v: unknown) => void, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalExpr = async <T>(expr: string): Promise<T> => {
    const r = await send<{ result?: { value?: T } }>('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.value as T;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const queue = loadQueue();
  const candidates = queue.stores.filter((s) => FORCE || !s.blMetadata?.lastActivityAt);
  const limit = COUNT ?? candidates.length;
  const targets = candidates.slice(0, limit);
  console.log(`Queue: ${queue.stores.length} total, ${candidates.length} need enrichment, processing ${targets.length}.`);
  if (DRY_RUN) console.log('--dry-run set — will fetch but not save.');

  let ok = 0, errors = 0, dormant = 0;
  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    const url = `https://www.bricklink.com/feedback.asp?u=${entry.slug}&fbType=I`;
    try {
      await send('Page.navigate', { url });
      await sleep(PAGE_DELAY_MS);
      const raw = await evalExpr<string>(`(function(){
        var t = document.body.innerText || '';
        var title = document.title || '';
        // Header: "Feedback Forum: Profile of <slug> (<feedbackCount>)"
        var headerMatch = t.match(/Profile of [^(]+\\(([\\d,]+)\\)/);
        var feedbackCount = headerMatch ? parseInt(headerMatch[1].replace(/,/g, ''), 10) : null;
        // Location: "Location: <country>, <region>"
        var locMatch = t.match(/Location:\\s*([^\\n]+)/);
        var location = locMatch ? locMatch[1].trim() : null;
        // Dates: anchored as "MMM DD, YYYY"
        var dates = (t.match(/\\b[A-Za-z]{3}\\s+\\d{1,2},\\s+\\d{4}\\b/g) || []);
        return JSON.stringify({ title: title, feedbackCount: feedbackCount, location: location, dates: dates.slice(0, 5), notFound: /Page (was )?not found/i.test(t) });
      })()`);
      const parsed = JSON.parse(raw) as { title: string; feedbackCount: number | null; location: string | null; dates: string[]; notFound: boolean };

      if (parsed.notFound || parsed.dates.length === 0) {
        console.warn(`  [${i + 1}/${targets.length}] ${entry.slug}: page not found OR no dates — skipping`);
        errors++;
      } else {
        // First date = Member Since, second = most recent feedback (= last activity proxy).
        const memberSinceISO = parseDateMonDDYYYY(parsed.dates[0]);
        const lastActivityISO = parsed.dates.length > 1 ? parseDateMonDDYYYY(parsed.dates[1]) : memberSinceISO;
        const enriched: ParsedProfile = {
          feedbackCount: parsed.feedbackCount,
          memberSinceISO,
          lastActivityISO,
          locationText: parsed.location,
        };

        // Update queue entry.
        entry.blMetadata = {
          ...entry.blMetadata,
          feedbackCount: enriched.feedbackCount ?? entry.blMetadata?.feedbackCount,
          lastActivityAt: enriched.lastActivityISO,
          capturedAt: new Date().toISOString(),
        };
        if (enriched.locationText && !entry.country) entry.country = enriched.locationText;

        const ageDays = enriched.lastActivityISO ? Math.floor((Date.now() - new Date(enriched.lastActivityISO).getTime()) / 86400_000) : -1;
        if (ageDays > 90) dormant++;
        console.log(`  [${i + 1}/${targets.length}] ${entry.slug}  fb=${enriched.feedbackCount ?? '?'}  member-since=${enriched.memberSinceISO?.slice(0, 10) ?? '?'}  last=${enriched.lastActivityISO?.slice(0, 10) ?? '?'}  ${ageDays >= 0 ? '(' + ageDays + 'd ago)' : ''}`);
        ok++;
      }

      // Save every 25 successful enrichments — robust to interruption.
      if (!DRY_RUN && ok > 0 && ok % 25 === 0) {
        saveQueue(queue);
        console.log(`  ... checkpoint saved (${ok} enriched)`);
      }
    } catch (e) {
      console.error(`  [${i + 1}/${targets.length}] ${entry.slug}: error: ${(e as Error).message}`);
      errors++;
    }
  }

  if (!DRY_RUN) saveQueue(queue);
  console.log(`\n=== Done ===`);
  console.log(`  Enriched:  ${ok} stores`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Dormant (>90d since last feedback): ${dormant}  ← these get a +score boost in pickNext`);

  ws.close();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
