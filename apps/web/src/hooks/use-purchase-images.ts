/**
 * Purchase Images Hooks
 *
 * React Query hooks for managing purchase photos/receipts.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseImage } from '@/lib/services/purchase-image.service';

// Query keys
export const purchaseImageKeys = {
  all: ['purchase-images'] as const,
  lists: () => [...purchaseImageKeys.all, 'list'] as const,
  list: (purchaseId: string) => [...purchaseImageKeys.lists(), purchaseId] as const,
};

interface ImageUploadData {
  id: string;
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  filename: string;
}

interface UploadResult {
  success: boolean;
  imageId: string;
  url?: string;
  error?: string;
}

interface UploadResponse {
  success: boolean;
  message: string;
  results: UploadResult[];
}

/**
 * Fetch images for a purchase
 */
async function fetchPurchaseImages(purchaseId: string): Promise<PurchaseImage[]> {
  const response = await fetch(`/api/purchases/${purchaseId}/images`);
  if (!response.ok) {
    throw new Error('Failed to fetch images');
  }
  const json = await response.json();
  return json.data;
}

/**
 * Upload images to a purchase
 */
async function uploadPurchaseImages(
  purchaseId: string,
  images: ImageUploadData[]
): Promise<UploadResponse> {
  const response = await fetch(`/api/purchases/${purchaseId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to upload images');
  }

  return json;
}

/**
 * Delete a purchase image
 */
async function deletePurchaseImage(
  purchaseId: string,
  imageId: string
): Promise<void> {
  const response = await fetch(`/api/purchases/${purchaseId}/images/${imageId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error || 'Failed to delete image');
  }
}

/**
 * Update image caption
 */
async function updateImageCaption(
  purchaseId: string,
  imageId: string,
  caption: string
): Promise<void> {
  const response = await fetch(`/api/purchases/${purchaseId}/images/${imageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption }),
  });

  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error || 'Failed to update caption');
  }
}

/**
 * Hook to fetch purchase images
 */
export function usePurchaseImages(purchaseId?: string) {
  return useQuery({
    queryKey: purchaseImageKeys.list(purchaseId || ''),
    queryFn: () => fetchPurchaseImages(purchaseId!),
    enabled: !!purchaseId,
    staleTime: 30000,
  });
}

/**
 * Hook to upload purchase images
 */
export function useUploadPurchaseImages(purchaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (images: ImageUploadData[]) => uploadPurchaseImages(purchaseId, images),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseImageKeys.list(purchaseId) });
    },
  });
}

/**
 * Hook to delete a purchase image
 */
export function useDeletePurchaseImage(purchaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (imageId: string) => deletePurchaseImage(purchaseId, imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseImageKeys.list(purchaseId) });
    },
  });
}

/**
 * Hook to update image caption
 */
export function useUpdateImageCaption(purchaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ imageId, caption }: { imageId: string; caption: string }) =>
      updateImageCaption(purchaseId, imageId, caption),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseImageKeys.list(purchaseId) });
    },
  });
}
