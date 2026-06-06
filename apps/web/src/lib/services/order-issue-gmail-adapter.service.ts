/**
 * Gmail adapter for order-issues.
 *
 * Pulls messages from a single Gmail account that catches:
 * 1. Personal Gmail (chrishadley1983@gmail.com) inbound + outbound
 * 2. chris@hadleybricks.co.uk forwarded into the same Gmail
 * 3. Bricqer relay (shops+hadleybricks@bricqer.com) — inbound buyer messages and outbound seller messages
 * 4. BL/BO native message notifications relayed to email
 *
 * Strategy:
 *  - Per-issue sync: for each open issue, search Gmail for the platform_order_id and
 *    upsert messages via OrderIssueService.ingestAutomatedMessage (idempotent on Gmail message id).
 *  - Discovery: scan a broader window for "Bricklink Order #..." / "BrickOwl Order #..." subjects
 *    that don't yet correspond to an existing issue and auto-create from buyer-initiated messages (F19).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { Database } from '@hadley-bricks/database';
import { OrderIssueService } from './order-issue.service';
import { OrderIssueRepository } from '../repositories/order-issue.repository';
import { OrderRepository } from '../repositories/order.repository';
import type { OrderIssuePlatform } from '../schemas/order-issue.schema';

const OUTBOUND_FROM_PATTERNS = [
  /chrishadley1983@gmail\.com/i,
  /chris@hadleybricks\.co\.uk/i,
  /shops\+hadleybricks@bricqer\.com/i,
  /hadleybricks/i,
];

/**
 * Senders that produce automated platform notifications (order confirmations,
 * shipping updates, system messages). These should NOT trigger auto-issue
 * creation in the discovery pass — they're routine traffic, not problem reports.
 * They are still ingested via per-issue sync once an issue exists.
 */
const PLATFORM_NOTIFICATION_FROM_PATTERNS = [
  /blservice@bricklink\.com/i,
  /noreply@brickowl\.com/i,
  /no-reply@brickowl\.com/i,
  /noreply@bricklink\.com/i,
  /messages@bricklink\.com/i,
  /notifications?@brickowl\.com/i,
];

