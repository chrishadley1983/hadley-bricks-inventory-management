/**
 * clear-review-queue.ts — repeatable engine for clearing the Purchases Review Queue.
 *
 * The Review Queue (`processed_purchase_emails` rows with status='skipped',
 * skip_reason='no_set_number') holds Vinted purchases the email scanner could not
 * auto-identify a LEGO set number for. This tool separates the two halves of the job:
 *
 *   1. DETERMINISTIC SCRAPE  — fetch the seller's Vinted listing photos to disk.
 *   2. INTELLIGENT IDENTIFY  — a vision model (Claude, i.e. the operator running this)
 *      reads the saved photos + cross-checks Brickset, then writes decisions.json.
 *   3. DETERMINISTIC APPLY   — import (approve endpoint) or dismiss each item.
 *
 * Subcommands:
 *   status                       Print live queue counts by status/source.
 *   fetch  [--limit N]           CDP→Vinted /api/v2/inbox→download photos + write manifest.json.
 *   apply  [--dry-run]           Read decisions.json → approve (import) / dismiss each item.
 *
 * Prereqs: CDP Chrome on :9222 logged into the Hadley Bricks Vinted buying account,
 * a local dev server on :3000 (apply uses its /review-queue/[id]/approve), and
 * .env.local with SUPABASE_*, INTERNAL_API_KEY, SERVICE_USER_ID.
 *
 *   npx tsx scripts/clear-review-queue.ts status
 *   npx tsx scripts/clear-review-queue.ts fetch
 *   npx tsx scripts/clear-review-queue.ts apply --dry-run
 *   npx tsx scripts/clear-review-queue.ts apply
 */
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

// ---------- config ----------
const CDP_PORT = 9222;
const LOCAL_APP = 'http://localhost:3000';
const OUT_DIR = path.resolve(__dirname, '../../../analysis/review-queue');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const DECISIONS_PATH = path.join(OUT_DIR, 'decisions.json');
const MAX_PHOTOS = 8;

const args = process.argv.slice(2);
const cmd = args[0];
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------- types ----------
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

interface ManifestEntry extends QueueItem {
  conversation_id: number | null;
  conversation_description: string | null;
  listing_url: string | null;
  photo_files: string[];
  photo_count: number;
  note: string;
}

interface Decision {
  id: string;
  action: 'import' | 'dismiss';
  // import:
  items?: Array<{ set_number: string; condition?: 'New' | 'Used' }>;
  // dismiss:
  skip_reason?: string;
  // free-text for the audit trail (not sent anywhere on import)
  reason?: string;
}

// ---------- CDP (minimal, port-9222 only) ----------
class CDP {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private targetId: string | null = null;
  private constructor(private wsUrl: string) {}

  /**
   * Open our OWN dedicated tab and drive that, so we never hijack a tab the user
   * (or the BrickLink POV backfill loop) is actively using. Session/cookies are
   * shared across tabs in the same Chrome profile, so Vinted login carries over.
   */
  static async openTab(url = 'about:blank'): Promise<CDP> {
    const target = await new Promise<any>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`,
        { method: 'PUT' },
        (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => resolve(JSON.parse(data)));
        }
      );
      req.on('error', reject);
      req.end();
    });
    if (!target?.webSocketDebuggerUrl) throw new Error('Failed to open CDP tab');
    const cdp = new CDP(target.webSocketDebuggerUrl);
    cdp.targetId = target.id;
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
    await new Promise((r) => setTimeout(r, waitMs));
  }

  captureNextInboxCsrf(timeoutMs = 12000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.off('message', handler);
        reject(new Error('csrf capture timeout'));
      }, timeoutMs);
      const handler = (raw: WebSocket.RawData) => {
        const m = JSON.parse(raw.toString());
        if (
          m.method === 'Network.requestWillBeSent' &&
          /\/api\/v2\/inbox\?/.test(m.params?.request?.url ?? '')
        ) {
          const t =
            m.params.request.headers?.['X-CSRF-Token'] || m.params.request.headers?.['x-csrf-token'];
          if (t) {
            clearTimeout(timer);
            this.ws.off('message', handler);
            resolve(t);
          }
        }
      };
      this.ws.on('message', handler);
    });
  }

  /** Close our dedicated tab (best-effort), then the socket. */
  async close() {
    if (this.targetId) {
      await new Promise<void>((resolve) => {
        http
          .get(`http://127.0.0.1:${CDP_PORT}/json/close/${this.targetId}`, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          })
          .on('error', () => resolve());
      });
    }
    this.ws?.close();
  }
}

