import type { Database } from '@hadley-bricks/database';
import type { PaginationParams, PaginatedResponse } from './inventory';

type MileageTracking = Database['public']['Tables']['mileage_tracking']['Row'];

export type ExpenseType = 'mileage' | 'parking' | 'toll' | 'other';

export interface MileageFilters {
  purchaseId?: string;
  expenseType?: ExpenseType;
  dateFrom?: string;
  dateTo?: string;
}

export interface MileageSummary {
  entries: MileageTracking[];
  totalMiles: number;
  totalMileageCost: number;
  totalOtherCosts: number;
  totalCost: number;
}

export interface CreateMileageInput {
  purchaseId?: string;
  trackingDate: string;
  destinationPostcode: string;
  milesTravelled: number;
  amountClaimed?: number;
  reason: string;
  expenseType: ExpenseType;
  notes?: string;
}

export interface UpdateMileageInput {
  trackingDate?: string;
  destinationPostcode?: string;
  milesTravelled?: number;
  amountClaimed?: number;
  reason?: string;
  expenseType?: ExpenseType;
  notes?: string | null;
}

/**
 * Fetch mileage entries for a purchase
 */
export async function fetchMileageForPurchase(purchaseId: string): Promise<MileageSummary> {
  const response = await fetch(`/api/mileage?purchaseId=${purchaseId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch mileage');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch mileage entries with filters and pagination
 */
export async function fetchMileageList(
  filters?: MileageFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<MileageTracking>> {
  const params = new URLSearchParams();

  if (filters?.purchaseId) params.set('purchaseId', filters.purchaseId);
  if (filters?.expenseType) params.set('expenseType', filters.expenseType);
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.pageSize) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/mileage?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch mileage');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch a single mileage entry
 */
export async function fetchMileageEntry(id: string): Promise<MileageTracking> {
  const response = await fetch(`/api/mileage/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch mileage entry');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Create a new mileage entry
 */
export async function createMileageEntry(data: CreateMileageInput): Promise<MileageTracking> {
  const response = await fetch('/api/mileage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create mileage entry');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Update a mileage entry
 */
export async function updateMileageEntry(
  id: string,
  data: UpdateMileageInput
): Promise<MileageTracking> {
  const response = await fetch(`/api/mileage/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update mileage entry');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Delete a mileage entry
 */
export async function deleteMileageEntry(id: string): Promise<void> {
  const response = await fetch(`/api/mileage/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete mileage entry');
  }
}

/**
 * Fetch the user's home address
 */
export async function fetchHomeAddress(): Promise<string | null> {
  const response = await fetch('/api/settings/home-address');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch home address');
  }

  const result = await response.json();
  return result.data.homeAddress;
}

/**
 * Update the user's home address
 */
export async function updateHomeAddress(homeAddress: string): Promise<string> {
  const response = await fetch('/api/settings/home-address', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ homeAddress }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update home address');
  }

  const result = await response.json();
  return result.data.homeAddress;
}
