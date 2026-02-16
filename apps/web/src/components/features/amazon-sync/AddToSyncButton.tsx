'use client';

import { CloudUpload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAddToSyncQueue } from '@/hooks/use-amazon-sync';

interface AddToSyncButtonProps {
  inventoryItemId: string;
  hasAsin: boolean;
  hasPrice: boolean;
  variant?: 'icon' | 'button';
  className?: string;
  /** Called when the API returns a price conflict instead of adding directly */
  onPriceConflict?: (conflict: import('@/lib/amazon/amazon-sync.types').PriceConflict) => void;
}

export function AddToSyncButton({
  inventoryItemId,
  hasAsin,
  hasPrice,
  variant = 'icon',
  className,
  onPriceConflict,
}: AddToSyncButtonProps) {
  const { toast } = useToast();
  const addMutation = useAddToSyncQueue();

  const isDisabled = !hasAsin || !hasPrice;
  const isLoading = addMutation.isPending;

  let tooltipContent = 'Add to Amazon sync queue';
  if (!hasAsin) {
    tooltipContent = 'Item has no Amazon ASIN';
  } else if (!hasPrice) {
    tooltipContent = 'Item has no listing price';
  }

  const handleClick = async () => {
    try {
      const result = await addMutation.mutateAsync({ inventoryItemId });
      if (result.priceConflict && onPriceConflict) {
        onPriceConflict(result.priceConflict);
        return;
      }
      toast({
        title: 'Added to queue',
        description: result.message,
      });
    } catch (error) {
      toast({
        title: 'Failed to add',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (variant === 'icon') {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={isDisabled || isLoading}
        className={className}
        title={tooltipContent}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CloudUpload className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isDisabled || isLoading}
      className={className}
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CloudUpload className="mr-2 h-4 w-4" />
      )}
      Add to Amazon Queue
    </Button>
  );
}

// ============================================================================
// BULK ADD BUTTON
// ============================================================================

interface BulkAddToSyncButtonProps {
  inventoryItemIds: string[];
  onComplete?: () => void;
}

export function BulkAddToSyncButton({
  inventoryItemIds,
  onComplete,
}: BulkAddToSyncButtonProps) {
  const { toast } = useToast();
  const addMutation = useAddToSyncQueue();

  const isLoading = addMutation.isPending;
  const count = inventoryItemIds.length;

  const handleClick = async () => {
    try {
      const result = await addMutation.mutateAsync({ inventoryItemIds });
      toast({
        title: 'Added to queue',
        description: result.message,
      });
      onComplete?.();
    } catch (error) {
      toast({
        title: 'Failed to add',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={count === 0 || isLoading}
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CloudUpload className="mr-2 h-4 w-4" />
      )}
      Add to Amazon Queue ({count})
    </Button>
  );
}
