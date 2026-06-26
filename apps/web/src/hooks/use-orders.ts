/**
 * Orders hooks
 *
 * React Query hooks for orders data management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformOrder, OrderItem } from '@hadley-bricks/database';

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...orderKeys.lists(), filters] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
  stats: (platform?: string) => [...orderKeys.all, 'stats', platform] as const,
};

interface OrdersResponse {
  data: PlatformOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface OrderWithItems extends PlatformOrder {
  items: OrderItem[];
}

interface OrderResponse {
  data: OrderWithItems;
}

interface OrderStatsResponse {
  data: {
    totalOrders: number;
    totalRevenue: number;
    ordersByStatus: Record<string, number>;
  };
}

interface SyncStatusResponse {
  data: {
    isConfigured: boolean;
    totalOrders: number;
    lastSyncedAt: string | null;
  };
}

interface SyncResponse {
  success: boolean;
  data: {
    ordersProcessed: number;
    ordersCreated: number;
    ordersUpdated: number;
    errors: string[];
    lastSyncedAt: string;
  };
}

interface OrderFilters {
  page?: number;
  pageSize?: number;
  platform?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Fetch orders with filters
 */
async function fetchOrders(filters: OrderFilters = {}): Promise<OrdersResponse> {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.platform && filters.platform !== 'all') params.set('platform', filters.platform);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);

  const response = await fetch(`/api/orders?${params}`);
  if (!response.ok) throw new Error('Failed to fetch orders');
  return response.json();
}

/**
 * Fetch a single order with items
 */
async function fetchOrder(id: string): Promise<OrderResponse> {
  const response = await fetch(`/api/orders/${id}`);
  if (!response.ok) throw new Error('Failed to fetch order');
  return response.json();
}

/**
 * Fetch order statistics
 */
async function fetchOrderStats(platform?: string): Promise<OrderStatsResponse> {
  const params = platform ? `?platform=${platform}` : '';
  const response = await fetch(`/api/orders/stats${params}`);
  if (!response.ok) throw new Error('Failed to fetch order stats');
  return response.json();
}

/**
 * Fetch BrickLink sync status
 */
async function fetchBrickLinkSyncStatus(): Promise<SyncStatusResponse> {
  const response = await fetch('/api/integrations/bricklink/sync');
  if (!response.ok) throw new Error('Failed to fetch sync status');
  return response.json();
}

/**
 * Trigger BrickLink sync
 */
async function triggerBrickLinkSync(
  options: { includeFiled?: boolean; includeItems?: boolean } = {}
): Promise<SyncResponse> {
  const response = await fetch('/api/integrations/bricklink/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error('Failed to sync orders');
  return response.json();
}

/**
 * Hook to fetch orders list
 */
export function useOrders(filters: OrderFilters = {}) {
  return useQuery({
    queryKey: orderKeys.list(filters as Record<string, unknown>),
    queryFn: () => fetchOrders(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes - prevents unnecessary refetches
  });
}

/**
 * Hook to fetch a single order
 */
export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id!),
    queryFn: () => fetchOrder(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // 10 minutes - order details don't change often
  });
}

/**
 * Hook to fetch order statistics
 */
export function useOrderStats(platform?: string) {
  return useQuery({
    queryKey: orderKeys.stats(platform),
    queryFn: () => fetchOrderStats(platform),
    staleTime: 5 * 60 * 1000, // 5 minutes - stats are computed aggregates
  });
}

/**
 * Hook to fetch BrickLink sync status
 */
export function useBrickLinkSyncStatus() {
  return useQuery({
    queryKey: ['bricklink', 'sync-status'],
    queryFn: fetchBrickLinkSyncStatus,
    refetchInterval: 120000, // Refresh every 2 minutes
    refetchIntervalInBackground: false, // stop polling when the tab is hidden
  });
}

/**
 * Hook to trigger BrickLink sync
 */
export function useBrickLinkSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerBrickLinkSync,
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: ['bricklink', 'sync-status'] });
    },
  });
}

/**
 * Hook for BrickLink credentials status
 */
export function useBrickLinkCredentials() {
  return useQuery({
    queryKey: ['bricklink', 'credentials'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/bricklink/credentials');
      if (!response.ok) throw new Error('Failed to check credentials');
      return response.json() as Promise<{ configured: boolean }>;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - credentials rarely change
  });
}
