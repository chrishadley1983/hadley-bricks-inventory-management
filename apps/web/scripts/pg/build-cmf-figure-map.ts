/**
 * Build the CMF figure-name → catalog-number map used to resolve AMBIGUOUS bare-series
 * CMF listings (a seller lists a single figure as "col13" + name text; BL's catalog id
 * for the complete figure is "col13-13" — matching the bare id prices a £3 figure
 * against the £25 series box, the Alpine8 2026-07-14 bug).
 *
 * Source: one BL catalog search-list page per series (catalogList.asp?q=<series>-&catType=S)
 * via the dedicated :9225 Chrome. Output: src/lib/bl-store-assessment/data/cmf-figure-map.json
 *   { "<normalized full name>": "colNN-M", ... }
 * Names are BL catalog names, which is exactly what store listings display — so store
 * itemName → map lookup after the same normalization.
 *
 * Usage: npx tsx scripts/pg/build-cmf-figure-map.ts [--series=col13,colhp] [--cdp-port=9225]
 */

import * as path from 'path';
import * as fs from 'fs';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const CDP_PORT = parseInt(argv['cdp-port'] ?? '9225', 10);
const OUT_FILE = path.resolve(__dirname, '../../src/lib/bl-store-assessment/data/cmf-figure-map.json');

/** Every CMF series with S-type per-figure entries (regular col01..col29 + licensed). */
const DEFAULT_SERIES = [
  'col01', 'col02', 'col03', 'col04', 'col05', 'col06', 'col07', 'col08', 'col09', 'col10',
  'col11', 'col12', 'col13', 'col14', 'col15', 'col16', 'col17', 'col18', 'col19', 'col20',
  'col21', 'col22', 'col23', 'col24', 'col25', 'col26', 'col27', 'col28', 'col29',
  'coldfb', 'coldis', 'coldis2', 'coldis100', 'coldnd', 'colf1rc', 'colhp', 'colhp2',
  'collt', 'colmar', 'colmar2', 'colsh', 'colsim', 'colsim2', 'colspi', 'coltgb',
  'coltlbm', 'coltlbm2', 'coltlm', 'coltlm2', 'coltlnm', 'coltm', 'coluni1',
];

export function normalizeCmfName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Tab { id: string; webSocketDebuggerUrl: string }

async function main(): Promise<void> {
  const series = argv['series'] ? argv['series'].split(',') : DEFAULT_SERIES;
  const { default: WebSocket } = await import('ws');

  const created = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())) as Tab;
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
  let msgId = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString()) as { id?: number; result?: { result?: { value?: unknown } } };
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg.result?.result?.value); pending.delete(msg.id); }
  });
  const send = (method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) resolve(undefined); }, 20000);
    });

  const map: Record<string, string> = fs.existsSync(OUT_FILE)
    ? (JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) as Record<string, string>)
    : {};
  let added = 0;

  for (const s of series) {
    await send('Page.navigate', { url: `https://www.bricklink.com/catalogList.asp?q=${s}-&catType=S&v=0` });
    const deadline = Date.now() + 20000;
    for (;;) {
      await sleep(500);
      const st = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (st === 'complete' || Date.now() > deadline) break;
    }
    await sleep(2500);
    const raw = (await send('Runtime.evaluate', {
      expression: `(function(){
        var out = [];
        var links = document.querySelectorAll('a[href*="catalogitem.page?S=${s}-"]');
        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          var m = (a.getAttribute('href') || '').match(/S=(${s}-\\d+)/);
          if (!m) continue;
          var tr = a.closest('tr');
          var strong = tr ? tr.querySelector('strong') : null;
          var txt = strong ? (strong.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          out.push({ no: m[1], row: txt });
        }
        return JSON.stringify(out);
      })()`,
      returnByValue: true,
    })) as string | undefined;
    if (!raw) { console.warn(`${s}: no response`); continue; }
    const rows = JSON.parse(raw) as Array<{ no: string; row: string }>;
    const seen = new Map<string, string>();
    for (const r of rows) {
      // r.row is the <strong> catalog name, e.g. "Classic King, Series 13 (Complete Set with Stand and Accessories)".
      if (r.row && r.row.length >= 5) seen.set(r.no, r.row);
    }
    for (const [no, name] of seen) {
      const key = normalizeCmfName(name);
      if (key && !map[key]) { map[key] = no; added++; }
    }
    console.log(`${s}: ${seen.size} figures`);
    await sleep(3500 + Math.floor(Math.random() * 1500));
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(map, null, 1));
  console.log(`map written: ${Object.keys(map).length} names (${added} new) → ${OUT_FILE}`);
  ws.close();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${created.id}`).catch(() => {});
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
