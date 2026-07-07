/**
 * BrickLink price-guide PAGE engine (catalogPG.asp).
 *
 * Scrapes BL's classic price-guide page via Chrome DevTools Protocol page navigation —
 * the same technique as the POV engine (`part-out-value.ts`): a logged-out/credential-less
 * XHR fetch gets an anti-bot HTTP 202, but a real browser navigation renders fine.
 *
 * One navigation returns ALL FOUR quadrants — 6-month sold New/Used and current stock
 * New/Used — including every individual transaction (qty × price) grouped by month.
 *
 * UK extraction (validated 2026-07-07 against the REST API's country_code=UK guides):
 * transaction prices rendered WITHOUT a "~" prefix ("GBP 0.06" vs "~GBP 0.07") are in the
 * sale's original currency = seller trades in GBP = UK seller (UK is BL's only GBP-native
 * country). Lot counts and total quantities reproduce the API's unit_quantity /
 * total_quantity exactly; averages match within display rounding.
 *
 * REQUIREMENT: the driven Chrome session must display prices in GBP (logged-in account
 * with GBP display). Under a non-GBP display currency every GBP row gains a tilde and the
 * heuristic collapses — `assertGbpDisplay` guards this per page.
 *
 * Rate-limit discipline (mirrors POV): one navigation per page, no retry loops beyond a
 * single transient retry, typed errors so callers stop immediately on block/captcha/login.
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PgItemType = 'P' | 'S' | 'M';

export interface PgItemRef {
  itemType: PgItemType;
  /** BL item number. Sets may be bare ("45501") — the URL builder appends "-1". */
  itemNo: string;
  /** BL colour ID. Ignored (0) for sets/minifigs. */
  colourId: number;
}

/** One transaction/listing row: [monthLabel|null, qty, price, converted] */
export type PgRawRow = [string | null, number, number, boolean];

export interface PgRawQuadrants {
  soldNew: PgRawRow[];
  soldUsed: PgRawRow[];
  stockNew: PgRawRow[];
  stockUsed: PgRawRow[];
}

export interface PgMonthBucket {
  lots: number;
  qty: number;
  avg: number;
}

export interface PgQuadrantStats {
  lots: number;
  qty: number;
  avg: number | null;
  qtyAvg: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Keyed "July 2026" in page order; only present for sold quadrants (stock has no months). */
  byMonth: Record<string, PgMonthBucket>;
}

export interface PgSideStats {
  soldNew: PgQuadrantStats;
  soldUsed: PgQuadrantStats;
  stockNew: PgQuadrantStats;
  stockUsed: PgQuadrantStats;
}

export interface PgScrapeResult {
  item: PgItemRef;
  itemName: string | null;
  /** UK-only stats (non-tilde native-GBP rows). */
  uk: PgSideStats;
  /** Worldwide stats (all rows, GBP-converted amounts as displayed). */
  world: PgSideStats;
  finalUrl: string;
  scrapedAt: string;
}

// ---------------------------------------------------------------------------
// Typed errors — callers should STOP scraping on Block/Captcha/Login
// ---------------------------------------------------------------------------

export class PgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** BL throttle / anti-bot (oops.asp, err=403, near-empty body). Pause the batch. */
export class PgBlockError extends PgError {}
/** Captcha / "unusual traffic" challenge. Stop entirely. */
export class PgCaptchaError extends PgError {}
/** Login wall (session expired). */
export class PgLoginError extends PgError {}
/** Item not in the BL catalog (notFound.asp). Permanent — don't retry. */
export class PgNotFoundError extends PgError {}
/** Valid PG page but no transaction tables at all (item never sold/listed). Genuine no-data. */
export class PgNoDataError extends PgError {}
/** Page rendered in a non-GBP display currency — UK extraction would be wrong. */
export class PgCurrencyError extends PgError {}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/** Sets need the "-1" sequence suffix — bare "45501" 404s (learned 2026-07-07). */
export function normaliseSetNo(itemNo: string): string {
  return /-\d+$/.test(itemNo) ? itemNo : `${itemNo}-1`;
}

export function buildPgUrl(item: PgItemRef): string {
  if (item.itemType === 'P') {
    return `https://www.bricklink.com/catalogPG.asp?P=${encodeURIComponent(item.itemNo)}&colorID=${item.colourId}`;
  }
  if (item.itemType === 'S') {
    return `https://www.bricklink.com/catalogPG.asp?S=${encodeURIComponent(normaliseSetNo(item.itemNo))}`;
  }
  return `https://www.bricklink.com/catalogPG.asp?M=${encodeURIComponent(item.itemNo)}`;
}

