import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import {
  OrderIssueRepository,
  OrderRepository,
  type OrderIssueFilters,
  type OrderIssueWithCounts,
  type SalesOrderIssueRow,
  type SalesOrderIssueItemRow,
  type SalesOrderIssueMessageRow,
} from '../repositories';
import type { PaginatedResult } from '../repositories/base.repository';
import type {
  CreateOrderIssueInput,
  UpdateOrderIssueInput,
  AddOrderIssueItemInput,
  UpdateOrderIssueItemInput,
  CreateOrderIssueMessageInput,
  OrderIssuePlatform,
} from '../schemas/order-issue.schema';

export class OrderNotFoundError extends Error {
  constructor(platform: OrderIssuePlatform, platformOrderId: string) {
    super(`Order not found: ${platform} order ${platformOrderId} is not in platform_orders`);
    this.name = 'OrderNotFoundError';
  }
}

export interface OrderLookupResult {
  platform_orders_id: string;
  platform: OrderIssuePlatform;
  platform_order_id: string;
  buyer_name: string | null;
  buyer_username: string | null;
  buyer_email: string | null;
  order_date: string | null;
  order_status: string | null;
  items: Array<{
    order_item_id: string;
    item_number: string;
    item_name: string | null;
    item_type: string | null;
    color_id: number | null;
    color_name: string | null;
    condition: 'New' | 'Used' | null;
    quantity: number;
  }>;
}

