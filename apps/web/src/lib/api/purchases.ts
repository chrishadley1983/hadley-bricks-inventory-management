import type { Purchase, PurchaseInsert, PurchaseUpdate } from '@hadley-bricks/database';
import type { PaginationParams, PaginatedResponse } from './inventory';
import type { PurchaseProfitability } from '@/lib/services/purchase-profitability.service';

/**
 * Purchase search result for combobox lookup
 */
export interface PurchaseSearchResult {
  id: string;
  short_description: string;
  purchase_date: string;
  cost: number;
  source: string | null;
  reference: string | null;
  items_linked: number;
}

export interface PurchaseFilters {
  source?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/**
 * Search purchases by description, reference, or source
 * Used for the purchase lookup combobox
 */
export async function searchPurchases(
  query: string,
  limit?: number
): Promise<PurchaseSearchResult[]> {
  if (!query || query.length < 2) {
    return [];
  }

  const params = new URLSearchParams();
  params.set('q', query);
  if (limit) params.set('limit', String(limit));

  const response = await fetch(`/api/purchases/search?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to search purchases');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch purchases with optional filters and pagination
 */
export async function fetchPurchases(
  filters?: PurchaseFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Purchase>> {
  const params = new URLSearchParams();

  if (filters?.source) params.set('source', filters.source);
  if (filters?.paymentMethod) params.set('paymentMethod', filters.paymentMethod);
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.pageSize) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/purchases?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch purchases');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch a single purchase by ID
 */
export async function fetchPurchase(id: string): Promise<Purchase> {
  const response = await fetch(`/api/purchases/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch purchase');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Create a new purchase
 */
export async function createPurchase(
  data: Omit<PurchaseInsert, 'user_id'>
): Promise<Purchase> {
  const response = await fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create purchase');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Update a purchase
 */
export async function updatePurchase(
  id: string,
  data: PurchaseUpdate
): Promise<Purchase> {
  const response = await fetch(`/api/purchases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update purchase');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Delete a purchase
 */
export async function deletePurchase(id: string): Promise<void> {
  const response = await fetch(`/api/purchases/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete purchase');
  }
}

/**
 * Bulk update input type
 */
export interface BulkUpdatePurchaseInput {
  ids: string[];
  updates: Partial<{
    purchase_date: string | null;
    short_description: string | null;
    cost: number | null;
    source: string | null;
    payment_method: string | null;
    description: string | null;
    reference: string | null;
  }>;
}

/**
 * Bulk update multiple purchases
 */
export async function bulkUpdatePurchases(
  input: BulkUpdatePurchaseInput
): Promise<Purchase[]> {
  const response = await fetch('/api/purchases/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk update purchases');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Bulk delete multiple purchases
 */
export async function bulkDeletePurchases(ids: string[]): Promise<void> {
  const response = await fetch('/api/purchases/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk delete purchases');
  }
}

/**
 * Parsed purchase result from AI
 */
export interface ParsedPurchase {
  short_description: string;
  cost: number;
  source?: string;
  payment_method?: string;
  description?: string;
  purchase_date?: string;
  set_numbers?: string[];
  confidence: number;
}

/**
 * Parse natural language purchase description using AI
 */
export async function parsePurchase(text: string): Promise<ParsedPurchase> {
  const response = await fetch('/api/ai/parse-purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to parse purchase');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Calculate mileage between two postcodes
 */
export async function calculateMileage(
  fromPostcode: string,
  toPostcode: string
): Promise<{ distance: number; roundTrip: number }> {
  const response = await fetch('/api/ai/calculate-distance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromPostcode, toPostcode }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to calculate distance');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch profitability metrics for a purchase
 */
export async function fetchPurchaseProfitability(id: string): Promise<PurchaseProfitability> {
  const response = await fetch(`/api/purchases/${id}/profitability`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch purchase profitability');
  }

  const result = await response.json();
  return result.data;
}
