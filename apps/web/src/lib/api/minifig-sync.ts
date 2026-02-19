/**
 * API client functions for Minifig Sync feature.
 * Called by TanStack Query hooks — NOT imported directly by components.
 */

import type { MinifigSyncItem, MinifigSyncJob, MinifigRemovalQueue, ListingStatus } from '@/lib/minifig-sync/types';

export interface MinifigSyncFilters {
  listingStatus?: ListingStatus;
  meetsThreshold?: boolean;
  search?: string;
}

interface ApiResponse<T> {
  data: T;
}

interface JobResult {
  jobId: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

interface StagingResult {
  jobId: string;
  itemsProcessed: number;
  itemsStaged: number;
  itemsSkipped: number;
  itemsErrored: number;
  errors: Array<{ item?: string; error: string }>;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }
  const result = (await response.json()) as ApiResponse<T>;
  return result.data;
}

// ── Sync Items ─────────────────────────────────────────

export async function fetchMinifigSyncItems(
  filters?: MinifigSyncFilters,
): Promise<MinifigSyncItem[]> {
  const params = new URLSearchParams();
  if (filters?.listingStatus) params.set('listingStatus', filters.listingStatus);
  if (filters?.meetsThreshold !== undefined) params.set('meetsThreshold', String(filters.meetsThreshold));
  if (filters?.search) params.set('search', filters.search);
  return apiFetch<MinifigSyncItem[]>(`/api/minifigs/sync/items?${params.toString()}`);
}

export async function fetchMinifigSyncItem(id: string): Promise<MinifigSyncItem> {
  return apiFetch<MinifigSyncItem>(`/api/minifigs/sync/items/${id}`);
}

// ── Jobs ───────────────────────────────────────────────

export async function fetchMinifigSyncJobs(): Promise<MinifigSyncJob[]> {
  return apiFetch<MinifigSyncJob[]>('/api/minifigs/sync/jobs');
}

// ── Actions ────────────────────────────────────────────

export async function triggerInventoryPull(): Promise<JobResult> {
  return apiFetch<JobResult>('/api/minifigs/sync/pull-inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function triggerResearch(itemIds?: string[]): Promise<JobResult> {
  return apiFetch<JobResult>('/api/minifigs/sync/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });
}

export async function triggerForceRefresh(itemId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/minifigs/sync/research/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
}

export async function triggerCreateListings(itemIds?: string[]): Promise<StagingResult> {
  return apiFetch<StagingResult>('/api/minifigs/sync/create-listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });
}

export async function publishListing(itemId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/minifigs/sync/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
}

export async function dismissListing(itemId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/minifigs/sync/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
}

export async function approveRemoval(removalId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/minifigs/sync/removals/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removalId }),
  });
}

export async function dismissRemoval(removalId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/minifigs/sync/removals/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removalId }),
  });
}

// ── Dashboard ─────────────────────────────────────────

export interface MinifigDashboardData {
  totalInBricqer: number;
  totalMeetingThreshold: number;
  countByStatus: Record<string, number>;
  totalRevenue: number;
  feeSavings: number;
  avgTimeToSell: number | null;
  pendingRemovals: number;
}

export async function fetchMinifigDashboard(): Promise<MinifigDashboardData> {
  return apiFetch<MinifigDashboardData>('/api/minifigs/dashboard');
}

// ── Item Updates ──────────────────────────────────────

export async function updateSyncItem(
  id: string,
  data: { title?: string; description?: string; price?: number },
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/minifigs/sync/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Removals ──────────────────────────────────────────

export interface RemovalWithSyncItem extends MinifigRemovalQueue {
  minifig_sync_items: {
    id: string;
    name: string | null;
    bricklink_id: string | null;
    bricqer_image_url: string | null;
    ebay_listing_url: string | null;
    ebay_sku: string | null;
    images: unknown;
  } | null;
}

export async function fetchRemovals(): Promise<RemovalWithSyncItem[]> {
  return apiFetch<RemovalWithSyncItem[]>('/api/minifigs/sync/removals');
}

export async function bulkApproveRemovals(): Promise<{
  approved: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}> {
  return apiFetch<{
    approved: number;
    failed: number;
    errors: Array<{ id: string; error: string }>;
  }>('/api/minifigs/sync/removals/bulk-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function bulkPublishListings(): Promise<{
  published: number;
  skipped: number;
  errors: Array<{ itemId: string; error: string }>;
}> {
  return apiFetch<{
    published: number;
    skipped: number;
    errors: Array<{ itemId: string; error: string }>;
  }>('/api/minifigs/sync/bulk-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}
