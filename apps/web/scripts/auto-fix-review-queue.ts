/**
 * Auto-resolve Vinted purchases stuck in the Review Queue.
 *
 * Pipeline per item:
 *   1. Brickset text search on the item title — accepts a confident single hit.
 *   2. CDP scrape: open the seller's Vinted profile, find a listing matching
 *      the title, grab high-res photo URLs.
 *   3. Claude Opus vision: identify the LEGO set from the photos.
 *
 * Reports decisions and (with --apply) calls /review-queue/[id]/approve or
 * /dismiss against production. CDP must be on port 9222 with Vinted logged in.
 *
 *   npx tsx scripts/auto-fix-review-queue.ts                # dry-run
 *   npx tsx scripts/auto-fix-review-queue.ts --skip-vision  # text-only
 *   npx tsx scripts/auto-fix-review-queue.ts --limit 3      # first 3 items
 *   npx tsx scripts/auto-fix-review-queue.ts --apply        # commit decisions
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import * as http from 'http';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { BricksetApiClient } from '../src/lib/brickset/brickset-api';
import Anthropic from '@anthropic-ai/sdk';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
interface ImageInput { base64: string; mediaType: ImageMediaType; }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ---------- CLI ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_VISION = args.includes('--skip-vision');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();
const PROD_URL = 'https://hadley-bricks-inventory-management.vercel.app';
const CDP_PORT = 9222;
const VISION_MODEL = 'claude-opus-4-7';

// ---------- Supabase ----------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------- Types ----------
interface QueueItem {
  id: string;
  email_id: string;
  source: string;
  item_name: string;
  seller_username: string | null;
  cost: number;
  email_subject: string;
  email_date: string;
  order_reference: string;
}

interface TextMatch {
  set_number: string;
  set_name: string;
  confidence: number;
  candidates: Array<{ set_number: string; set_name: string; year?: number }>;
}

type VisionMatch =
  | { kind: 'lego'; set_number: string; set_name: string; confidence: number; reasoning: string }
  | { kind: 'not_lego'; what_is_it: string };

interface Decision {
  item: QueueItem;
  text?: TextMatch;
  photos?: { urls: string[]; source: 'vinted-listing' | 'vinted-profile'; reason?: string };
  vision?: VisionMatch | { kind: 'error'; error: string };
  final: 'import' | 'dismiss' | 'review';
  set_number?: string;
  set_name?: string;
  reason: string;
}

// ---------- CDP helper (minimal, port-9222 only) ----------
class CDP {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private wsUrl: string) {}

  static async connect(): Promise<CDP> {
    const tabs = await new Promise<any[]>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${CDP_PORT}/json/list`, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => resolve(JSON.parse(data)));
        })
        .on('error', reject);
    });
    // Pick a normal page tab (not devtools, not extension)
    const tab =
      tabs.find((t) => t.type === 'page' && !t.url.startsWith('devtools://')) ?? tabs[0];
    if (!tab?.webSocketDebuggerUrl) throw new Error('No CDP tab found');
    const cdp = new CDP(tab.webSocketDebuggerUrl);
    await cdp.open();
    return cdp;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      });
    });
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result.value as T;
  }

  async navigate(url: string, waitMs = 4000): Promise<void> {
    await this.send('Page.enable');
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, waitMs)); // crude wait — Vinted is JS-heavy
  }

  close() { this.ws?.close(); }
}

// ---------- Stage 1: text search ----------
function cleanTitle(name: string): string {
  return name
    .replace(/\b(lego|new|sealed|brand|in|box|set|sets|bundle|joblot|job\s*lot|with|gift|gwp)\b/gi, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function textSearch(brickset: BricksetApiClient, title: string): Promise<TextMatch | null> {
  const q = cleanTitle(title);
  if (!q) return null;
  let results;
  try {
    results = await brickset.searchSets(q);
  } catch (e) {
    console.warn(`  brickset search failed for "${q}":`, e instanceof Error ? e.message : e);
    return null;
  }
  if (!results || results.length === 0) return null;
  const candidates = results.slice(0, 5).map((r: any) => ({
    set_number: String(r.number),
    set_name: r.name as string,
    year: r.year as number | undefined,
  }));
  // Confidence model:
  //   1 result            → 0.85
  //   top hit ≥ 2× the next hit's name overlap with query → 0.7
  //   else                → 0.5 (ambiguous, return for vision arbitration)
  let confidence = 0.5;
  if (candidates.length === 1) confidence = 0.85;
  else {
    const overlap = (n: string) =>
      n
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => q.toLowerCase().split(/\s+/).includes(w)).length;
    const top = overlap(candidates[0].set_name);
    const next = overlap(candidates[1].set_name);
    if (top >= 3 && top > next + 1) confidence = 0.7;
  }
  return {
    set_number: candidates[0].set_number,
    set_name: candidates[0].set_name,
    confidence,
    candidates,
  };
}

// ---------- Stage 2: CDP scrape via Vinted inbox conversation → listing ----------
async function ensureLoggedIn(cdp: CDP): Promise<boolean> {
  await cdp.navigate('https://www.vinted.co.uk/inbox', 3500);
  const state = await cdp.eval<{ loggedIn: boolean; url: string }>(
    `({ loggedIn: /\\/inbox/.test(location.pathname) && !/Sign up \\| Log in/.test((document.body.innerText || '').slice(0, 500)), url: location.href })`
  );
  return state.loggedIn;
}

async function findConversationIdForSeller(
  cdp: CDP,
  seller: string,
  maxScrolls = 35
): Promise<string | null> {
  // Always start from a fresh /inbox so we don't search a stale DOM (e.g. a
  // listing page left over from the previous iteration).
  await cdp.navigate('https://www.vinted.co.uk/inbox', 3500);
  let prevCount = 0;
  let stallCount = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const result = await cdp.eval<{ convId: string | null; itemCount: number; firstSeller: string; lastSeller: string }>(`(() => {
      const seller = ${JSON.stringify(seller)};
      const items = Array.from(document.querySelectorAll('[data-testid^="inbox-list-item-"][data-testid$="-container"]'));
      let convId = null;
      for (const item of items) {
        const text = item.innerText || '';
        // Each row's first text node is the seller username, on its own line
        const firstLine = text.split('\\n')[0].trim();
        if (firstLine === seller) {
          const tid = item.getAttribute('data-testid') || '';
          const m = tid.match(/inbox-list-item-(\\d+)/);
          if (m) { convId = m[1]; break; }
        }
      }
      const firstSeller = items[0]?.innerText?.split('\\n')[0]?.trim() || '';
      const lastSeller = items[items.length - 1]?.innerText?.split('\\n')[0]?.trim() || '';
      return { convId, itemCount: items.length, firstSeller, lastSeller };
    })()`);
    if (result.convId) return result.convId;
    if (process.env.DEBUG_SCROLL) {
      console.log(`     scroll ${i}: ${result.itemCount} items, first="${result.firstSeller}" last="${result.lastSeller}"`);
    }
    if (result.itemCount === prevCount) stallCount++; else stallCount = 0;
    prevCount = result.itemCount;
    if (stallCount >= 4) return null;
    // Get the sidebar's bounding rect so we know where to dispatch the wheel.
    const rect = await cdp.eval<{ x: number; y: number } | null>(`(() => {
      const items = document.querySelectorAll('[data-testid^="inbox-list-item-"][data-testid$="-container"]');
      if (items.length === 0) return null;
      const last = items[items.length - 1];
      const r = last.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (rect) {
      // Real wheel event at the sidebar position — virtualized lists need this
      // (scrollIntoView and scrollBy on the container don't trigger lazy-load).
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: 1500,
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function findVintedPhotos(
  cdp: CDP,
  seller: string,
  itemTitle: string
): Promise<{ urls: string[]; source: 'vinted-listing'; reason?: string }> {
  const convId = await findConversationIdForSeller(cdp, seller);
  if (!convId) return { urls: [], source: 'vinted-listing', reason: `seller "${seller}" not found in inbox sidebar after scrolling` };
  // Navigate to the conversation; the conversation pane needs ~5s to load
  await cdp.navigate(`https://www.vinted.co.uk/inbox/${convId}`, 5000);
  // The conversation header has a single /items/<digits>-... link to the listing
  const itemHref = await cdp.eval<string | null>(
    `Array.from(document.querySelectorAll('a')).map(a => a.href).find(h => /\\/items\\/\\d+/.test(h)) || null`
  );
  if (!itemHref) return { urls: [], source: 'vinted-listing', reason: `no item link in conversation ${convId}` };
  await cdp.navigate(itemHref, 4500);
  const urls: string[] = await cdp.eval(`
    Array.from(new Set(
      Array.from(document.querySelectorAll('img'))
        .map(i => i.src)
        .filter(s => s.includes('vinted.net') && /f(800|1600)/.test(s))
    )).slice(0, 4)
  `);
  // Also pull description for vision context (cheap)
  return {
    urls,
    source: 'vinted-listing',
    reason: urls.length === 0 ? 'no f800/f1600 images on listing' : undefined,
  };
}

// ---------- Stage 3: vision ----------
async function downloadAsImageInput(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const mediaType = (
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].find((m) => ct.includes(m.split('/')[1])) ??
      'image/jpeg'
    ) as ImageMediaType;
    return { base64: buf.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

async function visionIdentify(
  itemTitle: string,
  textCandidates: Array<{ set_number: string; set_name: string }>,
  photoUrls: string[]
): Promise<VisionMatch | null> {
  const images = (await Promise.all(photoUrls.slice(0, 3).map(downloadAsImageInput))).filter(
    (x): x is ImageInput => x !== null
  );
  if (images.length === 0) return null;
  const candidatesBlurb = textCandidates.length
    ? `Likely candidates from a Brickset text search: ${textCandidates.map((c) => `${c.set_number} (${c.set_name})`).join('; ')}.`
    : 'No text-search candidates were found.';
  const system = `You identify LEGO sets from product photos. The user is reselling on Hadley Bricks.
Return STRICT JSON with one of these shapes:
{"kind":"lego","set_number":"40338","set_name":"Christmas Tree","confidence":0.95,"reasoning":"Set number visible on box near age rating"}
{"kind":"not_lego","what_is_it":"toddler bath duck"}
Confidence 0..1. Only claim 'lego' if you can see clear evidence (set number on box, distinctive build, or unambiguous box art).`;
  const user = `Vinted listing title: "${itemTitle}"\n${candidatesBlurb}\n\nWhat LEGO set is this? Photos attached.`;
  try {
    // Direct SDK call — Opus 4.7 doesn't accept `temperature`, so we omit it.
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
            })),
            { type: 'text' as const, text: user },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;
    const raw = textBlock.text;
    const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? raw;
    return JSON.parse(jsonStr) as VisionMatch;
  } catch (e) {
    console.warn(`  vision call failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------- Pipeline ----------
async function classify(
  cdp: CDP | null,
  brickset: BricksetApiClient,
  item: QueueItem
): Promise<Decision> {
  console.log(`\n→ ${item.item_name} — ${item.seller_username} — £${item.cost}`);

  // Stage 1: text
  const text = await textSearch(brickset, item.item_name);
  if (text) {
    console.log(`   text: ${text.set_number} (${text.set_name}) conf=${text.confidence}`);
  } else {
    console.log(`   text: no match`);
  }
  if (text && text.confidence >= 0.85) {
    return {
      item,
      text,
      final: 'import',
      set_number: text.set_number,
      set_name: text.set_name,
      reason: 'brickset single-result match',
    };
  }

  // Stage 2: CDP photos
  if (SKIP_VISION || !cdp || !item.seller_username) {
    return {
      item,
      text: text ?? undefined,
      final: 'review',
      reason: SKIP_VISION ? 'vision disabled' : !cdp ? 'cdp unavailable' : 'no seller',
    };
  }
  let photos;
  try {
    photos = await findVintedPhotos(cdp, item.seller_username, item.item_name);
    console.log(`   photos: ${photos.urls.length} via ${photos.source}${photos.reason ? ' (' + photos.reason + ')' : ''}`);
  } catch (e) {
    console.warn(`   cdp scrape error:`, e instanceof Error ? e.message : e);
    return { item, text: text ?? undefined, final: 'review', reason: 'cdp scrape failed' };
  }
  if (photos.urls.length === 0) {
    return {
      item,
      text: text ?? undefined,
      photos,
      final: 'review',
      reason: photos.reason ?? 'no photos found',
    };
  }

  // Stage 3: vision
  const vision = await visionIdentify(item.item_name, text?.candidates ?? [], photos.urls);
  if (!vision) {
    return { item, text: text ?? undefined, photos, vision: { kind: 'error', error: 'vision returned null' }, final: 'review', reason: 'vision unavailable' };
  }
  console.log(`   vision: ${JSON.stringify(vision)}`);
  if (vision.kind === 'not_lego') {
    return { item, text: text ?? undefined, photos, vision, final: 'dismiss', reason: `not LEGO (${vision.what_is_it})` };
  }
  if (vision.confidence >= 0.7) {
    return {
      item,
      text: text ?? undefined,
      photos,
      vision,
      final: 'import',
      set_number: vision.set_number,
      set_name: vision.set_name,
      reason: `vision confident (${vision.confidence})`,
    };
  }
  return { item, text: text ?? undefined, photos, vision, final: 'review', reason: `vision low confidence (${vision.confidence})` };
}

// ---------- Main ----------
async function pullQueueItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('processed_purchase_emails')
    .select('id, email_id, source, item_name, seller_username, cost, email_subject, email_date, order_reference')
    .eq('source', 'Vinted')
    .eq('status', 'skipped')
    .eq('skip_reason', 'no_set_number')
    .order('email_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).slice(0, LIMIT) as QueueItem[];
}

async function applyDecision(d: Decision): Promise<{ ok: boolean; info: string }> {
  const apiKey = process.env.SERVICE_API_KEY!;
  if (d.final === 'import' && d.set_number) {
    const res = await fetch(`${PROD_URL}/api/purchases/review-queue/${d.item.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ items: [{ set_number: d.set_number, condition: 'New' }] }),
    });
    const body = await res.text();
    return { ok: res.ok, info: `${res.status} ${body.slice(0, 200)}` };
  }
  if (d.final === 'dismiss') {
    const res = await fetch(`${PROD_URL}/api/purchases/review-queue/${d.item.id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    });
    return { ok: res.ok, info: `${res.status}` };
  }
  return { ok: true, info: 'review (no action)' };
}

(async () => {
  const items = await pullQueueItems();
  console.log(`Found ${items.length} Vinted review-queue items.`);
  if (items.length === 0) return;

  const brickset = new BricksetApiClient(process.env.BRICKSET_API_KEY!);
  let cdp: CDP | null = null;
  if (!SKIP_VISION) {
    try {
      cdp = await CDP.connect();
      console.log('Connected to Chrome on port 9222.');
      const ok = await ensureLoggedIn(cdp);
      if (!ok) {
        console.warn('Vinted not logged in on CDP Chrome — vision disabled.');
        cdp = null;
      } else {
        console.log('Vinted logged in.');
      }
    } catch (e) {
      console.warn(`CDP not available (${e instanceof Error ? e.message : e}); falling back to text-only.`);
    }
  }

  const decisions: Decision[] = [];
  for (const item of items) {
    decisions.push(await classify(cdp, brickset, item));
  }
  cdp?.close();

  // Report
  console.log('\n─────────────── REPORT ───────────────');
  for (const d of decisions) {
    const tag = { import: '✓ IMPORT', dismiss: '✗ DISMISS', review: '? REVIEW' }[d.final];
    const set = d.set_number ? `${d.set_number} (${d.set_name})` : '—';
    console.log(`${tag.padEnd(10)} ${set.padEnd(40)} £${d.item.cost}  ${d.item.seller_username}  — ${d.reason}`);
    console.log(`           "${d.item.item_name}"`);
  }
  const counts = decisions.reduce(
    (a, d) => ({ ...a, [d.final]: a[d.final] + 1 }),
    { import: 0, dismiss: 0, review: 0 }
  );
  console.log(`\nSummary: ${counts.import} import, ${counts.dismiss} dismiss, ${counts.review} review.`);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to commit.');
    return;
  }

  console.log('\nApplying...');
  for (const d of decisions) {
    if (d.final === 'review') continue;
    const r = await applyDecision(d);
    console.log(`  ${d.final} ${d.item.id.slice(0, 8)} → ${r.ok ? 'OK' : 'FAIL'} ${r.info}`);
  }
})();
