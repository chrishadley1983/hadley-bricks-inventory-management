/**
 * One-off: seed bl-store-queue.json with all UK BL stores having lots > 300.
 *
 * Source: https://www.bricklink.com/browseStores.asp?countryID=UK
 *   - Single page lists ALL UK open stores (1900+) with name and lots count
 *   - Each store has anchor href /store.asp?p=<slug>
 *   - Body text shows each store as "<name> - <lots>" on its own line
 *
 * Captures: slug, displayName, lotsCount. Country fixed to "United Kingdom".
 * Filter: lotsCount > 300 (per user spec — keeps newer/cheap stores in scope, drops dead listings).
 *
 * Subsequent profile-enrichment runner (separate script) fills lastActivityAt etc.
 *
 * Run once:  cd apps/web && npx tsx scripts/bl-store-queue-seed.ts
 *            cd apps/web && npx tsx scripts/bl-store-queue-seed.ts --dry-run    # preview, no write
 *            cd apps/web && npx tsx scripts/bl-store-queue-seed.ts --min-lots=500
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import WebSocket from 'ws';
import { loadQueue, saveQueue, addCandidate } from './bl-store-queue';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const DRY_RUN = argv['dry-run'] === 'true';
const MIN_LOTS = parseInt(argv['min-lots'] ?? '300', 10);
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const COUNTRY = argv['country'] ?? 'UK';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Connect to CDP, navigate to the country directory.
  const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json()).catch(() => null) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }> | null;
  if (!tabs) { console.error('CDP not reachable on :' + CDP_PORT + ' — start the launch-cdp-chrome.bat'); process.exit(1); }
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

  const url = `https://www.bricklink.com/browseStores.asp?countryID=${COUNTRY}`;
  console.log(`Fetching ${url} ...`);
  await send('Page.navigate', { url });
  await sleep(6000);

  // Capture all store anchors + their associated row context.
  // BL renders one row per store with cells like: [name link] [lots count]. The anchor's
  // immediate parent's siblings hold the lots cell.
  const raw = await evalExpr<string>(`(function(){
    var anchors = Array.from(document.querySelectorAll('a[href]')).filter(function(a){ return /\\/store\\.asp\\?p=/i.test(a.href || ''); });
    var stores = [];
    var seen = new Set();
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var slugMatch = (a.href || '').match(/[?&]p=([^&]+)/);
      if (!slugMatch) continue;
      var slug = slugMatch[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      // Walk to the immediate TD/cell, then check next sibling cells for a number.
      var cell = a;
      for (var j = 0; j < 5 && cell && cell.tagName !== 'TD'; j++) cell = cell.parentElement;
      var lots = null;
      if (cell && cell.tagName === 'TD') {
        var sib = cell.nextElementSibling;
        for (var k = 0; k < 4 && sib; k++) {
          var t = (sib.textContent || '').trim();
          var m = t.match(/^([0-9,]+)$/);
          if (m) { lots = parseInt(m[1].replace(/,/g, ''), 10); break; }
          sib = sib.nextElementSibling;
        }
      }
      stores.push({ slug: slug, name: (a.textContent || '').trim(), lots: lots });
    }
    return JSON.stringify({ totalAnchors: anchors.length, stores: stores });
  })()`);
  const parsed = JSON.parse(raw) as { totalAnchors: number; stores: Array<{ slug: string; name: string; lots: number | null }> };
  console.log(`Found ${parsed.stores.length} unique stores (anchors: ${parsed.totalAnchors})`);

  // If lots was null for any, fall back to body-text parsing (zip lines with anchors in order).
  // But first, see how many got lots from the DOM walk.
  const withLots = parsed.stores.filter((s) => s.lots !== null).length;
  console.log(`Lots captured from DOM: ${withLots} / ${parsed.stores.length}`);

  if (withLots < parsed.stores.length * 0.8) {
    console.log('Falling back to body-text line parser ...');
    const bodyText = await evalExpr<string>(`document.body.innerText`);
    const lineLotsByName = new Map<string, number>();
    for (const line of bodyText.split('\n')) {
      const m = line.trim().match(/^(.+?)\s+-\s+([0-9,]+)$/);
      if (!m) continue;
      const name = m[1].trim();
      const lots = parseInt(m[2].replace(/,/g, ''), 10);
      if (!isNaN(lots)) lineLotsByName.set(name, lots);
    }
    console.log(`Body parser found ${lineLotsByName.size} <name> - <lots> lines`);
    for (const s of parsed.stores) {
      if (s.lots === null && lineLotsByName.has(s.name)) s.lots = lineLotsByName.get(s.name)!;
    }
    const withLots2 = parsed.stores.filter((s) => s.lots !== null).length;
    console.log(`Lots captured after fallback: ${withLots2} / ${parsed.stores.length}`);
  }

  // Filter to lots > MIN_LOTS, drop ones with unknown lots.
  const filtered = parsed.stores.filter((s) => s.lots !== null && s.lots > MIN_LOTS);
  console.log(`Filtered to lots > ${MIN_LOTS}: ${filtered.length} stores`);
  console.log(`(Dropped: ${parsed.stores.length - filtered.length} — ${parsed.stores.filter((s) => s.lots === null).length} with unknown lots, ${parsed.stores.filter((s) => s.lots !== null && s.lots <= MIN_LOTS).length} below threshold)`);

  if (DRY_RUN) {
    console.log('\n--dry-run set, not modifying queue.');
    console.log('Sample of would-be-added stores:');
    filtered.slice(0, 10).forEach((s) => console.log(`  ${s.slug} (${s.name}) — ${s.lots} lots`));
    ws.close(); return;
  }

  // Add all to queue.
  const queue = loadQueue();
  let added = 0, skipped = 0;
  for (const s of filtered) {
    const wasNew = addCandidate(queue, s.slug, 'seller-list', { storeName: s.name, country: 'United Kingdom' });
    if (wasNew) {
      // Annotate metadata so pickNext can use staleness prior.
      const entry = queue.stores.find((e) => e.slug.toLowerCase() === s.slug.toLowerCase());
      if (entry && s.lots !== null) entry.blMetadata = { ...entry.blMetadata, lotsCount: s.lots, capturedAt: new Date().toISOString() };
      added++;
    } else {
      // Backfill lotsCount on existing entries if absent.
      const entry = queue.stores.find((e) => e.slug.toLowerCase() === s.slug.toLowerCase());
      if (entry && s.lots !== null && (!entry.blMetadata || entry.blMetadata.lotsCount === undefined)) {
        entry.blMetadata = { ...entry.blMetadata, lotsCount: s.lots, capturedAt: new Date().toISOString() };
      }
      skipped++;
    }
  }
  saveQueue(queue);
  console.log(`\nQueue updated: +${added} new, ${skipped} already present (metadata backfilled where missing)`);
  console.log(`Total queue size: ${queue.stores.length}`);

  ws.close();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