// ---------------------------------------------------------------------------
// Pure stats computation (unit-tested)
// ---------------------------------------------------------------------------

const EMPTY_STATS: PgQuadrantStats = {
  lots: 0, qty: 0, avg: null, qtyAvg: null, median: null, min: null, max: null, byMonth: {},
};

/**
 * Aggregate rows into quadrant stats. Pass `ukOnly=true` to keep only non-converted
 * (native-GBP = UK) rows; false aggregates everything (worldwide, converted-to-GBP).
 */
export function computeQuadrantStats(rows: PgRawRow[], ukOnly: boolean): PgQuadrantStats {
  const kept = ukOnly ? rows.filter((r) => !r[3]) : rows;
  if (kept.length === 0) return { ...EMPTY_STATS, byMonth: {} };
  let qty = 0;
  let sum = 0;
  let qtySum = 0;
  let min = Infinity;
  let max = -Infinity;
  const prices: number[] = [];
  const byMonth: Record<string, { lots: number; qty: number; sum: number }> = {};
  for (const [month, q, price] of kept) {
    qty += q;
    sum += price;
    qtySum += price * q;
    if (price < min) min = price;
    if (price > max) max = price;
    prices.push(price);
    if (month) {
      const b = (byMonth[month] ??= { lots: 0, qty: 0, sum: 0 });
      b.lots += 1;
      b.qty += q;
      b.sum += price;
    }
  }
  prices.sort((a, b) => a - b);
  // True median: average the two middles on even counts (upper-middle alone biases
  // 2-lot quadrants to their max — caught by the post-merge validation workflow).
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
  const round4 = (n: number) => +n.toFixed(4);
  const months: Record<string, PgMonthBucket> = {};
  for (const [m, b] of Object.entries(byMonth)) {
    months[m] = { lots: b.lots, qty: b.qty, avg: round4(b.sum / b.lots) };
  }
  return {
    lots: kept.length,
    qty,
    avg: round4(sum / kept.length),
    qtyAvg: qty > 0 ? round4(qtySum / qty) : null,
    median: round4(median),
    min: round4(min),
    max: round4(max),
    byMonth: months,
  };
}

export function computeSideStats(quads: PgRawQuadrants, ukOnly: boolean): PgSideStats {
  return {
    soldNew: computeQuadrantStats(quads.soldNew, ukOnly),
    soldUsed: computeQuadrantStats(quads.soldUsed, ukOnly),
    stockNew: computeQuadrantStats(quads.stockNew, ukOnly),
    stockUsed: computeQuadrantStats(quads.stockUsed, ukOnly),
  };
}

/**
 * Pieces sold across the N most recent month labels present (page lists months
 * newest-first, so label order in the buckets reflects recency; we sort by parsed date).
 */
export function recentMonthsQty(stats: PgQuadrantStats, nMonths: number): number {
  const parse = (label: string): number => {
    const t = Date.parse(`1 ${label}`);
    return Number.isNaN(t) ? 0 : t;
  };
  return Object.entries(stats.byMonth)
    .sort((a, b) => parse(b[0]) - parse(a[0]))
    .slice(0, nMonths)
    .reduce((s, [, b]) => s + b.qty, 0);
}

// ---------------------------------------------------------------------------
// Page classification (pure, unit-tested)
// ---------------------------------------------------------------------------

export type PgPageKind = 'ok' | 'block' | 'captcha' | 'login' | 'notFound' | 'noData' | 'wrongCurrency' | 'transient';

export interface PgPageProbe {
  url: string;
  title: string;
  textLen: number;
  /** True when the 4-cell quadrant row was located in the DOM. */
  hasQuadrants: boolean;
  /** True when any non-GBP currency token appears un-tilded (display currency ≠ GBP). */
  foreignNativeSeen: boolean;
  /** Body text sample for captcha/login detection (first ~2000 chars). */
  textSample: string;
}

export function classifyPgPage(p: PgPageProbe): PgPageKind {
  if (/notFound\.asp|catalogPG\.asp\?err=N/i.test(p.url)) return 'notFound';
  // Captcha must outrank the small-body block heuristic — a challenge page is small but
  // demands a full stop, not a batch pause (validation-workflow finding).
  if (/captcha|unusual traffic|are you a human|verify you are/i.test(p.textSample)) return 'captcha';
  if (/oops\.asp|err=403/i.test(p.url) || (p.textLen < 200 && !/Price Guide/i.test(p.title))) return 'block';
  if (/sign in|log in to|please log in/i.test(p.textSample) && /login|identity\.lego/i.test(p.url)) return 'login';
  if (!/Price Guide/i.test(p.title)) return 'transient';
  if (p.foreignNativeSeen) return 'wrongCurrency';
  // A rendered Price Guide page with no transaction tables = item never sold/listed
  // anywhere (small shell page, ~2KB). Genuine no-data, NOT a block (learned on old sets).
  // Guard against partially-rendered pages: a real PG shell carries the full BL header/footer
  // (~1.7KB+ innerText); anything smaller is a slow load — retry, never a permanent no-data.
  if (!p.hasQuadrants) return p.textLen >= 800 ? 'noData' : 'transient';
  return 'ok';
}