interface VintedConversation {
  id: number;
  description: string;
  opposite_user: { id: number; login: string };
  item_photos: Array<{ url: string; is_main: boolean }>;
  updated_at: string;
}

/** Navigate to the inbox and confirm we have a logged-in Vinted session. */
async function verifyVintedLogin(cdp: CDP): Promise<{ loggedIn: boolean; url: string }> {
  await cdp.navigate('https://www.vinted.co.uk/inbox', 6000);
  const state = await cdp.eval<{ url: string }>(`({ url: location.href })`);
  const loggedIn = /\/inbox/.test(state.url) && !/signup|login/i.test(state.url);
  return { loggedIn, url: state.url };
}

async function loadInboxConversations(cdp: CDP, maxPages = 12): Promise<VintedConversation[]> {
  await cdp.send('Network.enable');

  // GET /api/v2/inbox doesn't need the CSRF token (that gates state-changing calls);
  // try the plain call first and only fall back to capturing Vinted's own token.
  let csrfToken = '';
  const anonId = await cdp.eval<string>(
    `document.cookie.split('; ').find(c => c.startsWith('anon_id='))?.slice('anon_id='.length) || ''`
  );
  const probe = await cdp.eval<{ status: number }>(
    `(async () => { try { const r = await fetch('/api/v2/inbox?page=1&per_page=1', { credentials:'include', headers:{'Accept':'application/json'} }); return { status: r.status }; } catch { return { status: 0 }; } })()`
  );
  if (probe.status !== 200) {
    try {
      const csrfPromise = cdp.captureNextInboxCsrf();
      await cdp.navigate('https://www.vinted.co.uk/inbox', 800);
      csrfToken = await csrfPromise;
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      /* fall through — page-context fetch with cookies may still work */
    }
  }

  const all: VintedConversation[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await cdp.eval<{ conversations?: VintedConversation[]; error?: number }>(
      `(async () => {
        try {
          const r = await fetch('/api/v2/inbox?page=${page}&per_page=20', {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              ${csrfToken ? `'X-CSRF-Token': ${JSON.stringify(csrfToken)},` : ''}
              'X-Anon-Id': ${JSON.stringify(anonId)},
            },
          });
          if (!r.ok) return { error: r.status };
          return await r.json();
        } catch (e) { return { error: 0 }; }
      })()`
    );
    if (result.error || !result.conversations || result.conversations.length === 0) break;
    all.push(...result.conversations);
    if (result.conversations.length < 20) break;
  }
  return all;
}

/**
 * For a matched conversation, navigate directly to it (we already have the id, so
 * no flaky sidebar scrolling), open the listing, and scrape full-res photos.
 * Falls back to the inbox API's item_photos thumbnails if the listing yields none.
 */
async function scrapeListingPhotos(
  cdp: CDP,
  conv: VintedConversation
): Promise<{ listingUrl: string | null; urls: string[] }> {
  const fallback = (conv.item_photos ?? []).map((p) => p.url).filter(Boolean);
  try {
    await cdp.navigate(`https://www.vinted.co.uk/inbox/${conv.id}`, 4500);
    const itemHref = await cdp.eval<string | null>(
      `Array.from(document.querySelectorAll('a')).map(a => a.href).find(h => /\\/items\\/\\d+/.test(h)) || null`
    );
    if (!itemHref) return { listingUrl: null, urls: fallback };
    await cdp.navigate(itemHref, 4500);
    const urls = await cdp.eval<string[]>(`
      Array.from(new Set(
        Array.from(document.querySelectorAll('img'))
          .map(i => i.src)
          .filter(s => s.includes('vinted.net') && /f(800|1600)/.test(s))
      ))
    `);
    // Prefer full-res listing photos; top up with any thumbnails we don't already have.
    const merged = [...urls];
    for (const f of fallback) if (!merged.includes(f)) merged.push(f);
    return { listingUrl: itemHref, urls: merged.slice(0, MAX_PHOTOS) };
  } catch (e) {
    return { listingUrl: null, urls: fallback.slice(0, MAX_PHOTOS) };
  }
}

