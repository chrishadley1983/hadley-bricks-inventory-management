'use client';

import { usePurchaseProfitability } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, AlertTriangle, Clock, BarChart3, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PurchaseProfitabilityProps {
  purchaseId: string;
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

function formatWeeks(weeks: number | null): string {
  if (weeks === null || weeks === undefined) return '-';
  if (weeks < 1) return '< 1 week';
  if (weeks < 2) return '~1 week';
  return `~${Math.round(weeks)} weeks`;
}

export function PurchaseProfitability({ purchaseId }: PurchaseProfitabilityProps) {
  const { data, isLoading, error } = usePurchaseProfitability(purchaseId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Profitability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Profitability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Unable to load profitability data</p>
        </CardContent>
      </Card>
    );
  }

  // Handle case where no items or uploads are linked
  const hasUploads = (data.uploadCount ?? 0) > 0;
  if (data.totalItems === 0 && !hasUploads) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Profitability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            No inventory items or uploads linked to this purchase yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const soldPercent = data.totalItems > 0 ? (data.soldItems / data.totalItems) * 100 : 0;
  const listedPercent = data.totalItems > 0 ? (data.listedItems / data.totalItems) * 100 : 0;

  // Use combined profit if we have uploads, otherwise just inventory
  const totalProfit = hasUploads
    ? (data.combinedTotalProjectedProfit ?? data.totalProjectedProfit)
    : data.totalProjectedProfit;
  const isProfitable = totalProfit >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Profitability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Section - only show if we have inventory items */}
        {data.totalItems > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {data.soldItems}/{data.totalItems} sold ({soldPercent.toFixed(0)}%)
              </span>
              <div className="flex items-center gap-3 text-muted-foreground text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {data.soldItems} sold
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  {data.listedItems} listed
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-gray-300" />
                  {data.unlistedItems} unlisted
                </span>
              </div>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="absolute h-full bg-green-500 transition-all"
                style={{ width: `${soldPercent}%` }}
              />
              <div
                className="absolute h-full bg-blue-500 transition-all"
                style={{ left: `${soldPercent}%`, width: `${listedPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Financial Breakdown Grid - only show if we have inventory items */}
        {data.totalItems > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {/* Realised Column */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">Realised</h4>
                <Badge variant="outline" className="text-xs">
                  {data.soldItems} items
                </Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue</span>
                  <span className="font-medium">{formatCurrency(data.realisedRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fees</span>
                  <span className="font-medium text-red-600">
                    {data.realisedFees > 0 ? `-${formatCurrency(data.realisedFees)}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost</span>
                  <span className="font-medium text-red-600">
                    {data.realisedCost > 0 ? `-${formatCurrency(data.realisedCost)}` : '-'}
                  </span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Profit</span>
                    <span
                      className={cn(
                        'font-bold',
                        data.realisedProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(data.realisedProfit)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Margin</span>
                    <span>{formatPercent(data.realisedMarginPercent)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Unrealised Column */}
            <div className="space-y-3 rounded-lg border p-4 border-dashed">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">Unrealised</h4>
                <Badge variant="outline" className="text-xs">
                  {data.listedItems} items
                </Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Listing Value</span>
                  <span className="font-medium">{formatCurrency(data.unrealisedValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Fees</span>
                  <span className="font-medium text-red-600">
                    {data.estimatedFees > 0 ? `-${formatCurrency(data.estimatedFees)}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost</span>
                  <span className="font-medium text-red-600">
                    {data.unrealisedCost > 0 ? `-${formatCurrency(data.unrealisedCost)}` : '-'}
                  </span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Projected</span>
                    <span
                      className={cn(
                        'font-bold',
                        data.unrealisedProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(data.unrealisedProfit)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Margin</span>
                    <span>{formatPercent(data.unrealisedMarginPercent)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BrickLink Uploads Section */}
        {hasUploads && (
          <div className="space-y-3 rounded-lg border p-4 border-blue-200 bg-blue-50/50">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Upload className="h-4 w-4" />
                BrickLink Uploads
              </h4>
              <Badge variant="outline" className="text-xs">
                {data.uploadCount} upload{data.uploadCount !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Selling Price</span>
                <span className="font-medium">
                  {formatCurrency(data.uploadTotalSellingPrice ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fees (10%)</span>
                <span className="font-medium text-red-600">
                  {(data.uploadTotalFees ?? 0) > 0
                    ? `-${formatCurrency(data.uploadTotalFees ?? 0)}`
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium text-red-600">
                  {(data.uploadTotalCost ?? 0) > 0
                    ? `-${formatCurrency(data.uploadTotalCost ?? 0)}`
                    : '-'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    Realised (
                    {(
                      ((data.uploadRealisedRevenue ?? 0) / (data.uploadTotalSellingPrice || 1)) *
                      100
                    ).toFixed(0)}
                    %)
                  </span>
                  <span className="text-green-600">
                    {formatCurrency(data.uploadRealisedRevenue ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Unrealised</span>
                  <span>{formatCurrency(data.uploadUnrealisedRevenue ?? 0)}</span>
                </div>
              </div>
              <div className="border-t pt-2">
                <div className="flex justify-between">
                  <span className="font-medium">Profit</span>
                  <span
                    className={cn(
                      'font-bold',
                      (data.uploadTotalProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    )}
                  >
                    {formatCurrency(data.uploadTotalProfit ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Margin</span>
                  <span>{formatPercent(data.uploadMarginPercent ?? null)}</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Revenue realises linearly over 365 days from upload date
            </p>
          </div>
        )}

        {/* Total Projected */}
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold">
                {hasUploads ? 'Combined Total Profit' : 'Total Projected Profit'}
              </h4>
              <p className="text-xs text-muted-foreground">
                {hasUploads ? (
                  <>
                    Items: {formatCurrency(data.totalProjectedRevenue)} | Uploads:{' '}
                    {formatCurrency(data.uploadTotalSellingPrice ?? 0)} | Total Cost:{' '}
                    {formatCurrency(data.totalCost + (data.uploadTotalCost ?? 0))}
                  </>
                ) : (
                  <>
                    Revenue: {formatCurrency(data.totalProjectedRevenue)} | Fees:{' '}
                    {formatCurrency(data.totalProjectedFees)} | Cost:{' '}
                    {formatCurrency(data.totalCost)}
                  </>
                )}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                {isProfitable ? (
                  <TrendingUp className="h-5 w-5 text-green-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-600" />
                )}
                <span
                  className={cn(
                    'text-2xl font-bold',
                    isProfitable ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {formatCurrency(totalProfit)}
                </span>
              </div>
              <p className={cn('text-sm', isProfitable ? 'text-green-600' : 'text-red-600')}>
                {formatPercent(
                  hasUploads ? (data.combinedMarginPercent ?? null) : data.blendedMarginPercent
                )}{' '}
                margin
              </p>
            </div>
          </div>
        </div>

        {/* Velocity */}
        {data.firstListingDate && data.soldItems > 0 && (
          <div className="flex items-center gap-4 text-sm border-t pt-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <span className="font-medium">{data.itemsSoldPerWeek?.toFixed(1)} items/week</span>
              <span className="text-muted-foreground ml-2">
                since first listing ({data.daysSinceFirstListing} days ago)
              </span>
            </div>
            {data.projectedWeeksToSellRemaining && (
              <Badge variant="secondary">
                {formatWeeks(data.projectedWeeksToSellRemaining)} to clear
              </Badge>
            )}
          </div>
        )}

        {/* Warnings */}
        {(data.itemsWithNoListingValue > 0 || data.itemsWithNoCost > 0) && (
          <div className="space-y-2 border-t pt-4">
            {data.itemsWithNoListingValue > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  {data.itemsWithNoListingValue} item
                  {data.itemsWithNoListingValue !== 1 ? 's have' : ' has'} no listing value
                </span>
              </div>
            )}
            {data.itemsWithNoCost > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  {data.itemsWithNoCost} item
                  {data.itemsWithNoCost !== 1 ? 's have' : ' has'} no cost assigned
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
