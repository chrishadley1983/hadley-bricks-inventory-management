/**
 * BrickLink Part Out Value (POV) engine.
 *
 * Scrapes BrickLink's `catalogPOV.asp` page — the authoritative "Average of last 6 months
 * Sales" and "Current Items For Sale Average" — via Chrome DevTools Protocol page navigation.
 *
 * Why navigation (not fetch): a logged-out XHR `fetch()` to catalogPOV.asp returns HTTP 202
 * with an empty body (BL anti-bot path for credential-less AJAX), but a real browser
 * *navigation* renders the page fine. Navigation works both logged-in (account locale, GBP)
 * and logged-out (incognito, USD), so we standardise on it.
 *
 * Rate-limit discipline: one navigation per fetch, no retry loops, typed errors on
 * login/captcha so callers stop immediately. Callers must cache-first and pace batches.
 *
 * See docs/features/bl-part-out-value/phase-1.md.
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Options + result types
// ---------------------------------------------------------------------------

export type PovCondition = 'N' | 'U';
export type PovBreakType = 'M' | 'B';

export interface PovOptions {
  /** Bare BL set/item number, e.g. "77075" (no -1 suffix). */
  setNumber: string;
  itemSeq: number;
  condition: PovCondition;
  breakType: PovBreakType;
  incInstructions: boolean;
  incBox: boolean;
  incExtra: boolean;
  incBreak: boolean;
}

export const DEFAULT_POV_OPTIONS: Omit<PovOptions, 'setNumber'> = {
  itemSeq: 1,
  condition: 'N',
  breakType: 'M',
  incInstructions: true,
  incBox: false,
  incExtra: false,
  incBreak: false,
};

export interface PovAverage {
  /** Native amount as shown on the page (currency in `PovScrapeResult.nativeCurrency`). */
  amount: number;
  items: number;
  lots: number;
}

export interface PovScrapeResult {
  options: PovOptions;
  setName: string | null;
  /** ISO-ish currency code derived from the page ("GBP", "USD", ...). */
  nativeCurrency: string | null;
  sold6mo: PovAverage | null;
  forSale: PovAverage | null;
  /** Only present when logged in. */
  myInv: PovAverage | null;
  notIncluded: { items: number; lots: number } | null;
  finalUrl: string;
}

// ---------------------------------------------------------------------------
// Typed errors — callers should STOP on these (no retry loops)
// ---------------------------------------------------------------------------

export class PovError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** BL served a login wall — the (logged-out) request needs a session, or the session expired. */
export class LoginRequiredError extends PovError {}
/** BL served a captcha / "unusual traffic" challenge — back off entirely. */
export class CaptchaError extends PovError {}
/** Page loaded but there is no valid POV result for this item (bad set number, no data). */
export class NotFoundError extends PovError {}
/** Empty/near-empty body — BL anti-bot soft-block (common for logged-out scraping without a VPN). */
export class EmptyResponseError extends PovError {}

// ---------------------------------------------------------------------------
// URL + set-number helpers
// ---------------------------------------------------------------------------

/** Valid BL set/item number: alphanumeric base, optional `-<seq>` suffix. No LIKE metacharacters. */
export const SET_NUMBER_RE = /^[A-Za-z0-9]+(?:-\d+)?$/;
export function isValidSetNumber(s: string): boolean {
  return SET_NUMBER_RE.test(s.trim());
}

/** Split a Brickset-style set number ("77075-1") into BL itemNo + seq. */
export function parseSetNumber(raw: string): { itemNo: string; itemSeq: number } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?)-(\d+)$/);
  if (m) return { itemNo: m[1], itemSeq: parseInt(m[2], 10) || 1 };
  return { itemNo: trimmed, itemSeq: 1 };
}

export function resolvePovOptions(partial: Partial<PovOptions> & { setNumber: string }): PovOptions {
  return { ...DEFAULT_POV_OPTIONS, ...partial };
}

