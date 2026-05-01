import type {
  OrderIssueWithCounts,
  SalesOrderIssueRow,
  SalesOrderIssueItemRow,
  SalesOrderIssueMessageRow,
} from '@/lib/repositories';
import type {
  CreateOrderIssueInput,
  UpdateOrderIssueInput,
  AddOrderIssueItemInput,
  UpdateOrderIssueItemInput,
  CreateOrderIssueMessageInput,
  OrderIssuePlatform,
} from '@/lib/schemas/order-issue.schema';
import type { OrderLookupResult } from '@/lib/services';

export interface OrderIssueListResponse {
  data: OrderIssueWithCounts[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface OrderIssueDetail {
  issue: SalesOrderIssueRow;
  items: SalesOrderIssueItemRow[];
  messages: SalesOrderIssueMessageRow[];
}

export async function listOrderIssues(args: {
  openOnly?: boolean;
  platform?: OrderIssuePlatform;
  page?: number;
  pageSize?: number;
}): Promise<OrderIssueListResponse> {
  const params = new URLSearchParams();
  if (args.openOnly !== undefined) params.set('openOnly', String(args.openOnly));
  if (args.platform) params.set('platform', args.platform);
  if (args.page) params.set('page', String(args.page));
  if (args.pageSize) params.set('pageSize', String(args.pageSize));

  const res = await fetch(`/api/order-issues?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load order issues');
  return res.json();
}

export async function getOrderIssue(id: string): Promise<OrderIssueDetail> {
  const res = await fetch(`/api/order-issues/${id}`);
  if (!res.ok) throw new Error('Failed to load order issue');
  const json = await res.json();
  return json.data;
}

export async function createOrderIssue(input: CreateOrderIssueInput): Promise<OrderIssueDetail> {
  const res = await fetch('/api/order-issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to create order issue');
  }
  const json = await res.json();
  return { issue: json.data.issue, items: json.data.items, messages: [] };
}

export async function updateOrderIssue(
  id: string,
  patch: UpdateOrderIssueInput,
): Promise<SalesOrderIssueRow> {
  const res = await fetch(`/api/order-issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update order issue');
  const json = await res.json();
  return json.data;
}

export async function deleteOrderIssue(id: string): Promise<void> {
  const res = await fetch(`/api/order-issues/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete order issue');
}

export async function addOrderIssueItem(
  id: string,
  item: AddOrderIssueItemInput,
): Promise<SalesOrderIssueItemRow> {
  const res = await fetch(`/api/order-issues/${id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to add item');
  const json = await res.json();
  return json.data;
}

export async function updateOrderIssueItem(
  id: string,
  itemId: string,
  patch: UpdateOrderIssueItemInput,
): Promise<SalesOrderIssueItemRow> {
  const res = await fetch(`/api/order-issues/${id}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update item');
  const json = await res.json();
  return json.data;
}

export async function deleteOrderIssueItem(id: string, itemId: string): Promise<void> {
  const res = await fetch(`/api/order-issues/${id}/items/${itemId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete item');
}

export async function addOrderIssueMessage(
  id: string,
  message: CreateOrderIssueMessageInput,
): Promise<SalesOrderIssueMessageRow> {
  const res = await fetch(`/api/order-issues/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error('Failed to add message');
  const json = await res.json();
  return json.data;
}

export async function syncOrderIssueGmail(
  id: string,
): Promise<{ ingested: number; skipped: number }> {
  const res = await fetch(`/api/order-issues/${id}/sync`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Sync failed');
  }
  const json = await res.json();
  return json.data;
}

export async function lookupOrder(
  platform: OrderIssuePlatform,
  platformOrderId: string,
): Promise<OrderLookupResult> {
  const params = new URLSearchParams({ platform, platform_order_id: platformOrderId });
  const res = await fetch(`/api/order-issues/lookup-order?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Order not found');
  }
  const json = await res.json();
  return json.data;
}
