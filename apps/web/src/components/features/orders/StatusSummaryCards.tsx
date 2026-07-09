'use client';

import { Layers } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { STATUS_META, UI_ORDER_STATUSES, type UiOrderStatus } from './order-status-meta';

interface StatusSummaryCardsProps {
  total: number;
  counts: Record<UiOrderStatus, number>;
  selectedStatus: string;
  onSelect: (status: string) => void;
  /** Render pulsing placeholders instead of misleading zeros while counts load */
  loading?: boolean;
}

function CountOrSkeleton({ loading, value, dim }: { loading: boolean; value: number; dim?: boolean }) {
  if (loading) {
    return <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted align-middle" />;
  }
  return (
    <span
      className={cn(
        'text-3xl font-bold tabular-nums tracking-tight',
        dim && 'text-muted-foreground/50'
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

/**
 * Clickable status-lifecycle scorecards. Each card carries the status colour
 * as a top rail + tinted icon chip; actionable statuses (Paid/Packed) pulse
 * when non-zero so pending work is visible at a glance.
 */
export function StatusSummaryCards({
  total,
  counts,
  selectedStatus,
  onSelect,
  loading = false,
}: StatusSummaryCardsProps) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
      <Card
        role="button"
        aria-pressed={selectedStatus === 'all'}
        className={cn(
          'relative overflow-hidden cursor-pointer transition-all hover:shadow-md',
          selectedStatus === 'all' ? 'ring-2 ring-primary shadow-sm' : 'hover:bg-muted/50'
        )}
        onClick={() => onSelect('all')}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-foreground/80" />
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              All Orders
            </span>
            <span className="rounded-md p-1.5 bg-muted text-foreground/70">
              <Layers className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="text-3xl font-bold tabular-nums tracking-tight">
            <CountOrSkeleton loading={loading} value={total} />
          </div>
        </CardContent>
      </Card>

      {UI_ORDER_STATUSES.map((s) => {
        const meta = STATUS_META[s];
        const Icon = meta.icon;
        const count = counts[s] ?? 0;
        const needsAction = meta.actionable && count > 0;
        const selected = selectedStatus === s;
        return (
          <Card
            key={s}
            role="button"
            aria-pressed={selected}
            className={cn(
              'relative overflow-hidden cursor-pointer transition-all hover:shadow-md',
              selected ? 'ring-2 ring-primary shadow-sm' : 'hover:bg-muted/50'
            )}
            onClick={() => onSelect(selected ? 'all' : s)}
          >
            <div className={cn('absolute inset-x-0 top-0 h-1', meta.bar)} />
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {meta.label}
                </span>
                <span className={cn('rounded-md p-1.5', meta.chip)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <CountOrSkeleton loading={loading} value={count} dim={count === 0} />
                {!loading && needsAction && (
                  <span className="relative flex h-2 w-2" title="Needs action">
                    <span
                      className={cn(
                        'animate-ping absolute inline-flex h-full w-full rounded-full opacity-60',
                        meta.bar
                      )}
                    />
                    <span className={cn('relative inline-flex rounded-full h-2 w-2', meta.bar)} />
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
