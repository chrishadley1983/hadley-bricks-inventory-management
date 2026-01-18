'use client';

import { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface PriceUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: {
    updateBestOffer: boolean;
    autoAcceptPercent: number;
    minOfferPercent: number;
  }) => void;
  itemId: string;
  itemTitle: string | null;
  currentPrice: number | null;
  newPrice: number;
  isUpdating: boolean;
  updateResult?: {
    success: boolean;
    autoAcceptPrice: number | null;
    minOfferPrice: number | null;
    error?: string;
  } | null;
}

function formatPrice(price: number | null): string {
  if (price === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(price);
}

export function PriceUpdateDialog({
  isOpen,
  onClose,
  onConfirm,
  itemId,
  itemTitle,
  currentPrice,
  newPrice,
  isUpdating,
  updateResult,
}: PriceUpdateDialogProps) {
  const [updateBestOffer, setUpdateBestOffer] = useState(true);
  const [autoAcceptPercent] = useState(90);
  const [minOfferPercent] = useState(70);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setUpdateBestOffer(true);
    }
  }, [isOpen]);

  const priceDiff = currentPrice !== null ? newPrice - currentPrice : 0;
  const percentChange = currentPrice !== null && currentPrice > 0
    ? ((newPrice - currentPrice) / currentPrice) * 100
    : 0;

  const autoAcceptPrice = Math.round((newPrice * autoAcceptPercent) / 100 * 100) / 100;
  const minOfferPrice = Math.round((newPrice * minOfferPercent) / 100 * 100) / 100;

  const handleConfirm = () => {
    onConfirm({
      updateBestOffer,
      autoAcceptPercent,
      minOfferPercent,
    });
  };

  // Show success/error result
  if (updateResult) {
    return (
      <AlertDialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {updateResult.success ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Price Updated Successfully
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Update Failed
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {updateResult.success ? (
                  <>
                    <p>The eBay listing has been updated:</p>
                    <div className="bg-muted rounded-md p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>New Price:</span>
                        <span className="font-medium">{formatPrice(newPrice)}</span>
                      </div>
                      {updateResult.autoAcceptPrice !== null && (
                        <div className="flex justify-between">
                          <span>Auto-Accept Price:</span>
                          <span className="font-medium">{formatPrice(updateResult.autoAcceptPrice)}</span>
                        </div>
                      )}
                      {updateResult.minOfferPrice !== null && (
                        <div className="flex justify-between">
                          <span>Minimum Offer Price:</span>
                          <span className="font-medium">{formatPrice(updateResult.minOfferPrice)}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-destructive">{updateResult.error || 'An unknown error occurred'}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={onClose}>
              {updateResult.success ? 'Done' : 'Close'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Price Update</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                You are about to update the price for:
              </p>
              <div className="bg-muted rounded-md p-3 text-sm">
                <p className="font-medium truncate" title={itemTitle || undefined}>
                  {itemTitle || 'Untitled listing'}
                </p>
                <p className="text-muted-foreground text-xs mt-1">Item ID: {itemId}</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span>Current Price:</span>
                  <span className="font-medium">{formatPrice(currentPrice)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>New Price:</span>
                  <span className="font-medium text-lg">{formatPrice(newPrice)}</span>
                </div>
                {currentPrice !== null && (
                  <div className="flex justify-between items-center text-sm">
                    <span>Change:</span>
                    <span className={priceDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {priceDiff >= 0 ? '+' : ''}{formatPrice(priceDiff)} ({percentChange >= 0 ? '+' : ''}{percentChange.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="updateBestOffer"
                    checked={updateBestOffer}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setUpdateBestOffer(checked === true)}
                  />
                  <Label htmlFor="updateBestOffer" className="text-sm font-normal cursor-pointer">
                    Update Best Offer thresholds
                  </Label>
                </div>

                {updateBestOffer && (
                  <div className="ml-6 space-y-2 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Auto-Accept Price ({autoAcceptPercent}%):</span>
                      <span className="font-medium text-foreground">{formatPrice(autoAcceptPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Minimum Offer Price ({minOfferPercent}%):</span>
                      <span className="font-medium text-foreground">{formatPrice(minOfferPrice)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={isUpdating}>
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Price'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
