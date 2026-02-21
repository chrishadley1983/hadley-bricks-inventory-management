'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, BarChart3, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchPurchaseProfitability } from '@/lib/api';
import type { PurchaseProfitability } from '@/lib/services/purchase-profitability.service';

interface PurchaseProfitabilityHoverCardProps {
  purchaseId: string;
  children: React.ReactNode;
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function PurchaseProfitabilityHoverCard({
  purchaseId,
  children,
}: PurchaseProfitabilityHoverCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery<PurchaseProfitability>({
    queryKey: ['purchases', 'profitability', purchaseId],
    queryFn: () => fetchPurchaseProfitability(purchaseId),
    enabled: isOpen,
    staleTime: 60000, // 1 minute cache
  });

  return (
    <HoverCard openDelay={200} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80" side="top" align="start">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
        ) : data ? (
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Profitability</span>
              </div>
              <Badge variant="outline" className="text-xs">
                {data.totalItems} items
              </Badge>
            </div>

            {/* No items case */}
            {data.totalItems === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No items linked</p>
            ) : (
              <>
                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {data.soldItems}/{data.totalItems} sold
                    </span>
                    <span className="text-muted-foreground">
                      {((data.soldItems / data.totalItems) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="absolute h-full bg-green-500 transition-all"
                      style={{ width: `${(data.soldItems / data.totalItems) * 100}%` }}
                    />
                    <div
                      className="absolute h-full bg-blue-500 transition-all"
                      style={{
                        left: `${(data.soldItems / data.totalItems) * 100}%`,
                        width: `${(data.listedItems / data.totalItems) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Sold
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Listed
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-gray-300" />
                      Unlisted
                    </span>
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <div>
                    <div className="text-xs text-muted-foreground">Realised</div>
                    <div
                      className={cn(
                        'font-medium',
                        data.realisedProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(data.realisedProfit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Unrealised</div>
                    <div
                      className={cn(
                        'font-medium',
                        data.unrealisedProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(data.unrealisedProfit)}
                    </div>
                  </div>
                </div>

                {/* Total Profit */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-1.5">
                    {data.totalProjectedProfit >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-xs text-muted-foreground">Total Projected</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        'font-bold',
                        data.totalProjectedProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(data.totalProjectedProfit)}
                    </span>
                    {data.blendedMarginPercent !== null && (
                      <span
                        className={cn(
                          'text-xs ml-1',
                          data.blendedMarginPercent >= 0 ? 'text-green-600' : 'text-red-600'
                        )}
                      >
                        ({formatPercent(data.blendedMarginPercent)})
                      </span>
                    )}
                  </div>
                </div>

                {/* Velocity */}
                {data.itemsSoldPerWeek !== null && data.itemsSoldPerWeek > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {data.itemsSoldPerWeek.toFixed(1)} items/week
                      {data.projectedWeeksToSellRemaining !== null && (
                        <> &middot; ~{Math.round(data.projectedWeeksToSellRemaining)}w to clear</>
                      )}
                    </span>
                  </div>
                )}

                {/* Warnings */}
                {(data.itemsWithNoCost > 0 || data.itemsWithNoListingValue > 0) && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 pt-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>
                      {data.itemsWithNoCost > 0 && `${data.itemsWithNoCost} no cost`}
                      {data.itemsWithNoCost > 0 && data.itemsWithNoListingValue > 0 && ', '}
                      {data.itemsWithNoListingValue > 0 &&
                        `${data.itemsWithNoListingValue} unlisted`}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Unable to load profitability</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
