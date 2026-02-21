'use client';

import Image from 'next/image';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Check, X, ExternalLink, ShoppingCart, Loader2 } from 'lucide-react';
import type { RemovalWithSyncItem } from '@/lib/api/minifig-sync';

interface RemovalCardProps {
  removal: RemovalWithSyncItem;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  isApproving?: boolean;
  isDismissing?: boolean;
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return `£${num.toFixed(2)}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getSoldOnLabel(soldOn: string | null): string {
  switch (soldOn) {
    case 'EBAY':
      return 'eBay';
    case 'BRICQER':
      return 'Bricqer';
    default:
      return soldOn ?? 'Unknown';
  }
}

function getRemoveFromLabel(removeFrom: string | null): string {
  switch (removeFrom) {
    case 'EBAY':
      return 'eBay listing';
    case 'BRICQER':
      return 'Bricqer inventory';
    default:
      return removeFrom ?? 'Unknown';
  }
}

function getSoldOnBadgeVariant(soldOn: string | null): 'default' | 'secondary' | 'destructive' {
  switch (soldOn) {
    case 'EBAY':
      return 'default';
    case 'BRICQER':
      return 'secondary';
    default:
      return 'destructive';
  }
}

export function RemovalCard({
  removal,
  onApprove,
  onDismiss,
  isApproving,
  isDismissing,
}: RemovalCardProps) {
  const syncItem = removal.minifig_sync_items;
  const isActioning = isApproving || isDismissing;

  // Get first image from sync item
  const images = syncItem?.images as Array<{ url: string }> | null;
  const imageUrl = images?.[0]?.url ?? syncItem?.bricqer_image_url;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Image */}
          {imageUrl && (
            <div className="w-16 h-16 rounded-md overflow-hidden border bg-muted shrink-0">
              <Image
                src={imageUrl}
                alt={syncItem?.name || 'Minifig'}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                unoptimized
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">
              {syncItem?.name || 'Unknown Minifigure'}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {syncItem?.bricklink_id && (
                <Badge variant="outline" className="text-xs font-mono">
                  {syncItem.bricklink_id}
                </Badge>
              )}
              <Badge variant={getSoldOnBadgeVariant(removal.sold_on)}>
                Sold on {getSoldOnLabel(removal.sold_on)}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-3">
        {/* Sale details (F55) */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Sale Price</span>
            <p className="font-medium">{formatCurrency(removal.sale_price)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Sale Date</span>
            <p className="font-medium">{formatDate(removal.sale_date)}</p>
          </div>
        </div>

        <Separator />

        {/* What will be removed (F55) */}
        <div className="flex items-center gap-2 text-sm">
          <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
          <span>
            Remove from:{' '}
            <span className="font-medium">{getRemoveFromLabel(removal.remove_from)}</span>
          </span>
        </div>

        {/* Order link (F55) */}
        {removal.order_url && (
          <a
            href={removal.order_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Order {removal.order_id ? `#${removal.order_id}` : ''}
          </a>
        )}

        {/* eBay listing link */}
        {syncItem?.ebay_listing_url && removal.remove_from === 'EBAY' && (
          <a
            href={syncItem.ebay_listing_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View eBay Listing
          </a>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-0">
        {/* Approve (F56/F57) */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" className="flex-1" disabled={isActioning}>
              {isApproving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Approve Removal
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve this removal?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove &quot;{syncItem?.name}&quot; from{' '}
                {getRemoveFromLabel(removal.remove_from)}. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onApprove(removal.id)}>Approve</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dismiss (F59) */}
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={isActioning}
          onClick={() => onDismiss(removal.id)}
        >
          {isDismissing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5 mr-1" />
          )}
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  );
}
