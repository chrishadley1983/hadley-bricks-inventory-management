import type { InventoryItem, InventoryItemInsert, InventoryItemUpdate } from '@hadley-bricks/database';

export interface InventoryFilters {
  status?: string;
  condition?: string;
  search?: string;
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

export interface InventorySummary {
  totalItems: number;
  byStatus: Record<string, number>;
  totalCost: number;
  totalListingValue: number;
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
  if (filters?.search) params.set('search', filters.search);
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
export async function fetchInventorySummary(): Promise<InventorySummary> {
  const response = await fetch('/api/inventory/summary');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch inventory summary');
  }

  const result = await response.json();
  return result.data;
}
