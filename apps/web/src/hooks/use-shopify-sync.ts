import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ── Types ──────────────────────────────────────────────────────

interface ShopifySyncStatus {
  total: number;
  active: number;
  archived: number;
  errors: number;
  pending_queue: number;
  last_sync: string | null;
}

interface ShopifyConfig {
  id: string;
  shop_domain: string;
  api_version: string;
  location_id: string | null;
  sync_enabled: boolean;
  auto_sync_new_listings: boolean;
  default_discount_pct: number;
  created_at: string;
  updated_at: string;
}

interface SyncResult {
  success: boolean;
  shopifyProductId?: string;
  error?: string;
}

interface BatchSyncSummary {
  items_processed: number;
  items_created: number;
  items_added_to_group: number;
  items_updated: number;
  items_archived: number;
  items_failed: number;
  errors: Array<{ item_id: string; error: string }>;
  duration_ms: number;
}

interface ShopifyProduct {
  id: string;
  inventory_item_id: string;
  shopify_product_id: string;
  shopify_handle: string | null;
  shopify_status: string;
  shopify_price: number | null;
  shopify_compare_at_price: number | null;
  shopify_title: string | null;
  image_source: string | null;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
}

// ── Query Keys ─────────────────────────────────────────────────

export const shopifySyncKeys = {
  all: ['shopify-sync'] as const,
  status: () => [...shopifySyncKeys.all, 'status'] as const,
  config: () => [...shopifySyncKeys.all, 'config'] as const,
  products: () => [...shopifySyncKeys.all, 'products'] as const,
};

// ── Fetch Functions ────────────────────────────────────────────

async function fetchStatus(): Promise<ShopifySyncStatus> {
  const res = await fetch('/api/shopify-sync');
  if (!res.ok) throw new Error('Failed to fetch sync status');
  const json = await res.json();
  return json.data;
}

async function fetchConfig(): Promise<ShopifyConfig> {
  const res = await fetch('/api/shopify-sync/config');
  if (!res.ok) throw new Error('Failed to fetch config');
  const json = await res.json();
  return json.data;
}

async function createProduct(inventoryItemId: string): Promise<SyncResult> {
  const res = await fetch('/api/shopify-sync/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventory_item_id: inventoryItemId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create product');
  return json.data;
}

async function archiveProduct(inventoryItemId: string): Promise<SyncResult> {
  const res = await fetch('/api/shopify-sync/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventory_item_id: inventoryItemId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to archive product');
  return json.data;
}

async function runBatchSync(limit?: number): Promise<BatchSyncSummary> {
  const res = await fetch('/api/shopify-sync/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: limit ?? 50 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Batch sync failed');
  return json.data;
}

async function processQueue(batchSize?: number): Promise<BatchSyncSummary> {
  const res = await fetch('/api/shopify-sync/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: batchSize ?? 10 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Queue processing failed');
  return json.data;
}

async function updateConfig(
  updates: Partial<Pick<ShopifyConfig, 'sync_enabled' | 'auto_sync_new_listings' | 'default_discount_pct' | 'location_id'>>
): Promise<ShopifyConfig> {
  const res = await fetch('/api/shopify-sync/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update config');
  return json.data;
}

// ── Query Hooks ────────────────────────────────────────────────

export function useShopifySyncStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: shopifySyncKeys.status(),
    queryFn: fetchStatus,
    staleTime: 30_000,
    enabled: options?.enabled,
  });
}

export function useShopifyConfig() {
  return useQuery({
    queryKey: shopifySyncKeys.config(),
    queryFn: fetchConfig,
    staleTime: 60_000,
  });
}

// ── Mutation Hooks ─────────────────────────────────────────────

export function useCreateShopifyProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.status() });
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.products() });
    },
  });
}

export function useArchiveShopifyProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.status() });
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.products() });
    },
  });
}

export function useRunBatchSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limit?: number) => runBatchSync(limit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.status() });
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.products() });
    },
  });
}

export function useProcessSyncQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchSize?: number) => processQueue(batchSize),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.status() });
    },
  });
}

export function useUpdateShopifyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shopifySyncKeys.config() });
    },
  });
}

export type { ShopifySyncStatus, ShopifyConfig, SyncResult, BatchSyncSummary, ShopifyProduct };
