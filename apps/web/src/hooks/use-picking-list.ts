/**
 * Picking List hooks
 *
 * React Query hooks for fetching picking list data
 */

import { useQuery } from '@tanstack/react-query';

/**
 * Common picking list item structure
 */
export interface PickingListItem {
  location: string | null;
  setNo: string | null;
  itemName: string;
  orderId: string;
  platformOrderId: string;
  quantity: number;
  buyerName: string | null;
  orderDate: string;
  matchStatus: 'matched' | 'unmatched' | 'manual';
  inventoryItemId?: string | null;
  asin?: string | null;
}

/**
 * Picking list response
 */
export interface PickingListResponse {
  items: PickingListItem[];
  unmatchedItems: PickingListItem[];
  unknownLocationItems: PickingListItem[];
  totalItems: number;
  totalOrders: number;
  generatedAt: string;
}

/**
 * Supported platforms for picking list
 */
export type PickingListPlatform = 'amazon' | 'ebay';

/**
 * Query keys for picking lists
 */
export const pickingListKeys = {
  all: ['picking-list'] as const,
  byPlatform: (platform: PickingListPlatform) =>
    [...pickingListKeys.all, platform] as const,
};

/**
 * Fetch picking list for a platform
 */
async function fetchPickingList(
  platform: PickingListPlatform
): Promise<PickingListResponse> {
  const response = await fetch(`/api/picking-list/${platform}`);
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Failed to fetch picking list' }));
    throw new Error(error.error || 'Failed to fetch picking list');
  }
  const json = await response.json();

  // Transform the response to have consistent field names
  const data = json.data;

  // Map platform-specific fields to common structure
  const transformItem = (item: Record<string, unknown>): PickingListItem => ({
    location: item.location as string | null,
    setNo: item.setNo as string | null,
    itemName: item.itemName as string,
    orderId: item.orderId as string,
    platformOrderId:
      (item.amazonOrderId as string) ||
      (item.ebayOrderId as string) ||
      (item.platformOrderId as string),
    quantity: item.quantity as number,
    buyerName:
      (item.buyerName as string | null) ||
      (item.buyerUsername as string | null),
    orderDate:
      (item.orderDate as string) || (item.creationDate as string),
    matchStatus: item.matchStatus as 'matched' | 'unmatched' | 'manual',
    inventoryItemId: item.inventoryItemId as string | null | undefined,
    asin: item.asin as string | null | undefined,
  });

  return {
    items: data.items.map(transformItem),
    unmatchedItems: data.unmatchedItems.map(transformItem),
    unknownLocationItems: data.unknownLocationItems.map(transformItem),
    totalItems: data.totalItems,
    totalOrders: data.totalOrders,
    generatedAt: data.generatedAt,
  };
}

/**
 * Download picking list as PDF
 */
export async function downloadPickingListPDF(
  platform: PickingListPlatform
): Promise<void> {
  const response = await fetch(`/api/picking-list/${platform}?format=pdf`);
  if (!response.ok) {
    throw new Error('Failed to download PDF');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${platform}-picking-list-${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Hook to fetch picking list for a platform
 */
export function usePickingList(
  platform: PickingListPlatform,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: pickingListKeys.byPlatform(platform),
    queryFn: () => fetchPickingList(platform),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
}
