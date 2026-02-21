'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Download,
  MapPin,
  Package,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  usePickingList,
  downloadPickingListPDF,
  type PickingListPlatform,
  type PickingListItem,
} from '@/hooks/use-picking-list';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

interface PickingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PickingListPlatform;
}

const platformLabels: Record<PickingListPlatform, string> = {
  amazon: 'Amazon',
  ebay: 'eBay',
};

export function PickingListDialog({ open, onOpenChange, platform }: PickingListDialogProps) {
  const { data, isLoading, error, refetch } = usePickingList(platform, open);
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      await downloadPickingListPDF(platform);
      toast({ title: 'PDF downloaded successfully' });
    } catch {
      toast({ title: 'Failed to download PDF', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  // Group items by location
  const itemsByLocation = new Map<string, PickingListItem[]>();
  if (data?.items) {
    for (const item of data.items) {
      const loc = item.location || 'Unknown Location';
      if (!itemsByLocation.has(loc)) {
        itemsByLocation.set(loc, []);
      }
      itemsByLocation.get(loc)!.push(item);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {platformLabels[platform]} Picking List
            </DialogTitle>
            {data && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{data.totalOrders} orders</Badge>
                <Badge variant="secondary">{data.totalItems} items</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPDF}
                  disabled={isDownloading}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {isDownloading ? 'Downloading...' : 'PDF'}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error instanceof Error ? error.message : 'Failed to load picking list'}
              </AlertDescription>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
                Retry
              </Button>
            </Alert>
          )}

          {data && data.totalOrders === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              <p className="text-muted-foreground">No orders awaiting dispatch</p>
            </div>
          )}

          {data && data.totalOrders > 0 && (
            <>
              {/* Warnings */}
              {(data.unmatchedItems.length > 0 || data.unknownLocationItems.length > 0) && (
                <div className="space-y-2">
                  {data.unmatchedItems.length > 0 && (
                    <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800 dark:text-amber-200">
                        <strong>{data.unmatchedItems.length} unmatched item(s)</strong> - No
                        inventory match found.
                        {platform === 'ebay' ? (
                          <> Go to Settings &gt; eBay SKU Matching to resolve.</>
                        ) : (
                          <> Ensure ASIN is set in inventory.</>
                        )}
                        <ul className="mt-2 text-sm space-y-1">
                          {data.unmatchedItems.slice(0, 5).map((item, i) => (
                            <li key={i} className="truncate">
                              &bull; {item.setNo || item.asin || 'No SKU'}: {item.itemName}
                            </li>
                          ))}
                          {data.unmatchedItems.length > 5 && (
                            <li className="text-muted-foreground">
                              ...and {data.unmatchedItems.length - 5} more
                            </li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {data.unknownLocationItems.length > 0 && (
                    <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
                      <MapPin className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800 dark:text-amber-200">
                        <strong>{data.unknownLocationItems.length} item(s) missing location</strong>{' '}
                        - Set storage location in inventory.
                        <ul className="mt-2 text-sm space-y-1">
                          {data.unknownLocationItems.slice(0, 5).map((item, i) => (
                            <li key={i} className="truncate">
                              &bull; {item.setNo || item.asin || 'No SKU'}: {item.itemName}
                            </li>
                          ))}
                          {data.unknownLocationItems.length > 5 && (
                            <li className="text-muted-foreground">
                              ...and {data.unknownLocationItems.length - 5} more
                            </li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {/* Picking List by Location */}
              <div className="space-y-4">
                {Array.from(itemsByLocation.entries()).map(([location, items]) => (
                  <div key={location} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-2 font-medium flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {location}
                      <Badge variant="secondary" className="ml-auto">
                        {items.length} item(s)
                      </Badge>
                    </div>
                    <div className="divide-y">
                      {items.map((item, index) => (
                        <div
                          key={`${item.orderId}-${index}`}
                          className={cn(
                            'px-4 py-3 flex items-start gap-4',
                            item.matchStatus === 'unmatched' &&
                              'bg-amber-50/50 dark:bg-amber-950/10'
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {item.setNo || item.asin || '-'}
                              </span>
                              {item.matchStatus === 'unmatched' && (
                                <Badge
                                  variant="outline"
                                  className="text-amber-600 border-amber-500 text-xs"
                                >
                                  Unmatched
                                </Badge>
                              )}
                              {item.matchStatus === 'manual' && (
                                <Badge
                                  variant="outline"
                                  className="text-blue-600 border-blue-500 text-xs"
                                >
                                  Manual
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {item.itemName}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                Order: {item.platformOrderId}
                                <Link
                                  href={`/orders?search=${item.platformOrderId}`}
                                  className="hover:text-foreground"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </span>
                              {item.buyerName && <span>&bull; {item.buyerName}</span>}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="secondary" className="text-lg px-3">
                              x{item.quantity}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