async function downloadPhoto(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return buf.length > 0;
  } catch {
    return false;
  }
}

// ---------- data access ----------
async function pullQueueItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('processed_purchase_emails')
    .select(
      'id, email_id, source, item_name, seller_username, cost, email_subject, email_date, order_reference'
    )
    .eq('status', 'skipped')
    .eq('skip_reason', 'no_set_number')
    .order('email_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, cost: Number(r.cost) })) as QueueItem[];
}

// ---------- commands ----------
async function cmdStatus() {
  const { data, error } = await supabase
    .from('processed_purchase_emails')
    .select('status, skip_reason, source');
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const skipped = rows.filter((r) => r.status === 'skipped');
  console.log(`\nReview Queue (status='skipped'): ${skipped.length} items`);
  const bySource = skipped.reduce<Record<string, number>>((a, r) => {
    a[r.source] = (a[r.source] ?? 0) + 1;
    return a;
  }, {});
  for (const [s, n] of Object.entries(bySource)) console.log(`  ${s}: ${n}`);
  const counts = rows.reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  console.log('\nAll statuses:');
  for (const [s, n] of Object.entries(counts).sort()) console.log(`  ${s}: ${n}`);
}

async function cmdFetch() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const items = (await pullQueueItems()).slice(0, LIMIT);
  console.log(`Found ${items.length} skipped items.`);
  if (items.length === 0) return;

  const cdp = await CDP.openTab();
  console.log('Connected to Chrome :9222.');
  const login = await verifyVintedLogin(cdp);
  if (!login.loggedIn) {
    console.error(`⚠ Vinted not logged in (landed on ${login.url}). Log into Vinted on the :9222 Chrome, then re-run fetch.`);
    await cdp.close();
    process.exit(2);
  }
  const conversations = await loadInboxConversations(cdp);
  console.log(`Loaded ${conversations.length} inbox conversations via /api/v2/inbox.`);
  if (conversations.length === 0) {
    console.warn('⚠ No conversations returned — Vinted likely not logged in on :9222. Aborting.');
    await cdp.close();
    process.exit(1);
  }

  const manifest: ManifestEntry[] = [];
  for (const item of items) {
    const dir = path.join(OUT_DIR, item.order_reference);
    fs.mkdirSync(dir, { recursive: true });
    const conv = item.seller_username
      ? conversations.find((c) => c.opposite_user?.login === item.seller_username) ?? null
      : null;

    let photoFiles: string[] = [];
    let listingUrl: string | null = null;
    let note = '';
    if (!conv) {
      note = item.seller_username
        ? `no inbox conversation for seller "${item.seller_username}"`
        : 'no seller_username on record';
    } else {
      const { listingUrl: lu, urls } = await scrapeListingPhotos(cdp, conv);
      listingUrl = lu;
      let n = 0;
      for (const url of urls) {
        const ext = url.includes('.png') ? 'png' : 'jpg';
        const dest = path.join(dir, `${String(n + 1).padStart(2, '0')}.${ext}`);
        if (await downloadPhoto(url, dest)) {
          photoFiles.push(path.relative(OUT_DIR, dest));
          n++;
        }
      }
      if (photoFiles.length === 0) note = 'conversation found but no photos downloaded';
    }

    console.log(
      `  ${item.order_reference}  ${item.seller_username ?? '?'}  "${item.item_name}"  → ${photoFiles.length} photos${note ? ' — ' + note : ''}`
    );
    manifest.push({
      ...item,
      conversation_id: conv?.id ?? null,
      conversation_description: conv?.description ?? null,
      listing_url: listingUrl,
      photo_files: photoFiles,
      photo_count: photoFiles.length,
      note,
    });
  }
  await cdp.close();

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const withPhotos = manifest.filter((m) => m.photo_count > 0).length;
  console.log(`\nManifest → ${MANIFEST_PATH}`);
  console.log(`${withPhotos}/${manifest.length} items have photos. ${manifest.length - withPhotos} need a fallback (web search / listing visit).`);
}

