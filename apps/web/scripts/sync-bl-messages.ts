/**
 * BrickLink message scraper for order-issues.
 *
 * BrickLink's official API does NOT expose message threads, so this scraper
 * uses local Chrome via CDP (port 9222) to navigate the BL inbox/order pages
 * for each open BL issue and extract the message thread.
 *
 * MUST run on a machine with the dedicated CDP Chrome already launched and
 * logged in to BrickLink. Same prerequisite as bl-basket.ts.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/sync-bl-messages.ts
 *   npx tsx scripts/sync-bl-messages.ts --order-id=31411686    # single order
 *   npx tsx scripts/sync-bl-messages.ts --user-id=<uuid>       # override SERVICE_USER_ID
 *
 * NOTE on DOM selectors: BrickLink's pages are legacy ASP and the message
 * panel structure varies. The script tries the order-detail "Message" tab first
 * (newer URL), falling back to messageInbox by order. If either pattern misses
 * messages, run with --debug to dump the page HTML and adjust the selectors.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { OrderIssueService } from '../src/lib/services/order-issue.service';
import type { Database } from '@hadley-bricks/database';

const CDP_PORT = 9222;

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const SINGLE_ORDER_ID = argv['order-id'];
const USER_ID =
  argv['user-id'] && argv['user-id'] !== 'true'
    ? argv['user-id']
    : process.env.SERVICE_USER_ID;
const DEBUG = argv['debug'] === 'true';

if (!USER_ID) {
  console.error('SERVICE_USER_ID env not set and --user-id not provided');
  process.exit(1);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(wsUrl: string): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => resolve());
      this.ws!.once('error', (err) => reject(err));
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message));
        else handler.resolve(msg.result);
      }
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{
      result?: { value?: T };
      exceptionDetails?: { text: string };
    }>('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }

  async navigate(url: string, waitMs = 3000) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const state = await this.evaluate<string>('document.readyState');
      if (state === 'complete') break;
    }
    await sleep(waitMs);
  }

  close() {
    this.ws?.close();
  }
}

async function connectCdp(): Promise<CDPClient> {
  const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    .then((r) => r.json())
    .catch(() => null);
  if (!version?.Browser) {
    console.error(
      `[cdp] Chrome CDP not reachable on :${CDP_PORT}. Start the dedicated CDP Chrome and log in to BrickLink first.`,
    );
    process.exit(1);
  }
  const tabs = (await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json())) as Array<{
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }>;
  const blPage = tabs.find((t) => t.type === 'page' && t.url.includes('bricklink.com'));
  const anyPage = tabs.find((t) => t.type === 'page');
  const wsUrl = (blPage ?? anyPage)?.webSocketDebuggerUrl;
  if (!wsUrl) {
    console.error('[cdp] No page tab available');
    process.exit(1);
  }
  const cdp = new CDPClient();
  await cdp.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

interface ScrapedMessage {
  externalId: string;
  sentAt: string;
  fromName: string;
  direction: 'inbound' | 'outbound';
  subject: string;
  body: string;
}

/**
 * Scrape messages for a single BL order from `orderDetail.asp?ID={id}`.
 *
 * BL's legacy DOM layout: messages live below a `<a name="orderMsg">` anchor in
 * an HTML table. Each message is two consecutive rows:
 *   - gray row (#EEEEEE): two <td>s containing "from: <username>" and
 *     "Sent on: <Mon DD, YYYY HH:MM>"
 *   - white row (#FFFFFF): single <td colspan="2"> containing the body
 */
