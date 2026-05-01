import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { PaginationOptions, PaginatedResult } from './base.repository';

type SalesOrderIssueRow = Database['public']['Tables']['sales_order_issues']['Row'];
type SalesOrderIssueInsert = Database['public']['Tables']['sales_order_issues']['Insert'];
type SalesOrderIssueUpdate = Database['public']['Tables']['sales_order_issues']['Update'];

type SalesOrderIssueItemRow = Database['public']['Tables']['sales_order_issue_items']['Row'];
type SalesOrderIssueItemInsert = Database['public']['Tables']['sales_order_issue_items']['Insert'];
type SalesOrderIssueItemUpdate = Database['public']['Tables']['sales_order_issue_items']['Update'];

type SalesOrderIssueMessageRow = Database['public']['Tables']['sales_order_issue_messages']['Row'];
type SalesOrderIssueMessageInsert =
  Database['public']['Tables']['sales_order_issue_messages']['Insert'];

const OPEN_STATUSES = ['open', 'awaiting_buyer', 'awaiting_us'] as const;

export interface OrderIssueFilters {
  openOnly?: boolean;
  platform?: 'bricklink' | 'brickowl';
  platformOrderId?: string;
}

export interface OrderIssueWithCounts extends SalesOrderIssueRow {
  item_count: number;
  message_count: number;
}

export class OrderIssueRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  // ───────── Issues (header) ─────────

  async findByUser(
    userId: string,
    filters: OrderIssueFilters = {},
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<OrderIssueWithCounts>> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase
      .from('sales_order_issues')
      .select(
        '*, sales_order_issue_items(count), sales_order_issue_messages(count)',
        { count: 'exact' },
      )
      .eq('user_id', userId);

    if (filters.openOnly) {
      query = query.in('issue_status', OPEN_STATUSES as unknown as string[]);
    }
    if (filters.platform) {
      query = query.eq('platform', filters.platform);
    }
    if (filters.platformOrderId) {
      query = query.eq('platform_order_id', filters.platformOrderId);
    }

    const { data, count, error } = await query
      .order('latest_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to list order issues: ${error.message}`);
    }

    const rows = (data ?? []) as Array<
      SalesOrderIssueRow & {
        sales_order_issue_items: Array<{ count: number }>;
        sales_order_issue_messages: Array<{ count: number }>;
      }
    >;

    const enriched: OrderIssueWithCounts[] = rows.map((r) => ({
      ...r,
      item_count: r.sales_order_issue_items?.[0]?.count ?? 0,
      message_count: r.sales_order_issue_messages?.[0]?.count ?? 0,
    }));

    const total = count ?? 0;
    return {
      data: enriched,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findById(id: string): Promise<SalesOrderIssueRow | null> {
    const { data, error } = await this.supabase
      .from('sales_order_issues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find order issue: ${error.message}`);
    }
    return data;
  }

  async findByPlatformOrderId(
    userId: string,
    platform: 'bricklink' | 'brickowl',
    platformOrderId: string,
  ): Promise<SalesOrderIssueRow | null> {
    const { data, error } = await this.supabase
      .from('sales_order_issues')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('platform_order_id', platformOrderId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find order issue by order id: ${error.message}`);
    }
    return data;
  }

  async insert(input: SalesOrderIssueInsert): Promise<SalesOrderIssueRow> {
    const { data, error } = await this.supabase
      .from('sales_order_issues')
      .insert(input)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create order issue: ${error.message}`);
    }
    return data;
  }

  async update(id: string, patch: SalesOrderIssueUpdate): Promise<SalesOrderIssueRow> {
    const { data, error } = await this.supabase
      .from('sales_order_issues')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update order issue: ${error.message}`);
    }
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('sales_order_issues').delete().eq('id', id);
    if (error) {
      throw new Error(`Failed to delete order issue: ${error.message}`);
    }
  }

  // ───────── Items ─────────

  async listItems(issueId: string): Promise<SalesOrderIssueItemRow[]> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_items')
      .select('*')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list issue items: ${error.message}`);
    }
    return data ?? [];
  }

  async insertItems(items: SalesOrderIssueItemInsert[]): Promise<SalesOrderIssueItemRow[]> {
    if (items.length === 0) return [];
    const { data, error } = await this.supabase
      .from('sales_order_issue_items')
      .insert(items)
      .select();

    if (error) {
      throw new Error(`Failed to insert issue items: ${error.message}`);
    }
    return data ?? [];
  }

  async updateItem(
    itemId: string,
    patch: SalesOrderIssueItemUpdate,
  ): Promise<SalesOrderIssueItemRow> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_items')
      .update(patch)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update issue item: ${error.message}`);
    }
    return data;
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sales_order_issue_items')
      .delete()
      .eq('id', itemId);
    if (error) {
      throw new Error(`Failed to delete issue item: ${error.message}`);
    }
  }

  // ───────── Messages ─────────

  async listMessages(issueId: string): Promise<SalesOrderIssueMessageRow[]> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_messages')
      .select('*')
      .eq('issue_id', issueId)
      .order('sent_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list issue messages: ${error.message}`);
    }
    return data ?? [];
  }

  async insertMessage(
    message: SalesOrderIssueMessageInsert,
  ): Promise<SalesOrderIssueMessageRow> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_messages')
      .insert(message)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to insert issue message: ${error.message}`);
    }
    return data;
  }

  async findMessageByExternalId(
    source: string,
    externalMessageId: string,
  ): Promise<SalesOrderIssueMessageRow | null> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_messages')
      .select('*')
      .eq('source', source)
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to lookup message by external id: ${error.message}`);
    }
    return data;
  }

  async listMessagesByFingerprint(
    fingerprint: string,
  ): Promise<SalesOrderIssueMessageRow[]> {
    const { data, error } = await this.supabase
      .from('sales_order_issue_messages')
      .select('*')
      .eq('content_fingerprint', fingerprint)
      .order('sent_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list messages by fingerprint: ${error.message}`);
    }
    return data ?? [];
  }

  async setDuplicateOf(messageId: string, canonicalId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sales_order_issue_messages')
      .update({ duplicate_of_id: canonicalId })
      .eq('id', messageId);
    if (error) {
      throw new Error(`Failed to set duplicate_of_id: ${error.message}`);
    }
  }
}

export type {
  SalesOrderIssueRow,
  SalesOrderIssueInsert,
  SalesOrderIssueUpdate,
  SalesOrderIssueItemRow,
  SalesOrderIssueItemInsert,
  SalesOrderIssueItemUpdate,
  SalesOrderIssueMessageRow,
  SalesOrderIssueMessageInsert,
};
