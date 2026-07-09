'use client';

import type { KeyboardEvent } from 'react';
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

function CountOrSkeleton({
  loading,
  value,
  dim,
  accent,
}: {
  loading: boolean;
  value: number;
  dim?: boolean;
  /** Status text colour applied when the count demands action */
  accent?: string;
}) {
  if (loading) {
    return <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted align-middle" />;
  }
  return (
    <span
      className={cn(
        'text-3xl font-bold tabular-nums tracking-tight',
        accent,
        dim && 'text-muted-foreground'
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/**
 * Clickable status-lifecycle scorecards. Colour is reserved for meaning:
 * actionable statuses (Paid/Packed) tint their card surface and count when
 * work is waiting; everything else stays quiet so the dispatch queue is the
 * loudest thing in the row.
 */
export function StatusSummaryCards({
  total,
  counts,
  selectedStatus,
  onSelect,
  loading = false,
}: StatusSummaryCardsProps) {
  const cardKeyDown = (action: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
      <Card
        role="button"
        tabIndex={0}
        aria-pressed={selectedStatus === 'all'}
        className={cn(
          'cursor-pointer transition-all hover:shadow-md',
          FOCUS_RING,
          selectedStatus === 'all' ? 'border-foreground/30 shadow-sm' : 'hover:bg-muted/50'
        )}
        onClick={() => onSelect('all')}
        onKeyDown={cardKeyDown(() => onSelect('all'))}
      >
        <CardContent className="pt-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap truncate">
              All Orders
            </span>
            <span className="rounded-md p-1.5 text-muted-foreground/70">
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
        const toggle = () => onSelect(selected ? 'all' : s);
        return (
          <Card
            key={s}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            className={cn(
              'cursor-pointer transition-all hover:shadow-md',
              FOCUS_RING,
              needsAction && meta.activeSurface,
              selected ? 'ring-2 ring-primary shadow-sm' : !needsAction && 'hover:bg-muted/50'
            )}
            onClick={toggle}
            onKeyDown={cardKeyDown(toggle)}
          >
            <CardContent className="pt-5 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate"
                  title={meta.cardLabel ?? meta.label}
                >
                  {meta.cardLabel ?? meta.label}
                </span>
                <span className="rounded-md p-1.5 text-muted-foreground/70">
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <CountOrSkeleton
                  loading={loading}
                  value={count}
                  dim={count === 0}
                  accent={needsAction ? meta.text : undefined}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
