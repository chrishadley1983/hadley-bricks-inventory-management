'use client';

import { CheckCircle2, XCircle, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useSyncFeed } from '@/hooks/use-amazon-sync';
import { SyncFeedStatus } from './SyncFeedStatus';
import type { FeedItemWithDetails } from '@/lib/amazon/amazon-sync.types';
import { formatCurrency } from '@/lib/utils';

// ============================================================================
// HELPERS
// ============================================================================

function getItemStatusIcon(status: string): React.ElementType {
  switch (status) {
    case 'success':
      return CheckCircle2;
    case 'warning':
      return AlertTriangle;
    case 'error':
      return XCircle;
    default:
      return Clock;
  }
}

function getItemStatusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'text-green-600';
    case 'warning':
      return 'text-yellow-600';
    case 'error':
      return 'text-red-600';
    default:
      return 'text-muted-foreground';
  }
}

// ============================================================================
// ITEM ROW COMPONENT
// ============================================================================

function FeedItemRow({ item }: { item: FeedItemWithDetails }) {
  const Icon = getItemStatusIcon(item.status);
  const colorClass = getItemStatusColor(item.status);

  // Build display text for set numbers and item names
  const setNumbersText = item.setNumbers?.join(', ') || '';
  const itemNamesText = item.itemNames?.join(', ') || '';

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <Icon className={`h-5 w-5 mt-0.5 ${colorClass}`} />
      <div className="flex-1 min-w-0">
        {/* Set numbers and item names */}
        {(setNumbersText || itemNamesText) && (
          <div className="mb-1">
            <span className="text-sm font-medium">
              {setNumbersText}
              {setNumbersText && itemNamesText && ' - '}
              {itemNamesText}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-sm font-medium bg-muted px-1.5 py-0.5 rounded">{item.asin}</code>
          <span className="text-sm text-muted-foreground">SKU: {item.amazon_sku}</span>
        </div>

        <div className="mt-1 text-sm text-muted-foreground">
          Price: {formatCurrency(item.submitted_price)} | Qty: {item.submitted_quantity}
        </div>

        {item.error_message && (
          <div className="mt-2 text-sm text-destructive">
            <strong>Error:</strong> {item.error_message}
            {item.error_code && <span className="ml-1 text-xs">({item.error_code})</span>}
          </div>
        )}

        {item.warnings && Array.isArray(item.warnings) && item.warnings.length > 0 && (
          <div className="mt-2 text-sm text-yellow-600">
            <strong>Warnings:</strong>
            <ul className="list-disc list-inside ml-2">
              {item.warnings.map((w, i: number) => {
                const warning = w as { message?: string } | null;
                return <li key={i}>{warning?.message ?? 'Unknown warning'}</li>;
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface SyncFeedDetailDialogProps {
  feedId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SyncFeedDetailDialog({ feedId, open, onOpenChange }: SyncFeedDetailDialogProps) {
  const { data: feed, isLoading } = useSyncFeed(feedId ?? undefined, {
    enabled: !!feedId && open,
    pollWhileProcessing: true,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Feed Details
            {feed?.is_dry_run && (
              <Badge variant="outline" className="ml-2">
                Dry Run
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {feed?.amazon_feed_id ? (
              <span className="flex items-center gap-1">
                Amazon Feed ID: {feed.amazon_feed_id}
                <ExternalLink className="h-3 w-3" />
              </span>
            ) : (
              'View the status and results for each item in this feed.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : feed ? (
          <div className="space-y-4">
            <SyncFeedStatus feed={feed} showPollButton />

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Total: {feed.total_items} items</span>
              {feed.submitted_at && (
                <span>Submitted: {new Date(feed.submitted_at).toLocaleString('en-GB')}</span>
              )}
            </div>

            {feed.items && feed.items.length > 0 ? (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {feed.items.map((item) => (
                    <FeedItemRow key={item.id} item={item} />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No item details available
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Feed not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
