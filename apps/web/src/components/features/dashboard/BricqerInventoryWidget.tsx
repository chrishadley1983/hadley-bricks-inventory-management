'use client';

import { Boxes, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBricqerInventoryStats } from '@/hooks';
import { formatCurrency } from '@/lib/utils';

/**
 * Widget displaying Bricqer inventory statistics
 * Shows: Lot Count (unique pieces), Piece Count (total quantity), Inventory Value
 */
export function BricqerInventoryWidget() {
  const { data, isLoading, error, refetch, isRefetching, progress } = useBricqerInventoryStats();

  const lotCount = data?.lotCount || 0;
  const pieceCount = data?.pieceCount || 0;
  const inventoryValue = data?.inventoryValue || 0;
  const lastUpdated = data?.lastUpdated;

  // Format last updated time
  const formatLastUpdated = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Bricqer Inventory</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Refresh stats"
          >
            <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
          </Button>
          <Boxes className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">
              {error instanceof Error ? error.message : 'Error loading stats'}
            </span>
          </div>
        ) : isRefetching && progress ? (
          <div className="space-y-3">
            {/* Progress bar during refresh */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.message}</span>
                <span>{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} className="h-2" />
            </div>

            {/* Live counts during scan */}
            {progress.lotCount !== undefined && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="text-center">
                  <div className="text-lg font-semibold text-muted-foreground">
                    {progress.lotCount.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Lots found</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-muted-foreground">
                    {(progress.pieceCount || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Pieces found</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Main stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-2xl font-bold">{lotCount.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Lots</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{pieceCount.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Pieces</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{formatCurrency(inventoryValue)}</div>
                <div className="text-xs text-muted-foreground">Value</div>
              </div>
            </div>

            {/* Last updated */}
            <div className="pt-2 border-t">
              <div className="text-xs text-muted-foreground text-center">
                Updated {formatLastUpdated(lastUpdated)}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
