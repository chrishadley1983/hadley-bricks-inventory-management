import type { InventoryItem, InventoryItemInsert, InventoryItemUpdate } from '@hadley-bricks/database';

export interface InventoryFilters {
  status?: string;
  condition?: string;
  platform?: string;
  search?: string;
  purchaseId?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StatusValue {
  cost: number;
  listingValue: number;
  count: number;
}

export interface InventorySummary {
  totalItems: number;
  byStatus: Record<string, number>;
  totalCost: number;
  totalListingValue: number;
  valueByStatus: Record<string, StatusValue>;
}

/**
 * Fetch inventory items with optional filters and pagination
 */
export async function fetchInventory(
  filters?: InventoryFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<InventoryItem>> {
  const params = new URLSearchParams();

  if (filters?.status) params.set('status', filters.status);
  if (filters?.condition) params.set('condition', filters.condition);
  if (filters?.platform) params.set('platform', filters.platform);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.purchaseId) params.set('purchaseId', filters.purchaseId);
  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.pageSize) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/inventory?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch inventory');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch a single inventory item by ID
 */
export async function fetchInventoryItem(id: string): Promise<InventoryItem> {
  const response = await fetch(`/api/inventory/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch inventory item');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Create a new inventory item
 */
export async function createInventoryItem(
  data: Omit<InventoryItemInsert, 'user_id'>
): Promise<InventoryItem> {
  const response = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create inventory item');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Update an inventory item
 */
export async function updateInventoryItem(
  id: string,
  data: InventoryItemUpdate
): Promise<InventoryItem> {
  const response = await fetch(`/api/inventory/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update inventory item');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Delete an inventory item
 */
export async function deleteInventoryItem(id: string): Promise<void> {
  const response = await fetch(`/api/inventory/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete inventory item');
  }
}

/**
 * Fetch inventory summary statistics
 */
export async function fetchInventorySummary(options?: {
  excludeSold?: boolean;
  platform?: string;
}): Promise<InventorySummary> {
  const params = new URLSearchParams();
  if (options?.excludeSold) params.set('excludeSold', 'true');
  if (options?.platform) params.set('platform', options.platform);

  const url = `/api/inventory/summary${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch inventory summary');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch distinct listing platforms
 */
export async function fetchPlatforms(): Promise<string[]> {
  const response = await fetch('/api/inventory/platforms');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch platforms');
  }

  const result = await response.json();
  return result.data;
}

export interface BulkUpdateInput {
  ids: string[];
  updates: Partial<{
    storage_location: string | null;
    linked_lot: string | null;
    notes: string | null;
    condition: 'New' | 'Used' | null;
    status: string | null;
    source: string | null;
    listing_platform: string | null;
  }>;
}

/**
 * Bulk update multiple inventory items
 */
export async function bulkUpdateInventoryItems(
  input: BulkUpdateInput
): Promise<{ data: InventoryItem[]; updated: number }> {
  const response = await fetch('/api/inventory/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk update inventory items');
  }

  return response.json();
}
