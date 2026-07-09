'use client';

import { Boxes, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBricqerInventoryStats } from '@/hooks';
import { formatCurrency, cn } from '@/lib/utils';

type Freshness = 'fresh' | 'ageing' | 'stale' | 'never';

function getFreshness(dateStr: string | null | undefined): {
  state: Freshness;
  label: string;
} {
  if (!dateStr) return { state: 'never', label: 'Never synced' };
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rel =
    diffMins < 1
      ? 'just now'
      : diffMins < 60
        ? `${diffMins}m ago`
        : diffHours < 24
          ? `${diffHours}h ago`
          : `${diffDays}d ago`;

  const state: Freshness = diffHours <= 36 ? 'fresh' : diffDays <= 7 ? 'ageing' : 'stale';
  return { state, label: `Synced ${rel}` };
}

const FRESHNESS_STYLES: Record<Freshness, { dot: string; text: string }> = {
  fresh: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  ageing: { dot: 'bg-amber-500', text: 'text-amber-700' },
  stale: { dot: 'bg-rose-500', text: 'text-rose-700' },
  never: { dot: 'bg-slate-400', text: 'text-muted-foreground' },
};

/**
 * Widget displaying Bricqer store inventory statistics (live snapshot data),
 * with a freshness badge so stale sync data can't masquerade as current.
 */
export function BricqerInventoryWidget() {
  const { data, isLoading, error, refetch, isRefetching, progress } = useBricqerInventoryStats();

  const lotCount = data?.lotCount || 0;
  const pieceCount = data?.pieceCount || 0;
  const inventoryValue = data?.inventoryValue || 0;
  const freshness = getFreshness(data?.lastUpdated);
  const styles = FRESHNESS_STYLES[freshness.state];

  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Bricqer Store
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Run a full re-scan (~3 min)"
          >
            <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
          </Button>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-100">
            <Boxes className="h-4 w-4 text-violet-700" />
          </div>
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
          <div className="space-y-4">
            {/* Main stats */}
            <div className="grid grid-cols-3 divide-x divide-border/60">
              <div className="pr-2">
                <div className="text-2xl font-bold tracking-tight tabular-nums">
                  {lotCount.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Lots</div>
              </div>
              <div className="px-3">
                <div className="text-2xl font-bold tracking-tight tabular-nums">
                  {pieceCount.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Pieces</div>
              </div>
              <div className="pl-3">
                <div className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatCurrency(inventoryValue)}
                </div>
                <div className="text-xs text-muted-foreground">Value</div>
              </div>
            </div>

            {/* Freshness */}
            <div className="flex items-center gap-2 border-t pt-2" title={data?.lastUpdated ?? ''}>
              <span className={cn('h-2 w-2 rounded-full', styles.dot)} />
              <span className={cn('text-xs font-medium', styles.text)}>{freshness.label}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