export class OrderIssueService {
  private readonly issues: OrderIssueRepository;
  private readonly orders: OrderRepository;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.issues = new OrderIssueRepository(supabase);
    this.orders = new OrderRepository(supabase);
  }

  async list(
    userId: string,
    filters: OrderIssueFilters = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<PaginatedResult<OrderIssueWithCounts>> {
    return this.issues.findByUser(userId, filters, options);
  }

  async getById(userId: string, id: string) {
    const issue = await this.issues.findById(id);
    if (!issue || issue.user_id !== userId) {
      return null;
    }
    const [items, messages] = await Promise.all([
      this.issues.listItems(id),
      this.issues.listMessages(id),
    ]);
    return { issue, items, messages };
  }

  /**
   * Look up a BL/BO sales order by platform_order_id.
   * Used to seed the new-issue form (buyer header + lots picker).
   * Throws OrderNotFoundError if no matching platform_orders row exists.
   */
  async lookupOrder(
    userId: string,
    platform: OrderIssuePlatform,
    platformOrderId: string,
  ): Promise<OrderLookupResult> {
    const order = await this.orders.findByPlatformOrderId(userId, platform, platformOrderId);
    if (!order) {
      throw new OrderNotFoundError(platform, platformOrderId);
    }
    const items = await this.orders.getOrderItems(order.id);
    return {
      platform_orders_id: order.id,
      platform,
      platform_order_id: order.platform_order_id,
      buyer_name: order.buyer_name ?? null,
      buyer_username: null,
      buyer_email: order.buyer_email ?? null,
      order_date: order.order_date ?? null,
      order_status: order.status ?? null,
      items: items.map((it) => ({
        order_item_id: it.id,
        item_number: it.item_number,
        item_name: it.item_name,
        item_type: it.item_type,
        color_id: it.color_id,
        color_name: it.color_name,
        condition: it.condition as 'New' | 'Used' | null,
        quantity: it.quantity,
      })),
    };
  }

  async create(
    userId: string,
    input: CreateOrderIssueInput,
  ): Promise<{
    issue: SalesOrderIssueRow;
    items: SalesOrderIssueItemRow[];
  }> {
    // Resolve order header from platform_orders (or fail with E2)
    const lookup = await this.lookupOrder(userId, input.platform, input.platform_order_id);

    const issue = await this.issues.insert({
      user_id: userId,
      platform: input.platform,
      platform_order_id: input.platform_order_id,
      platform_order_uuid: lookup.platform_orders_id,
      buyer_name: lookup.buyer_name,
      buyer_username: lookup.buyer_username,
      buyer_email: lookup.buyer_email,
      order_date: lookup.order_date,
      order_status: lookup.order_status,
      discovered_by: input.discovered_by,
      issue_status: input.issue_status ?? 'open',
      planned_resolution: input.planned_resolution ?? null,
    });

    const itemRows = await this.issues.insertItems(
      input.items.map((item) => ({
        issue_id: issue.id,
        order_item_id: item.order_item_id ?? null,
        item_number: item.item_number,
        item_name: item.item_name ?? null,
        item_type: item.item_type ?? null,
        color_id: item.color_id ?? null,
        color_name: item.color_name ?? null,
        condition: item.condition ?? null,
        qty_expected: item.qty_expected,
        qty_received: item.qty_received,
        issue_type: item.issue_type,
        notes: item.notes ?? null,
      })),
    );

    return { issue, items: itemRows };
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateOrderIssueInput,
  ): Promise<SalesOrderIssueRow> {
    const existing = await this.issues.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    return this.issues.update(id, patch);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.issues.findById(id);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    await this.issues.remove(id);
  }

  async addItem(
    userId: string,
    issueId: string,
    item: AddOrderIssueItemInput,
  ): Promise<SalesOrderIssueItemRow> {
    const existing = await this.issues.findById(issueId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    const [row] = await this.issues.insertItems([
      {
        issue_id: issueId,
        order_item_id: item.order_item_id ?? null,
        item_number: item.item_number,
        item_name: item.item_name ?? null,
        item_type: item.item_type ?? null,
        color_id: item.color_id ?? null,
        color_name: item.color_name ?? null,
        condition: item.condition ?? null,
        qty_expected: item.qty_expected,
        qty_received: item.qty_received,
        issue_type: item.issue_type,
        notes: item.notes ?? null,
      },
    ]);
    return row;
  }

  async updateItem(
    userId: string,
    issueId: string,
    itemId: string,
    patch: UpdateOrderIssueItemInput,
  ): Promise<SalesOrderIssueItemRow> {
    const existing = await this.issues.findById(issueId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    return this.issues.updateItem(itemId, patch);
  }

  async removeItem(userId: string, issueId: string, itemId: string): Promise<void> {
    const existing = await this.issues.findById(issueId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    await this.issues.removeItem(itemId);
  }

  async listMessages(
    userId: string,
    issueId: string,
  ): Promise<SalesOrderIssueMessageRow[]> {
    const existing = await this.issues.findById(issueId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    return this.issues.listMessages(issueId);
  }

  async addMessage(
    userId: string,
    issueId: string,
    message: CreateOrderIssueMessageInput,
  ): Promise<SalesOrderIssueMessageRow> {
    const existing = await this.issues.findById(issueId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Order issue not found');
    }
    return this.issues.insertMessage({
      issue_id: issueId,
      source: message.source,
      external_message_id: message.external_message_id ?? null,
      direction: message.direction,
      sent_at: message.sent_at,
      from_address: message.from_address ?? null,
      to_address: message.to_address ?? null,
      subject: message.subject ?? null,
      body: message.body ?? null,
      body_html: message.body_html ?? null,
      attachments: (message.attachments ?? null) as
        | Database['public']['Tables']['sales_order_issue_messages']['Insert']['attachments']
        | null,
      content_fingerprint:
        message.content_fingerprint ??
        OrderIssueService.computeFingerprint({
          direction: message.direction,
          sent_at: message.sent_at,
          body: message.body ?? message.subject ?? '',
        }),
    });
  }

  /**
   * Ingest a message from an automated source (Gmail/BL/BO/Bricqer).
   * - Idempotent on (source, external_message_id)
   * - Auto-creates issue if buyer-initiated message arrives for an order with no existing issue (F19)
   */
  async ingestAutomatedMessage(
    userId: string,
    args: {
      platform: OrderIssuePlatform;
      platform_order_id: string;
      source: 'gmail' | 'bricklink' | 'brickowl' | 'bricqer';
      external_message_id: string;
      direction: 'inbound' | 'outbound';
      sent_at: string;
      from_address?: string | null;
      to_address?: string | null;
      subject?: string | null;
      body?: string | null;
      body_html?: string | null;
      attachments?: unknown;
    },
  ): Promise<{
    issue: SalesOrderIssueRow | null;
    message: SalesOrderIssueMessageRow | null;
    autoCreated: boolean;
    skipped: boolean;
  }> {
    // Idempotency: skip if already ingested
    const existingMsg = await this.issues.findMessageByExternalId(
      args.source,
      args.external_message_id,
    );

    let issue = await this.issues.findByPlatformOrderId(
      userId,
      args.platform,
      args.platform_order_id,
    );

    let autoCreated = false;
    if (!issue) {
      // Sales-side guard: only auto-create issues for orders we actually SOLD.
      // Without a matching platform_orders row, this message refers to an order
      // we bought (or one that isn't in our system) — `sales_order_issues` should
      // not capture those. Return skipped:true so the adapter can move on.
      const lookup = await this.orders
        .findByPlatformOrderId(userId, args.platform, args.platform_order_id)
        .catch(() => null);
      if (!lookup) {
        return { issue: null, message: null, autoCreated: false, skipped: true };
      }

      // F19: auto-create if buyer-initiated; for outbound-only seeds (us writing first)
      // we still create with discovered_by='us' so the message has somewhere to land.
      const discoveredBy: 'us' | 'buyer' = args.direction === 'inbound' ? 'buyer' : 'us';
      const initialStatus: 'awaiting_us' | 'awaiting_buyer' =
        args.direction === 'inbound' ? 'awaiting_us' : 'awaiting_buyer';

      issue = await this.issues.insert({
        user_id: userId,
        platform: args.platform,
        platform_order_id: args.platform_order_id,
        platform_order_uuid: lookup.id,
        buyer_name: lookup.buyer_name ?? null,
        buyer_username: null,
        buyer_email: lookup.buyer_email ?? null,
        order_date: lookup.order_date ?? null,
        order_status: lookup.status ?? null,
        discovered_by: discoveredBy,
        issue_status: initialStatus,
      });
      autoCreated = true;
    }

    if (existingMsg) {
      return { issue, message: existingMsg, autoCreated, skipped: true };
    }

    const message = await this.issues.insertMessage({
      issue_id: issue.id,
      source: args.source,
      external_message_id: args.external_message_id,
      direction: args.direction,
      sent_at: args.sent_at,
      from_address: args.from_address ?? null,
      to_address: args.to_address ?? null,
      subject: args.subject ?? null,
      body: args.body ?? null,
      body_html: args.body_html ?? null,
      attachments: (args.attachments ??
        null) as Database['public']['Tables']['sales_order_issue_messages']['Insert']['attachments'],
      content_fingerprint: OrderIssueService.computeFingerprint({
        direction: args.direction,
        sent_at: args.sent_at,
        body: args.body ?? args.subject ?? '',
      }),
    });

    return { issue, message, autoCreated, skipped: false };
  }

  /**
   * Idempotent dedup pass: groups messages by content_fingerprint, marks
   * later rows as duplicate_of the earliest (by sent_at).
   */
  async runDedup(userId: string): Promise<{ groupsProcessed: number; duplicatesMarked: number }> {
    // Get all of this user's issues, then page through their messages by fingerprint
    const { data: issueIds } = (await this.supabase
      .from('sales_order_issues')
      .select('id')
      .eq('user_id', userId)) as { data: Array<{ id: string }> | null };

    const ids = (issueIds ?? []).map((r) => r.id);
    if (ids.length === 0) return { groupsProcessed: 0, duplicatesMarked: 0 };

    const { data: msgs, error } = await this.supabase
      .from('sales_order_issue_messages')
      .select('id, content_fingerprint, sent_at, duplicate_of_id')
      .in('issue_id', ids)
      .not('content_fingerprint', 'is', null);
    if (error) throw new Error(`Dedup load failed: ${error.message}`);

    const groups = new Map<
      string,
      Array<{ id: string; sent_at: string; duplicate_of_id: string | null }>
    >();
    for (const m of msgs ?? []) {
      if (!m.content_fingerprint) continue;
      const arr = groups.get(m.content_fingerprint) ?? [];
      arr.push({ id: m.id, sent_at: m.sent_at, duplicate_of_id: m.duplicate_of_id ?? null });
      groups.set(m.content_fingerprint, arr);
    }

    let groupsProcessed = 0;
    let duplicatesMarked = 0;
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      groupsProcessed++;
      const sorted = [...members].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
      const canonical = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        if (dup.duplicate_of_id === canonical.id) continue;
        await this.issues.setDuplicateOf(dup.id, canonical.id);
        duplicatesMarked++;
      }
    }

    return { groupsProcessed, duplicatesMarked };
  }

  static computeFingerprint(args: {
    direction: 'inbound' | 'outbound';
    sent_at: string;
    body: string;
  }): string {
    // Round to nearest minute so near-duplicates (relayed within seconds) collide
    const minute = new Date(args.sent_at).toISOString().slice(0, 16);
    const normalisedBody = args.body
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 500);
    return createHash('sha256')
      .update(`${args.direction}|${minute}|${normalisedBody}`)
      .digest('hex');
  }
}