async function approveItem(d: Decision): Promise<{ ok: boolean; info: string }> {
  if (!d.items || d.items.length === 0) return { ok: false, info: 'no items[] for import' };
  const res = await fetch(`${LOCAL_APP}/api/purchases/review-queue/${d.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INTERNAL_API_KEY! },
    body: JSON.stringify({ items: d.items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, info: `HTTP ${res.status}: ${JSON.stringify(body)}` };
  const summary = (body.data?.items ?? [])
    .map(
      (i: any) =>
        `${i.set_number} (${i.set_name}) £${i.allocated_cost}${i.roi_percent != null ? ` ROI ${i.roi_percent}%` : ''}`
    )
    .join('; ');
  return { ok: true, info: summary || 'imported' };
}

async function dismissItem(d: Decision): Promise<{ ok: boolean; info: string }> {
  const { error } = await supabase
    .from('processed_purchase_emails')
    .update({ status: 'manual_skip', skip_reason: d.skip_reason ?? d.reason ?? 'dismissed' })
    .eq('id', d.id)
    .eq('status', 'skipped');
  return { ok: !error, info: error ? error.message : `dismissed (${d.skip_reason ?? d.reason ?? ''})` };
}

async function cmdApply() {
  if (!fs.existsSync(DECISIONS_PATH)) {
    console.error(`No decisions file at ${DECISIONS_PATH}`);
    process.exit(1);
  }
  const decisions: Decision[] = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  console.log(`${decisions.length} decisions loaded${DRY_RUN ? ' (DRY RUN)' : ''}.`);

  // Validate against live queue so we never act on an already-resolved id.
  const live = new Set((await pullQueueItems()).map((i) => i.id));
  let imports = 0,
    dismisses = 0,
    skipped = 0,
    failures = 0;

  for (const d of decisions) {
    if (!live.has(d.id)) {
      console.log(`  ~ ${d.id.slice(0, 8)} not in live queue — skipping`);
      skipped++;
      continue;
    }
    const label =
      d.action === 'import'
        ? `import ${d.items?.map((i) => i.set_number).join(',')}`
        : `dismiss (${d.skip_reason ?? d.reason ?? ''})`;
    if (DRY_RUN) {
      console.log(`  [dry] ${d.id.slice(0, 8)} → ${label}`);
      continue;
    }
    const r = d.action === 'import' ? await approveItem(d) : await dismissItem(d);
    console.log(`  ${r.ok ? '✓' : '✗'} ${d.id.slice(0, 8)} ${label} → ${r.info}`);
    if (!r.ok) failures++;
    else if (d.action === 'import') imports++;
    else dismisses++;
  }
  console.log(
    `\n${DRY_RUN ? 'Would apply' : 'Applied'}: ${imports} imports, ${dismisses} dismisses, ${skipped} already-resolved, ${failures} failures.`
  );
  if (failures > 0) process.exitCode = 1;
}

(async () => {
  try {
    if (cmd === 'status') await cmdStatus();
    else if (cmd === 'check') {
      const cdp = await CDP.openTab();
      const login = await verifyVintedLogin(cdp);
      await cdp.close();
      console.log(login.loggedIn ? `✓ Vinted logged in (${login.url})` : `✗ Vinted NOT logged in (${login.url})`);
      process.exit(login.loggedIn ? 0 : 2);
    } else if (cmd === 'fetch') await cmdFetch();
    else if (cmd === 'apply') await cmdApply();
    else {
      console.log('Usage: clear-review-queue.ts <status|check|fetch|apply> [--limit N] [--dry-run]');
      process.exit(1);
    }
  } catch (e) {
    console.error('FATAL:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
