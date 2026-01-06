'use client';

import { TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useInventorySummary } from '@/hooks';
import { useDashboardStore } from '@/stores';
import { formatCurrency, cn } from '@/lib/utils';

// Status display order and colors
const STATUS_CONFIG: Record<string, { label: string; color: string; hideValue?: boolean }> = {
  'NOT YET RECEIVED': { label: 'Not Received', color: 'text-gray-500' },
  BACKLOG_VALUED: { label: 'Backlog (Valued)', color: 'text-blue-600' },
  BACKLOG_UNVALUED: { label: 'Backlog (Unvalued)', color: 'text-blue-400', hideValue: true },
  LISTED: { label: 'Listed', color: 'text-purple-600' },
  SOLD: { label: 'Sold', color: 'text-green-600' },
  RETURNED: { label: 'Returned', color: 'text-orange-600' },
  unknown: { label: 'No Status', color: 'text-gray-400' },
};

const STATUS_ORDER = ['NOT YET RECEIVED', 'BACKLOG_VALUED', 'BACKLOG_UNVALUED', 'LISTED', 'SOLD', 'RETURNED', 'unknown'];

/**
 * Widget displaying financial overview with status breakdown in a grid
 */
export function FinancialSnapshotWidget() {
  const excludeSold = useDashboardStore((state) => state.excludeSold);
  const platform = useDashboardStore((state) => state.platform);
  const { data, isLoading, error } = useInventorySummary({ excludeSold, platform });

  const totalCost = data?.totalCost || 0;
  const totalListingValue = data?.totalListingValue || 0;

  // Calculate listed profit margin (profit as % of selling price)
  const listedInfo = data?.valueByStatus?.['LISTED'];
  const listedCost = listedInfo?.cost || 0;
  const listedValue = listedInfo?.listingValue || 0;
  const listedMargin = listedValue > 0 ? Math.round(((listedValue - listedCost) / listedValue) * 100) : 0;

  // Filter statuses based on excludeSold setting
  const displayStatuses = excludeSold
    ? STATUS_ORDER.filter((s) => s !== 'SOLD')
    : STATUS_ORDER;

  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error instanceof Error ? error.message : 'Error'}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header row */}
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
              <div>Status</div>
              <div className="text-right">Cost</div>
              <div className="text-right">Value</div>
            </div>

            {/* Status rows */}
            {displayStatuses.map((status) => {
              const info = data?.valueByStatus?.[status];
              const config = STATUS_CONFIG[status] || { label: status, color: 'text-gray-600' };
              const cost = info?.cost || 0;
              const value = info?.listingValue || 0;
              const count = info?.count || 0;

              if (count === 0) return null;

              return (
                <div key={status} className="grid grid-cols-3 gap-2 text-xs">
                  <div className={cn('font-medium', config.color)}>
                    {config.label} ({count})
                  </div>
                  <div className="text-right text-muted-foreground">{formatCurrency(cost)}</div>
                  <div className="text-right text-muted-foreground">
                    {config.hideValue ? '-' : formatCurrency(value)}
                  </div>
                </div>
              );
            })}

            {/* Total row */}
            <div className="grid grid-cols-3 gap-2 text-sm font-semibold border-t pt-2">
              <div>Total</div>
              <div className="text-right">{formatCurrency(totalCost)}</div>
              <div className="text-right">{formatCurrency(totalListingValue)}</div>
            </div>

            {/* Listed margin */}
            {listedCost > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Listed Margin (Before Fees)</span>
                  <span className={cn('font-medium', listedMargin >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {listedMargin >= 0 ? '+' : ''}{listedMargin}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
