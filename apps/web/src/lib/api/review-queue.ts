/**
 * API client for the email purchase review queue.
 */

export interface ReviewQueueItem {
  id: string;
  email_id: string;
  source: string;
  order_reference: string | null;
  email_subject: string | null;
  email_date: string | null;
  item_name: string | null;
  cost: number | null;
  seller_username: string | null;
  skip_reason: string | null;
  processed_at: string;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApproveReviewItemInput {
  set_number: string;
  condition?: 'New' | 'Used';
}

export interface ApproveReviewInput {
  items: ApproveReviewItemInput[];
}

export interface ApproveReviewResultItem {
  inventory_id: string;
  set_number: string;
  set_name: string;
  allocated_cost: number;
  list_price: number | null;
  roi_percent: number | null;
  amazon_asin: string | null;
}

export interface ApproveReviewResult {
  purchase_id: string;
  items: ApproveReviewResultItem[];
}

export interface BulkDismissResult {
  dismissed_count: number;
  ids: string[];
}

export async function fetchReviewQueue(page = 1, pageSize = 50): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const response = await fetch(`/api/purchases/review-queue?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch review queue');
  }

  const result = await response.json();
  return result.data;
}

export async function approveReviewItem(
  id: string,
  data: ApproveReviewInput
): Promise<ApproveReviewResult> {
  const response = await fetch(`/api/purchases/review-queue/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to approve review item');
  }

  const result = await response.json();
  return result.data;
}

export async function dismissReviewItem(id: string): Promise<{ id: string; status: string }> {
  const response = await fetch(`/api/purchases/review-queue/${id}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to dismiss review item');
  }

  const result = await response.json();
  return result.data;
}

export async function bulkDismissReviewItems(ids: string[]): Promise<BulkDismissResult> {
  const response = await fetch('/api/purchases/review-queue/bulk-dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk dismiss');
  }

  const result = await response.json();
  return result.data;
}
