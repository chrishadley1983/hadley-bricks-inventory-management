'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/utils';
import type { EnrichedEligibleItem } from '@/lib/ebay/negotiation.types';

interface PlannedOffersTableProps {
  items?: EnrichedEligibleItem[];
  isLoading?: boolean;
  error?: Error | null;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export function PlannedOffersTable({
  items,
  isLoading,
  error,
  selectedIds,
  onSelectionChange,
}: PlannedOffersTableProps) {
  const eligibleItems = items || [];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(new Set(eligibleItems.map((item) => item.listingId)));
    } else {
      onSelectionChange(new Set());
    }
  };

  const handleSelectItem = (listingId: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(listingId);
    } else {
      newSet.delete(listingId);
    }
    onSelectionChange(newSet);
  };

  const allSelected = eligibleItems.length > 0 && selectedIds.size === eligibleItems.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < eligibleItems.length;
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Planned Offers</CardTitle>
          <CardDescription className="text-destructive">
            Error loading eligible items
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Planned Offers</CardTitle>
        <CardDescription>
          {eligibleItems.length === 0
            ? 'No listings are currently eligible for offers'
            : selectedIds.size > 0
              ? `${selectedIds.size} of ${eligibleItems.length} listing(s) selected to send`
              : `${eligibleItems.length} listing(s) available - select items to send offers`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {eligibleItems.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 space-y-2">
            <p className="text-center font-medium">Why are there no eligible listings?</p>
            <ul className="list-disc list-inside space-y-1 text-left max-w-md mx-auto">
              <li>
                eBay only returns listings with <strong>interested buyers</strong> (watchers, cart
                abandoners)
              </li>
              <li>Listings must be active for at least the minimum days configured in Settings</li>
              <li>Buyers may have already received offers recently</li>
            </ul>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={someSelected ? 'indeterminate' : allSelected}
                    onCheckedChange={(checked: boolean | 'indeterminate') =>
                      handleSelectAll(!!checked)
                    }
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Listing</TableHead>
                <TableHead className="text-center">Interest</TableHead>
                <TableHead className="text-right">Current Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Offer Price</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligibleItems.map((item) => {
                const currentPrice = item.currentPrice ?? 0;
                const discountAmount = (currentPrice * item.discountPercentage) / 100;
                const offerPrice = currentPrice - discountAmount;

                return (
                  <TableRow key={item.listingId}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(item.listingId)}
                        onCheckedChange={(checked: boolean | 'indeterminate') =>
                          handleSelectItem(item.listingId, !!checked)
                        }
                        aria-label={`Select ${item.title || item.listingId}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <div className="truncate font-medium" title={item.title || item.listingId}>
                        {item.title || item.listingId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.stockLevel} in stock
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">
                              {item.watcherCount > 0 && (
                                <div className="text-sm">👁 {item.watcherCount}</div>
                              )}
                              {item.previousOfferCount > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  📨 {item.previousOfferCount} sent
                                </div>
                              )}
                              {item.watcherCount === 0 && item.previousOfferCount === 0 && (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            <div className="space-y-1">
                              <div className="flex justify-between gap-4">
                                <span>Watchers:</span>
                                <span className="font-mono">{item.watcherCount}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Offers sent:</span>
                                <span className="font-mono">{item.previousOfferCount}</span>
                              </div>
                              <div className="text-muted-foreground text-[10px] mt-1 border-t pt-1">
                                eBay doesn&apos;t distinguish watcher vs cart abandoner
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(currentPrice, 'GBP')}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-destructive">-{item.discountPercentage}%</span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(offerPrice, 'GBP')}
                    </TableCell>
                    <TableCell className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant={
                                item.score >= 70
                                  ? 'destructive'
                                  : item.score >= 50
                                    ? 'default'
                                    : 'secondary'
                              }
                              className="cursor-help"
                            >
                              {item.score}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            <div className="space-y-1">
                              <div className="font-semibold border-b pb-1 mb-1">
                                Score Breakdown
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Listing Age:</span>
                                <span className="font-mono">{item.scoreFactors.listing_age}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Stock Level:</span>
                                <span className="font-mono">{item.scoreFactors.stock_level}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Item Value:</span>
                                <span className="font-mono">{item.scoreFactors.item_value}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Category:</span>
                                <span className="font-mono">{item.scoreFactors.category}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Watchers:</span>
                                <span className="font-mono">{item.scoreFactors.watchers}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-t pt-1 mt-1 font-semibold">
                                <span>Total:</span>
                                <span className="font-mono">{item.score}</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      {item.isReOffer ? (
                        <Badge variant="outline">Re-offer</Badge>
                      ) : (
                        <Badge variant="secondary">New</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
