'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, ArrowRight, ArrowDown, X } from 'lucide-react';
import type { PriceConflict } from '@/lib/amazon/amazon-sync.types';

interface PriceConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflict: PriceConflict | null;
  /** Number of remaining conflicts after this one */
  remainingCount?: number;
  onResolved: (message: string) => void;
}

async function updateInventoryPrice(inventoryItemId: string, newPrice: number): Promise<void> {
  const response = await fetch(`/api/inventory/${inventoryItemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_value: newPrice }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update price');
  }
}

async function addToQueueWithSkip(inventoryItemId: string): Promise<void> {
  const response = await fetch('/api/amazon/sync/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId, skipConflictCheck: true }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add to queue');
  }
}

export function PriceConflictDialog({
  open,
  onOpenChange,
  conflict,
  remainingCount = 0,
  onResolved,
}: PriceConflictDialogProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<'amazon' | 'inventory' | null>(null);

  // Use Amazon price: update local inventory, then add to queue
  const useAmazonPriceMutation = useMutation({
    mutationFn: async () => {
      if (!conflict) return;
      // Update local inventory to match Amazon/queue price
      await updateInventoryPrice(conflict.inventoryItemId, conflict.conflictPrice);
      // Then add to queue
      await addToQueueWithSkip(conflict.inventoryItemId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['amazon-sync', 'queue'] });
      onResolved(
        `Inventory updated to £${conflict?.conflictPrice.toFixed(2)} and added to sync queue.`
      );
      setPendingAction(null);
    },
    onError: () => {
      setPendingAction(null);
    },
  });

  // Use inventory price: add to queue as-is (will update Amazon when synced)
  const useInventoryPriceMutation = useMutation({
    mutationFn: async () => {
      if (!conflict) return;
      // Add to queue with local price - when synced, this will UPDATE Amazon's price
      await addToQueueWithSkip(conflict.inventoryItemId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['amazon-sync', 'queue'] });
      onResolved(
        `Added to sync queue. Amazon will be updated to £${conflict?.localPrice.toFixed(2)}.`
      );
      setPendingAction(null);
    },
    onError: () => {
      setPendingAction(null);
    },
  });

  if (!conflict) return null;

  const isAmazonConflict = conflict.type === 'amazon';
  const priceDiff = conflict.localPrice - conflict.conflictPrice;
  const isRaisingPrice = priceDiff > 0;
  const isPending = useAmazonPriceMutation.isPending || useInventoryPriceMutation.isPending;
  const error = useAmazonPriceMutation.error || useInventoryPriceMutation.error;

  const handleUseAmazonPrice = () => {
    setPendingAction('amazon');
    useAmazonPriceMutation.mutate();
  };

  const handleUseInventoryPrice = () => {
    setPendingAction('inventory');
    useInventoryPriceMutation.mutate();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Price Conflict Detected
            {remainingCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                +{remainingCount} more
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {isAmazonConflict
              ? 'Your inventory price differs from the current Amazon listing price.'
              : 'Your inventory price differs from another queued item with the same ASIN.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Item Info */}
          <div className="rounded-md border p-3 bg-muted/50">
            <div className="font-medium">{conflict.setNumber}</div>
            {conflict.itemName && (
              <div className="text-sm text-muted-foreground">{conflict.itemName}</div>
            )}
            <div className="text-xs text-muted-foreground mt-1">ASIN: {conflict.asin}</div>
          </div>

          {/* Price Comparison */}
          <div className="flex items-center justify-center gap-4 py-2">
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase mb-1">Your Price</div>
              <Badge variant="default" className="text-lg px-3 py-1">
                £{conflict.localPrice.toFixed(2)}
              </Badge>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase mb-1">
                {isAmazonConflict ? 'Amazon Price' : 'Queue Price'}
              </div>
              <Badge variant="outline" className="text-lg px-3 py-1">
                £{conflict.conflictPrice.toFixed(2)}
              </Badge>
            </div>
          </div>

          {/* Difference */}
          <div className="text-center text-sm">
            <span className="text-muted-foreground">Difference: </span>
            <span className={isRaisingPrice ? 'text-green-600' : 'text-red-600'}>
              {isRaisingPrice ? '+' : ''}£{priceDiff.toFixed(2)}
            </span>
          </div>

          {/* Explanation */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Choose which price to use for the sync:
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {error instanceof Error ? error.message : 'An error occurred'}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {/* Use Amazon Price */}
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleUseAmazonPrice}
            disabled={isPending}
          >
            {pendingAction === 'amazon' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowDown className="mr-2 h-4 w-4" />
            )}
            <span className="flex-1 text-left">
              Use {isAmazonConflict ? 'Amazon' : 'Queue'} price (£
              {conflict.conflictPrice.toFixed(2)})
            </span>
            <span className="text-xs text-muted-foreground ml-2">Updates inventory</span>
          </Button>

          {/* Use Inventory Price */}
          <Button
            className="w-full justify-start"
            onClick={handleUseInventoryPrice}
            disabled={isPending}
          >
            {pendingAction === 'inventory' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            <span className="flex-1 text-left">
              Use my price (£{conflict.localPrice.toFixed(2)})
            </span>
            <span className="text-xs text-muted-foreground ml-2">Updates Amazon</span>
          </Button>

          {/* Cancel */}
          <Button variant="ghost" className="w-full" onClick={handleCancel} disabled={isPending}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