const yn = (b: boolean) => (b ? 'Y' : 'N');

/** Build the catalogPOV.asp URL for a set + option-variant. */
export function buildPovUrl(opts: PovOptions): string {
  const params = new URLSearchParams({
    itemType: 'S',
    itemNo: opts.setNumber,
    itemSeq: String(opts.itemSeq),
    itemQty: '1',
    breakType: opts.breakType,
    itemCondition: opts.condition,
    incInstr: yn(opts.incInstructions),
    incBox: yn(opts.incBox),
    incExtra: yn(opts.incExtra),
    incBreak: yn(opts.incBreak),
  });
  return `https://www.bricklink.com/catalogPOV.asp?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function normaliseText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseCurrency(token: string): string {
  const t = token.toUpperCase().replace(/\s+/g, '');
  if (t.includes('GBP') || t.includes('£')) return 'GBP';
  if (t.includes('US') || t === '$' || t.includes('US$')) return 'USD';
  if (t.includes('EUR') || t.includes('€')) return 'EUR';
  if (t.includes('CA')) return 'CAD';
  if (t.includes('AU')) return 'AUD';
  if (t === '$') return 'USD';
  return t.replace(/[^A-Z]/g, '') || 'USD';
}

const num = (s: string) => parseFloat(s.replace(/,/g, ''));
const int = (s: string) => parseInt(s.replace(/,/g, ''), 10);

/** Section labels in page order — used to bound each section so values can't bleed across. */
const POV_SECTION_LABELS = [
  'Average of last 6 months Sales',
  'Current Items For Sale Average',
  'My Inventory Average',
] as const;

const MONEY_RE = /(GBP|US\s*\$|EUR\s*€|CA\s*\$|AU\s*\$|£|\$|€)\s*([\d,]+(?:\.\d{2})?)/i;

/**
 * Extract one labelled average, bounded to its OWN section. The slice runs from just after the
 * label to the start of the next section label (capped), so a set with a "No sales in the past 6
 * months" line yields `null` for that section instead of bleeding the next section's figure into
 * it (which would corrupt the part-out multiple).
 */
function parseSection(text: string, label: string): { currency: string; avg: PovAverage } | null {
  const i = text.indexOf(label);
  if (i < 0) return null;
  const start = i + label.length;
  let end = Math.min(text.length, start + 160);
  for (const other of POV_SECTION_LABELS) {
    if (other === label) continue;
    const j = text.indexOf(other, start);
    if (j >= 0 && j < end) end = j;
  }
  const slice = text.slice(start, end);
  const money = slice.match(MONEY_RE);
  if (!money) return null; // no value in this section (e.g. "No sales in the past 6 months")
  const counts = slice.match(/Including\s*([\d,]+)\s*Items?\s*in\s*([\d,]+)\s*Lots?/i);
  return {
    currency: normaliseCurrency(money[1]),
    avg: {
      amount: num(money[2]),
      items: counts ? int(counts[1]) : 0,
      lots: counts ? int(counts[2]) : 0,
    },
  };
}

export interface PovParseResult {
  isPovPage: boolean;
  /**
   * Positive evidence that the POV data TABLE actually rendered — at least one of the
   * "Average of last 6 months Sales" / "Current Items For Sale Average" section labels is present.
   * BL templates the "Part Out Value" breadcrumb into the title even on a throttle/maintenance
   * interstitial that never rendered the table, so `isPovPage` alone can be a false positive;
   * `hasSectionScaffold` is what distinguishes a genuine empty result from a blocked page.
   */
  hasSectionScaffold: boolean;
  setName: string | null;
  nativeCurrency: string | null;
  sold6mo: PovAverage | null;
  forSale: PovAverage | null;
  myInv: PovAverage | null;
  notIncluded: { items: number; lots: number } | null;
}

/**
 * Parse a catalogPOV page. Accepts raw HTML or already-rendered innerText.
 * Returns a null-shaped result (never throws) so callers classify the outcome.
 */
export function parsePovHtml(input: string): PovParseResult {
  const text = normaliseText(input);
  const isPovPage = /Part Out Value/i.test(text);
  // The real data table always renders these section labels (even when a section is empty, e.g.
  // "No sales in the past 6 months"). An interstitial/throttle keeps the breadcrumb but not these.
  const hasSectionScaffold =
    text.includes('Average of last 6 months Sales') || text.includes('Current Items For Sale Average');

  const nameMatch = text.match(/Part Out Value\s+(.+?)\s*\*?\s*Average of last 6 months/i);
  const setName = nameMatch ? nameMatch[1].trim() : null;

  const sold = parseSection(text, 'Average of last 6 months Sales');
  const forSale = parseSection(text, 'Current Items For Sale Average');
  const myInv = parseSection(text, 'My Inventory Average');

  const niMatch = text.match(/Not Included\s*([\d,]+)\s*Items?\s*in\s*([\d,]+)\s*Lots?/i);
  const notIncluded = niMatch ? { items: int(niMatch[1]), lots: int(niMatch[2]) } : null;

  // Native currency comes from whichever public average is present.
  const nativeCurrency = sold?.currency ?? forSale?.currency ?? myInv?.currency ?? null;

  return {
    isPovPage,
    hasSectionScaffold,
    setName,
    nativeCurrency,
    sold6mo: sold?.avg ?? null,
    forSale: forSale?.avg ?? null,
    myInv: myInv?.avg ?? null,
    notIncluded,
  };
}

export type PovPageKind = 'ok' | 'block' | 'captcha' | 'login' | 'notPartable' | 'noData' | 'nonPov';

/**
 * Classify a catalogPOV response from its final URL + rendered text. Pure + testable.
 *
 * Crucial distinction (the source of a real data-quality bug if got wrong): a THROTTLE and a
 * genuinely NON-PARTABLE item both fail to render a POV page, but must be handled oppositely —
 * a throttle should pause/retry, a non-partable item should be marked "no data" permanently.
 *
 * - `notPartable`: BL bounced the item to the price guide (`catalogPG.asp?err=N`) — e.g. an
 *   individual collectible-minifig figure. Genuine "no part-out" → caller marks it no-data.
 * - `block`: throttle / anti-bot (`oops.asp`, `err=403`, empty body) → caller breathers, never marks.
 * - `captcha`: anti-bot challenge → caller breathers.
 * - `login`: login wall.
 * - `noData`: a valid POV page whose data table rendered (section scaffold present) but has no
 *   sold/for-sale figures → genuine no-data. Marking requires POSITIVE evidence (the scaffold),
 *   not just the breadcrumb — a throttle/maintenance interstitial can carry BL's "Part Out Value"
 *   title without the table, and must NOT become a permanent no-data sentinel.
 * - `nonPov`: rendered something that's neither a fully-rendered POV page nor an obvious block
 *   (incl. a breadcrumb-only interstitial) → caller retries once, then escalates to a block.
 * - `ok`: a valid POV page with data (`parsed` populated).
 */
export function classifyPovPage(url: string, text: string): { kind: PovPageKind; parsed: PovParseResult } {
  const parsed = parsePovHtml(text);
  if (/catalogPG\.asp/i.test(url)) return { kind: 'notPartable', parsed };
  if (/oops\.asp/i.test(url) || /err=403/i.test(url) || (text.trim().length < 30 && !/Part Out Value/i.test(text))) {
    return { kind: 'block', parsed };
  }
  if (/captcha|unusual traffic|are you a human|verify you are/i.test(text)) return { kind: 'captcha', parsed };
  if (!parsed.isPovPage) {
    if (/sign in|log in|please log in|password/i.test(text) || /login/i.test(url)) return { kind: 'login', parsed };
    return { kind: 'nonPov', parsed };
  }
  if (!parsed.sold6mo && !parsed.forSale) {
    // Breadcrumb present but no figures: only mark no-data when the data table actually rendered.
    // Without the section scaffold this is a throttle/interstitial that kept the title — retry it
    // (→ nonPov), never permanently sentinel it. This closes the breadcrumb-only false-negative gap.
    return parsed.hasSectionScaffold ? { kind: 'noData', parsed } : { kind: 'nonPov', parsed };
  }
  return { kind: 'ok', parsed };
}

// ---------------------------------------------------------------------------
// Currency conversion
// ---------------------------------------------------------------------------

/** Convert a native amount to GBP. GBP passes through; USD uses the supplied rate. */
export function toGbp(amount: number | null | undefined, currency: string | null, usdToGbp?: number | null): number | null {
  if (amount == null || currency == null) return null;
  if (currency === 'GBP') return amount;
  if (currency === 'USD') return usdToGbp ? +(amount * usdToGbp).toFixed(4) : null;
  return null;
}

// ---------------------------------------------------------------------------
// CDP scraper
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface CdpMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
}

export interface PovRunOptions {
  cdpPort?: number;
  /** true → scrape from a fresh incognito context (logged-out, USD); false → logged-in default context (GBP). */
  loggedOut?: boolean;
  navTimeoutMs?: number;
  /** extra settle time after readyState=complete (server-rendered, so small). */
  settleMs?: number;
}

/**
 * Drives one Chrome tab to scrape POV pages. Open once, scrape many, close once —
 * so a backfill reuses a single tab across many sets.
 */
export class PovScraper {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private sessionId: string | null = null;
  private targetId: string | null = null;
  private browserContextId: string | null = null;
  private readonly port: number;
  private readonly loggedOut: boolean;
  private readonly navTimeoutMs: number;
  private readonly settleMs: number;
  private readonly callTimeoutMs: number;

  constructor(runOpts: PovRunOptions = {}) {
    this.port = runOpts.cdpPort ?? 9222;
    this.loggedOut = runOpts.loggedOut ?? false;
    this.navTimeoutMs = runOpts.navTimeoutMs ?? 15000;
    this.settleMs = runOpts.settleMs ?? 1200;
    this.callTimeoutMs = this.navTimeoutMs + 15000;
  }

  /** Reject every in-flight call (on socket close/error) so scrape() can never hang forever. */
  private failAllPending(reason: string): void {
    for (const [, handler] of this.pending) handler.reject(new PovError(reason));
    this.pending.clear();
  }

  private rawSend(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new PovError(`CDP call timed out: ${method}`));
      }, this.callTimeoutMs);
      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          (resolve as (x: unknown) => void)(v);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const res = (await this.rawSend('Runtime.evaluate', { expression, returnByValue: true }, this.sessionId ?? undefined)) as {
      result?: { value?: T };
      exceptionDetails?: { text: string };
    };
    if (res.exceptionDetails) throw new PovError(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }

  /** Connect to Chrome and open a dedicated tab (incognito if loggedOut). */
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
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message));
        else handler.resolve(msg.result ?? msg);
      }
    });
    this.ws.on('close', () => this.failAllPending('CDP socket closed mid-call'));
    this.ws.on('error', () => this.failAllPending('CDP socket error mid-call'));

    if (this.loggedOut) {
      const ctx = (await this.rawSend('Target.createBrowserContext', { disposeOnDetach: true })) as {
        browserContextId: string;
      };
      this.browserContextId = ctx.browserContextId;
    }
    const tgt = (await this.rawSend('Target.createTarget', {
      url: 'about:blank',
      ...(this.browserContextId ? { browserContextId: this.browserContextId } : {}),
    })) as { targetId: string };
    this.targetId = tgt.targetId;

    const att = (await this.rawSend('Target.attachToTarget', { targetId: this.targetId, flatten: true })) as {
      sessionId: string;
    };
    this.sessionId = att.sessionId;

    await this.rawSend('Page.enable', {}, this.sessionId);
    await this.rawSend('Runtime.enable', {}, this.sessionId);
  }

  /** Scrape one POV page. Throws typed errors on login/captcha/not-found. */
  async scrape(opts: PovOptions, _attempt = 1): Promise<PovScrapeResult> {
    if (!this.ws || !this.sessionId) throw new PovError('PovScraper.open() must be called first');
    const url = buildPovUrl(opts);

    await this.rawSend('Page.navigate', { url }, this.sessionId);

    const deadline = Date.now() + this.navTimeoutMs;
    for (;;) {
      await sleep(400);
      const state = await this.evaluate<string>('document.readyState');
      if (state === 'complete') break;
      if (Date.now() > deadline) break;
    }
    await sleep(this.settleMs);

    const payload = await this.evaluate<string>(
      `JSON.stringify({ url: location.href, title: document.title, text: (document.body && document.body.innerText) || '' })`,
    );
    const page = JSON.parse(payload) as { url: string; title: string; text: string };

    // Classify the response (pure, unit-tested) and map to typed errors / retry.
    const { kind, parsed } = classifyPovPage(page.url, page.text);
    switch (kind) {
      case 'notPartable':
        throw new NotFoundError(`Item not partable (bounced to price guide) for set ${opts.setNumber} (url: ${page.url})`);
      case 'noData':
        throw new NotFoundError(`POV page has no sold/for-sale data for set ${opts.setNumber}`);
      case 'block':
        throw new EmptyResponseError(
          `Blocked/empty response for set ${opts.setNumber} (len=${page.text.trim().length}, url=${page.url}) — ` +
            `BL is throttling this IP (transient 403); wait a few minutes or switch VPN endpoint, then resume`,
        );
      case 'captcha':
        throw new CaptchaError(`Captcha/anti-bot challenge for set ${opts.setNumber}`);
      case 'login':
        throw new LoginRequiredError(`Login wall for set ${opts.setNumber} (final url: ${page.url})`);
      case 'nonPov':
        // Neither a POV page nor an obvious block — a transient partial/error. Retry once; if it's still
        // not a POV page, treat it as a block (caller breathers) so we never permanently mark a real set
        // as no-data (BL renders a POV shell even for unknown items, so genuine no-data has the header).
        if (_attempt < 2) {
          await sleep(4000);
          return this.scrape(opts, _attempt + 1);
        }
        throw new EmptyResponseError(`Non-POV page after retry for set ${opts.setNumber} (likely a throttle; url: ${page.url})`);
    }

    return {
      options: opts,
      setName: parsed.setName,
      nativeCurrency: parsed.nativeCurrency,
      sold6mo: parsed.sold6mo,
      forSale: parsed.forSale,
      myInv: parsed.myInv,
      notIncluded: parsed.notIncluded,
      finalUrl: page.url,
    };
  }

  async close(): Promise<void> {
    try {
      if (this.browserContextId) {
        await this.rawSend('Target.disposeBrowserContext', { browserContextId: this.browserContextId });
      } else if (this.targetId) {
        await this.rawSend('Target.closeTarget', { targetId: this.targetId });
      }
    } catch {
      /* best-effort */
    }
    this.ws?.close();
    this.ws = null;
  }
}

/** Convenience single-shot scrape: open → scrape → close. */
export async function scrapePov(opts: PovOptions, runOpts: PovRunOptions = {}): Promise<PovScrapeResult> {
  const scraper = new PovScraper(runOpts);
  await scraper.open();
  try {
    return await scraper.scrape(opts);
  } finally {
    await scraper.close();
  }
}

/** Alias for the navigation-based scrape (the name used in the spec + skill docs). */
export const scrapePovByNavigation = scrapePov;

/** Quick check that the CDP Chrome is reachable (used for graceful degradation). */
export async function isCdpReachable(cdpPort = 9222): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