const ORDER_PATTERNS: Array<{ platform: OrderIssuePlatform; regex: RegExp }> = [
  { platform: 'bricklink', regex: /brick\s*link\s*order\s*#?\s*(\d{6,10})/gi },
  { platform: 'bricklink', regex: /\bBL\s+order\s*#?\s*(\d{6,10})/gi },
  { platform: 'brickowl', regex: /brick\s*owl\s*order\s*#?\s*(\d{4,10})/gi },
  { platform: 'brickowl', regex: /\bBO\s+order\s*#?\s*(\d{4,10})/gi },
];

export interface GmailSyncResult {
  issuesScanned: number;
  messagesIngested: number;
  messagesSkipped: number;
  issuesAutoCreated: number;
  discoveryCreated: number;
  errors: Array<{ issueId?: string; orderId?: string; error: string }>;
}

interface ParsedHeaders {
  messageId: string;
  date: string;
  subject: string;
  from: string;
  to: string;
}

export class OrderIssueGmailAdapter {
  private readonly issues: OrderIssueRepository;
  private readonly orders: OrderRepository;
  private readonly service: OrderIssueService;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.issues = new OrderIssueRepository(supabase);
    this.orders = new OrderRepository(supabase);
    this.service = new OrderIssueService(supabase);
  }

  static isConfigured(): boolean {
    return OrderIssueGmailAdapter.getAccountConfigs().length > 0;
  }

  /**
   * Resolve all configured Gmail accounts. The primary set uses GOOGLE_GMAIL_*;
   * the Workspace inbox uses GOOGLE_GMAIL_HB_* (chris@hadleybricks.co.uk).
   * Either or both may be present. Both share the same OAuth client by default
   * unless dedicated client/secret env vars are provided for the second account.
   */
  static getAccountConfigs(): Array<{
    label: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }> {
    const out: Array<{ label: string; clientId: string; clientSecret: string; refreshToken: string }> = [];
    const baseId = process.env.GOOGLE_GMAIL_CLIENT_ID;
    const baseSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    if (baseId && baseSecret && process.env.GOOGLE_GMAIL_REFRESH_TOKEN) {
      out.push({
        label: 'primary',
        clientId: baseId,
        clientSecret: baseSecret,
        refreshToken: process.env.GOOGLE_GMAIL_REFRESH_TOKEN,
      });
    }
    if (process.env.GOOGLE_GMAIL_HB_REFRESH_TOKEN) {
      out.push({
        label: 'hadleybricks',
        clientId: process.env.GOOGLE_GMAIL_HB_CLIENT_ID ?? baseId ?? '',
        clientSecret: process.env.GOOGLE_GMAIL_HB_CLIENT_SECRET ?? baseSecret ?? '',
        refreshToken: process.env.GOOGLE_GMAIL_HB_REFRESH_TOKEN,
      });
    }
    return out.filter((c) => c.clientId && c.clientSecret && c.refreshToken);
  }

  private getClients(): Array<{ label: string; client: gmail_v1.Gmail }> {
    return OrderIssueGmailAdapter.getAccountConfigs().map(({ label, clientId, clientSecret, refreshToken }) => {
      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ refresh_token: refreshToken });
      return { label, client: google.gmail({ version: 'v1', auth }) };
    });
  }

  /**
   * Run Gmail sync for a user. Pulls messages for every non-closed issue + discovers new ones.
   */
  async syncAll(
    userId: string,
    opts: { discoveryWindowDays?: number; perIssueLimit?: number; openOnly?: boolean } = {},
  ): Promise<GmailSyncResult> {
    const { discoveryWindowDays = 30, perIssueLimit = 50, openOnly = true } = opts;
    const result: GmailSyncResult = {
      issuesScanned: 0,
      messagesIngested: 0,
      messagesSkipped: 0,
      issuesAutoCreated: 0,
      discoveryCreated: 0,
      errors: [],
    };

    const clients = this.getClients();
    if (clients.length === 0) {
      result.errors.push({ error: 'Gmail not configured (missing GOOGLE_GMAIL_* env)' });
      return result;
    }

    // Per-issue sync — search every configured account, the service dedupes by external_message_id
    const { data: issues } = await this.issues.findByUser(userId, { openOnly }, { pageSize: 200 });
    for (const issue of issues) {
      let issueIngested = 0;
      let issueSkipped = 0;
      for (const { label, client } of clients) {
        try {
          const r = await this.syncIssue(client, userId, {
            id: issue.id,
            platform: issue.platform as OrderIssuePlatform,
            platform_order_id: issue.platform_order_id,
          }, perIssueLimit);
          issueIngested += r.ingested;
          issueSkipped += r.skipped;
        } catch (e) {
          result.errors.push({
            issueId: issue.id,
            orderId: issue.platform_order_id,
            error: `[${label}] ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      result.issuesScanned++;
      result.messagesIngested += issueIngested;
      result.messagesSkipped += issueSkipped;
    }

    // Discovery: find buyer-initiated messages with no matching issue, every account
    for (const { label, client } of clients) {
      try {
        const discovered = await this.discoverNewIssues(client, userId, discoveryWindowDays);
        result.discoveryCreated += discovered.created;
        result.messagesIngested += discovered.messagesIngested;
      } catch (e) {
        result.errors.push({ error: `[${label} discovery] ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    return result;
  }

  /**
   * Sync a single issue: search Gmail for the order # and ingest matching messages.
   */
  async syncIssue(
    client: gmail_v1.Gmail,
    userId: string,
    issue: { id: string; platform: OrderIssuePlatform; platform_order_id: string },
    limit: number,
  ): Promise<{ ingested: number; skipped: number }> {
    const query = `"${issue.platform_order_id}"`;
    const messages = await this.searchAll(client, query, limit);

    let ingested = 0;
    let skipped = 0;
    for (const meta of messages) {
      const headers = await this.getHeaders(client, meta.id);
      const body = await this.getBody(client, meta.id);
      const direction = this.inferDirection(headers.from, meta.labelIds);
      const source = this.inferSource(headers.from, headers.to);

      const ingestResult = await this.service.ingestAutomatedMessage(userId, {
        platform: issue.platform,
        platform_order_id: issue.platform_order_id,
        source,
        external_message_id: meta.id,
        direction,
        sent_at: this.parseDate(headers.date),
        from_address: headers.from,
        to_address: headers.to,
        subject: headers.subject,
        body,
      });

      if (ingestResult.skipped) skipped++;
      else ingested++;
    }
    return { ingested, skipped };
  }

  /**
   * Discovery pass: search broadly for messages mentioning BL/BO order numbers,
   * extract the order #, and ingest. The service auto-creates an issue if none exists
   * (F19) — discovered_by='buyer' for inbound, 'us' for outbound.
   */
  async discoverNewIssues(
    client: gmail_v1.Gmail,
    userId: string,
    windowDays: number,
  ): Promise<{ created: number; messagesIngested: number }> {
    const sinceDays = Math.max(1, windowDays);
    const queries = [
      `subject:"Bricklink Order" newer_than:${sinceDays}d`,
      `subject:"BrickLink Order" newer_than:${sinceDays}d`,
      `subject:"BrickOwl Order" newer_than:${sinceDays}d`,
      `subject:"Brick Owl Order" newer_than:${sinceDays}d`,
    ];

    let created = 0;
    let messagesIngested = 0;
    const seen = new Set<string>();

    for (const q of queries) {
      const messages = await this.searchAll(client, q, 100);
      for (const meta of messages) {
        if (seen.has(meta.id)) continue;
        seen.add(meta.id);
        const headers = await this.getHeaders(client, meta.id);
        const matches = OrderIssueGmailAdapter.extractOrderRefs(
          `${headers.subject}\n${meta.snippet ?? ''}`,
        );
        if (matches.length === 0) continue;

        const body = await this.getBody(client, meta.id);
        const direction = this.inferDirection(headers.from, meta.labelIds);
        const source = this.inferSource(headers.from, headers.to);
        const isPlatformNotification = PLATFORM_NOTIFICATION_FROM_PATTERNS.some((re) =>
          re.test(headers.from),
        );

        for (const ref of matches) {
          const before = await this.issues.findByPlatformOrderId(
            userId,
            ref.platform,
            ref.orderId,
          );
          // Skip auto-creation when the only signal is a platform notification —
          // those are routine traffic, not problem reports. Per-issue sync still
          // ingests them once an issue exists.
          if (!before && isPlatformNotification) continue;

          const result = await this.service.ingestAutomatedMessage(userId, {
            platform: ref.platform,
            platform_order_id: ref.orderId,
            source,
            external_message_id: meta.id,
            direction,
            sent_at: this.parseDate(headers.date),
            from_address: headers.from,
            to_address: headers.to,
            subject: headers.subject,
            body,
          });
          if (!result.skipped) messagesIngested++;
          if (!before && result.autoCreated) created++;
        }
      }
    }
    return { created, messagesIngested };
  }

  // ───────── Helpers ─────────

  private async searchAll(
    client: gmail_v1.Gmail,
    query: string,
    limit: number,
  ): Promise<Array<{ id: string; labelIds: string[]; snippet?: string }>> {
    const out: Array<{ id: string; labelIds: string[]; snippet?: string }> = [];
    let pageToken: string | undefined;
    while (out.length < limit) {
      const res = await client.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(limit - out.length, 100),
        pageToken,
      });
      const ids = res.data.messages ?? [];
      if (ids.length === 0) break;
      for (const m of ids) {
        if (!m.id) continue;
        const detail = await client.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID'],
        });
        out.push({
          id: m.id,
          labelIds: detail.data.labelIds ?? [],
          snippet: detail.data.snippet ?? undefined,
        });
        if (out.length >= limit) break;
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return out;
  }

  private async getHeaders(client: gmail_v1.Gmail, id: string): Promise<ParsedHeaders> {
    const detail = await client.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-ID'],
    });
    const headers = detail.data.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    return {
      messageId: get('Message-ID'),
      date: get('Date'),
      subject: get('Subject'),
      from: get('From'),
      to: get('To'),
    };
  }

  private async getBody(client: gmail_v1.Gmail, id: string): Promise<string> {
    try {
      const res = await client.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = res.data.payload;
      if (!payload) return '';
      let plain = '';
      let html = '';
      const walk = (part: gmail_v1.Schema$MessagePart) => {
        const mime = part.mimeType ?? '';
        if (mime === 'text/plain' && part.body?.data) {
          plain += Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (mime === 'text/html' && part.body?.data) {
          html += Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
        if (part.parts) for (const sub of part.parts) walk(sub);
      };
      walk(payload);
      if (!plain && !html && payload.body?.data) {
        plain = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }
      return plain || OrderIssueGmailAdapter.htmlToText(html);
    } catch {
      return '';
    }
  }

  private inferDirection(from: string, labelIds: string[]): 'inbound' | 'outbound' {
    if (labelIds.includes('SENT')) return 'outbound';
    for (const re of OUTBOUND_FROM_PATTERNS) {
      if (re.test(from)) return 'outbound';
    }
    return 'inbound';
  }

  /**
   * Detect whether a Gmail message arrived via the Bricqer relay so it can
   * be tagged with `source='bricqer'` for auditability. Otherwise default to
   * `source='gmail'`.
   */
  private inferSource(from: string, to: string): 'gmail' | 'bricqer' {
    const combined = `${from} ${to}`;
    if (/shops\+hadleybricks@bricqer\.com/i.test(combined) || /@bricqer\.com/i.test(combined)) {
      return 'bricqer';
    }
    return 'gmail';
  }

  private parseDate(rawDate: string): string {
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }

  static extractOrderRefs(
    text: string,
  ): Array<{ platform: OrderIssuePlatform; orderId: string }> {
    const out: Array<{ platform: OrderIssuePlatform; orderId: string }> = [];
    for (const { platform, regex } of ORDER_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const orderId = m[1];
        if (!out.some((o) => o.platform === platform && o.orderId === orderId)) {
          out.push({ platform, orderId });
        }
      }
    }
    return out;
  }

  static htmlToText(html: string): string {
    let text = html;
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n[ \t]+/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }
}
