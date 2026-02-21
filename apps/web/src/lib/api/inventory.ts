import type {
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate,
} from '@hadley-bricks/database';

/**
 * Numeric range filter for cost, listing_value, sold amounts, etc.
 */
export interface NumericRangeFilter {
  min?: number;
  max?: number;
}

/**
 * Date range filter for purchase_date, listing_date, sold_date, etc.
 */
export interface DateRangeFilter {
  from?: string; // ISO date string
  to?: string; // ISO date string
}

/**
 * Empty/non-empty filter for any column
 */
export type EmptyFilter = 'empty' | 'not_empty';

export interface InventoryFilters {
  status?: string;
  condition?: string;
  platform?: string; // listing_platform
  salePlatform?: string; // sold_platform
  source?: string; // purchase source
  search?: string;
  purchaseId?: string;
  // Advanced numeric range filters
  costRange?: NumericRangeFilter;
  listingValueRange?: NumericRangeFilter;
  soldGrossRange?: NumericRangeFilter;
  soldNetRange?: NumericRangeFilter;
  profitRange?: NumericRangeFilter;
  soldFeesRange?: NumericRangeFilter;
  soldPostageRange?: NumericRangeFilter;
  // Date range filters
  purchaseDateRange?: DateRangeFilter;
  listingDateRange?: DateRangeFilter;
  soldDateRange?: DateRangeFilter;
  // Empty/non-empty filters
  storageLocationFilter?: EmptyFilter;
  amazonAsinFilter?: EmptyFilter;
  linkedLotFilter?: EmptyFilter;
  linkedOrderFilter?: EmptyFilter; // sold_order_id - has linked sales order
  notesFilter?: EmptyFilter;
  skuFilter?: EmptyFilter;
  ebayListingFilter?: EmptyFilter; // ebay_listing_id
  archiveLocationFilter?: EmptyFilter;
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

  // Basic filters
  if (filters?.status) params.set('status', filters.status);
  if (filters?.condition) params.set('condition', filters.condition);
  if (filters?.platform) params.set('platform', filters.platform);
  if (filters?.salePlatform) params.set('salePlatform', filters.salePlatform);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.purchaseId) params.set('purchaseId', filters.purchaseId);

  // Numeric range filters
  if (filters?.costRange?.min !== undefined) params.set('costMin', String(filters.costRange.min));
  if (filters?.costRange?.max !== undefined) params.set('costMax', String(filters.costRange.max));
  if (filters?.listingValueRange?.min !== undefined)
    params.set('listingValueMin', String(filters.listingValueRange.min));
  if (filters?.listingValueRange?.max !== undefined)
    params.set('listingValueMax', String(filters.listingValueRange.max));
  if (filters?.soldGrossRange?.min !== undefined)
    params.set('soldGrossMin', String(filters.soldGrossRange.min));
  if (filters?.soldGrossRange?.max !== undefined)
    params.set('soldGrossMax', String(filters.soldGrossRange.max));
  if (filters?.soldNetRange?.min !== undefined)
    params.set('soldNetMin', String(filters.soldNetRange.min));
  if (filters?.soldNetRange?.max !== undefined)
    params.set('soldNetMax', String(filters.soldNetRange.max));
  if (filters?.profitRange?.min !== undefined)
    params.set('profitMin', String(filters.profitRange.min));
  if (filters?.profitRange?.max !== undefined)
    params.set('profitMax', String(filters.profitRange.max));
  if (filters?.soldFeesRange?.min !== undefined)
    params.set('soldFeesMin', String(filters.soldFeesRange.min));
  if (filters?.soldFeesRange?.max !== undefined)
    params.set('soldFeesMax', String(filters.soldFeesRange.max));
  if (filters?.soldPostageRange?.min !== undefined)
    params.set('soldPostageMin', String(filters.soldPostageRange.min));
  if (filters?.soldPostageRange?.max !== undefined)
    params.set('soldPostageMax', String(filters.soldPostageRange.max));

  // Date range filters
  if (filters?.purchaseDateRange?.from)
    params.set('purchaseDateFrom', filters.purchaseDateRange.from);
  if (filters?.purchaseDateRange?.to) params.set('purchaseDateTo', filters.purchaseDateRange.to);
  if (filters?.listingDateRange?.from) params.set('listingDateFrom', filters.listingDateRange.from);
  if (filters?.listingDateRange?.to) params.set('listingDateTo', filters.listingDateRange.to);
  if (filters?.soldDateRange?.from) params.set('soldDateFrom', filters.soldDateRange.from);
  if (filters?.soldDateRange?.to) params.set('soldDateTo', filters.soldDateRange.to);

  // Empty/non-empty filters
  if (filters?.storageLocationFilter)
    params.set('storageLocationFilter', filters.storageLocationFilter);
  if (filters?.amazonAsinFilter) params.set('amazonAsinFilter', filters.amazonAsinFilter);
  if (filters?.linkedLotFilter) params.set('linkedLotFilter', filters.linkedLotFilter);
  if (filters?.linkedOrderFilter) params.set('linkedOrderFilter', filters.linkedOrderFilter);
  if (filters?.notesFilter) params.set('notesFilter', filters.notesFilter);
  if (filters?.skuFilter) params.set('skuFilter', filters.skuFilter);
  if (filters?.ebayListingFilter) params.set('ebayListingFilter', filters.ebayListingFilter);
  if (filters?.archiveLocationFilter)
    params.set('archiveLocationFilter', filters.archiveLocationFilter);

  // Pagination
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
    purchase_id: string | null;
    purchase_date: string | null;
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

/**
 * Bulk delete multiple inventory items
 */
export async function bulkDeleteInventoryItems(
  ids: string[]
): Promise<{ success: boolean; deleted: number }> {
  const response = await fetch('/api/inventory/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk delete inventory items');
  }

  return response.json();
}