async function scrapeOrderMessages(
  cdp: CDPClient,
  orderId: string,
): Promise<ScrapedMessage[]> {
  await cdp.navigate(`https://www.bricklink.com/orderDetail.asp?ID=${orderId}`, 4000);

  if (DEBUG) {
    const html = await cdp.evaluate<string>(`document.body.innerHTML.slice(0, 5000)`);
    console.log(`[debug] Order ${orderId} HTML head:\n${html}\n`);
  }

  const messages = await cdp.evaluate<ScrapedMessage[]>(
    `(() => {
       const out = [];
       // Find the message section anchor
       const anchor = document.querySelector('a[name="orderMsg"]');
       if (!anchor) return out;
       // Walk forward to find the message table — usually the next table sibling
       // after the anchor's containing block
       let scope = anchor.closest('table') || anchor.parentElement;
       // Look in a generous window for tr pairs with bgcolor="#EEEEEE"
       const allRows = Array.from(document.querySelectorAll('tr[bgcolor]'));
       for (let i = 0; i < allRows.length; i++) {
         const r = allRows[i];
         const bg = (r.getAttribute('bgcolor') || '').toUpperCase();
         if (bg !== '#EEEEEE') continue;
         const tds = r.querySelectorAll('td');
         if (tds.length < 2) continue;
         const t0 = (tds[0].textContent || '').trim();
         const t1 = (tds[1].textContent || '').trim();
         const fromMatch = /from:\\s*([^\\n]+)/i.exec(t0);
         const dateMatch = /sent on:\\s*([^\\n]+)/i.exec(t1);
         if (!fromMatch || !dateMatch) continue;
         const fromName = fromMatch[1].trim();
         const sentRaw = dateMatch[1].trim();
         // The next row should be the body (#FFFFFF)
         const bodyRow = allRows[i + 1];
         if (!bodyRow) continue;
         const body = (bodyRow.querySelector('td')?.textContent || '').trim();
         if (!body) continue;
         let sentAt;
         try {
           const d = new Date(sentRaw);
           sentAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
         } catch (_) {
           sentAt = new Date().toISOString();
         }
         out.push({
           externalId: 'bricklink-' + '${orderId}' + '-' + sentAt + '|' + fromName,
           sentAt,
           fromName,
           direction: /^hadleybric/i.test(fromName) ? 'outbound' : 'inbound',
           subject: '',
           body,
         });
       }
       // Dedup by externalId
       const seen = new Set();
       return out.filter(m => { if (seen.has(m.externalId)) return false; seen.add(m.externalId); return true; });
     })()`,
  );

  return messages;
}

(async () => {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const service = new OrderIssueService(supabase);

  // Load issues to scrape
  let issues: Array<{ id: string; platform_order_id: string }> = [];
  if (SINGLE_ORDER_ID) {
    issues = [{ id: 'manual', platform_order_id: SINGLE_ORDER_ID }];
  } else {
    const { data } = await supabase
      .from('sales_order_issues')
      .select('id, platform_order_id')
      .eq('user_id', USER_ID!)
      .eq('platform', 'bricklink')
      .in('issue_status', ['open', 'awaiting_buyer', 'awaiting_us']);
    issues = data ?? [];
  }

  if (issues.length === 0) {
    console.log('No open BrickLink issues to scrape.');
    return;
  }

  console.log(`Scraping ${issues.length} BL order(s) via CDP...`);
  const cdp = await connectCdp();

  let totalIngested = 0;
  let totalSkipped = 0;
  for (const issue of issues) {
    try {
      console.log(`  → ${issue.platform_order_id}`);
      const messages = await scrapeOrderMessages(cdp, issue.platform_order_id);
      console.log(`    found ${messages.length} message(s)`);
      for (const m of messages) {
        const result = await service.ingestAutomatedMessage(USER_ID!, {
          platform: 'bricklink',
          platform_order_id: issue.platform_order_id,
          source: 'bricklink',
          external_message_id: m.externalId,
          direction: m.direction,
          sent_at: m.sentAt,
          from_address: m.fromName,
          subject: m.subject,
          body: m.body,
        });
        if (result.skipped) totalSkipped++;
        else totalIngested++;
      }
    } catch (e) {
      console.error(`    ✗ ${issue.platform_order_id}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(2000);
  }
  cdp.close();

  console.log(`\nDone. Ingested ${totalIngested} new, skipped ${totalSkipped} duplicate.`);
})();