// ---------------------------------------------------------------------------
// In-page extraction JS (returns compact raw rows; stats computed Node-side)
// ---------------------------------------------------------------------------

/**
 * DOM shape (discovered 2026-07-07): the quadrant row is a <tr> with exactly 4 <td>s
 * (sold-New, sold-Used, stock-New, stock-Used). Month headers are single full-width
 * cells ("July 2026"); transaction rows are 3-cell rows [spacer, qty, price] where a
 * converted (non-UK) price is prefixed "~". Row shape: [month|null, qty, price, converted].
 */
export const PG_EXTRACT_JS = `(function(){
  var monthRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\\u00a0?\\s*20\\d\\d$/;
  var priceRe = /^(~)?\\s*(GBP|US\\s*\\$|CA\\s*\\$|EUR|AU\\s*\\$|JPY|CHF|SEK|DKK|NOK|PLN|CZK|HUF)\\s*([\\d,]+(?:\\.\\d+)?)$/;
  var tds = Array.from(document.querySelectorAll('td'));
  var monthTd = tds.find(function(td){ return monthRe.test((td.textContent||'').replace(/\\s+/g,' ').trim()); });
  var quadRow = null;
  if (monthTd) {
    var tbl = monthTd.closest('table');
    var quadTd = tbl ? tbl.parentElement : null;
    quadRow = quadTd ? quadTd.closest('tr') : null;
  }
  if (!quadRow || quadRow.children.length !== 4) {
    var trs = Array.from(document.querySelectorAll('tr'));
    quadRow = trs.find(function(tr){
      return tr.children.length === 4 && Array.from(tr.children).every(function(c){ return /Each/.test(c.textContent||''); });
    }) || null;
  }
  var foreignNative = false;
  function parseCell(cell) {
    var out = [];
    if (!cell) return out;
    var rows = Array.from(cell.querySelectorAll('tr'));
    var currentMonth = null;
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].children;
      var txt = (rows[i].textContent||'').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
      if (monthRe.test(txt)) { currentMonth = txt; continue; }
      if (cells.length !== 3) continue;
      var qty = parseInt((cells[1].textContent||'').replace(/[,\\u00a0]/g,'').trim(), 10);
      var m = (cells[2].textContent||'').replace(/\\u00a0/g,' ').trim().match(priceRe);
      if (!m || !(qty > 0)) continue;
      var converted = !!m[1];
      if (!converted && m[2] !== 'GBP') foreignNative = true;
      out.push([currentMonth, qty, parseFloat(m[3].replace(/,/g,'')), converted]);
    }
    return out;
  }
  var quads = null;
  if (quadRow) {
    var c = quadRow.children;
    quads = { soldNew: parseCell(c[0]), soldUsed: parseCell(c[1]), stockNew: parseCell(c[2]), stockUsed: parseCell(c[3]) };
  }
  return JSON.stringify({
    url: location.href,
    title: document.title,
    textLen: (document.body && document.body.innerText ? document.body.innerText.length : 0),
    textSample: (document.body && document.body.innerText ? document.body.innerText.slice(0, 2000) : ''),
    hasQuadrants: !!quads,
    foreignNativeSeen: foreignNative,
    quads: quads
  });
})()`;

/**
 * Derive the item descriptor from the page title, Node-side — regexes inside the
 * PG_EXTRACT_JS template literal lose their backslashes when the string is cooked
 * (the "\s became s" bug the re-validation workflow caught), so title parsing must
 * NOT live in the in-page JS. "BrickLink Price Guide - Part 3001 in Black Color"
 * → "Part 3001 in Black Color".
 */
export function parseItemNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/Price Guide\s*[-–]\s*(.+)$/i);
  if (!m || !m[1]) return null;
  const name = m[1].trim().slice(0, 200);
  return name || null;
}

// ---------------------------------------------------------------------------
// CDP scraper — open once, scrape many, close once
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PgRunOptions {
  cdpPort?: number;
  navTimeoutMs?: number;
  settleMs?: number;
}

interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

export class PgScraper {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private sessionId: string | null = null;
  private targetId: string | null = null;
  private readonly port: number;
  private readonly navTimeoutMs: number;
  private readonly settleMs: number;

  constructor(opts: PgRunOptions = {}) {
    this.port = opts.cdpPort ?? 9222;
    this.navTimeoutMs = opts.navTimeoutMs ?? 20000;
    this.settleMs = opts.settleMs ?? 1200;
  }

  private failAllPending(reason: string): void {
    for (const [, h] of this.pending) h.reject(new PgError(reason));
    this.pending.clear();
  }

  private rawSend(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new PgError(`CDP call timed out: ${method}`));
      }, this.navTimeoutMs + 15000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const res = (await this.rawSend('Runtime.evaluate', { expression, returnByValue: true }, this.sessionId ?? undefined)) as {
      result?: { value?: T };
      exceptionDetails?: { text: string };
    };
    if (res.exceptionDetails) throw new PgError(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }

  async open(): Promise<void> {
    const ver = (await fetch(`http://127.0.0.1:${this.port}/json/version`).then((r) => r.json())) as {
      webSocketDebuggerUrl: string;
    };
    this.ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => resolve());
      this.ws!.once('error', (e) => reject(e));
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as CdpMessage;
      if (msg.id && this.pending.has(msg.id)) {
        const h = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) h.reject(new Error(msg.error.message));
        else h.resolve(msg.result);
      }
    });
    this.ws.on('close', () => this.failAllPending('CDP socket closed mid-call'));
    this.ws.on('error', () => this.failAllPending('CDP socket error mid-call'));

    const tgt = (await this.rawSend('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    this.targetId = tgt.targetId;
    const att = (await this.rawSend('Target.attachToTarget', { targetId: this.targetId, flatten: true })) as {
      sessionId: string;
    };
    this.sessionId = att.sessionId;
    await this.rawSend('Page.enable', {}, this.sessionId);
    await this.rawSend('Runtime.enable', {}, this.sessionId);
  }

  /** Scrape one price-guide page. Throws typed errors; retries a transient page once. */
  async scrape(item: PgItemRef, _attempt = 1): Promise<PgScrapeResult> {
    if (!this.ws || !this.sessionId) throw new PgError('PgScraper.open() must be called first');
    const url = buildPgUrl(item);

    await this.rawSend('Page.navigate', { url }, this.sessionId);
    const deadline = Date.now() + this.navTimeoutMs;
    for (;;) {
      await sleep(400);
      const state = await this.evaluate<string>('document.readyState').catch(() => 'loading');
      if (state === 'complete' || Date.now() > deadline) break;
    }
    await sleep(this.settleMs);

    const raw = await this.evaluate<string>(PG_EXTRACT_JS);
    const page = JSON.parse(raw) as PgPageProbe & { quads: PgRawQuadrants | null };

    const kind = classifyPgPage(page);
    const label = `${item.itemType} ${item.itemNo}${item.itemType === 'P' ? ` c${item.colourId}` : ''}`;
    switch (kind) {
      case 'notFound':
        throw new PgNotFoundError(`Not in BL catalog: ${label} (url: ${page.url})`);
      case 'noData':
        throw new PgNoDataError(`Price guide has no sales/stock data: ${label}`);
      case 'block':
        throw new PgBlockError(`Blocked/empty response for ${label} (len=${page.textLen}, url=${page.url})`);
      case 'captcha':
        throw new PgCaptchaError(`Captcha/anti-bot challenge for ${label}`);
      case 'login':
        throw new PgLoginError(`Login wall for ${label} (url: ${page.url})`);
      case 'wrongCurrency':
        throw new PgCurrencyError(
          `Display currency is not GBP for ${label} — UK extraction unsafe. Fix the session's BL price-guide currency.`,
        );
      case 'transient':
        if (_attempt < 2) {
          await sleep(4000);
          return this.scrape(item, _attempt + 1);
        }
        throw new PgBlockError(`Non-PG page after retry for ${label} (url: ${page.url})`);
    }

    const quads = page.quads!;
    return {
      item,
      itemName: parseItemNameFromTitle(page.title),
      uk: computeSideStats(quads, true),
      world: computeSideStats(quads, false),
      finalUrl: page.url,
      scrapedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    try {
      if (this.targetId) await this.rawSend('Target.closeTarget', { targetId: this.targetId });
    } catch {
      /* best-effort */
    }
    this.ws?.close();
    this.ws = null;
  }
}

/** Quick reachability check for graceful degradation. */
export async function isPgCdpReachable(cdpPort = 9222): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
