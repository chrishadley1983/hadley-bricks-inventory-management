'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle2, AlertTriangle, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLATFORM_META, STATUS_META, type UiOrderStatus } from './order-status-meta';

interface PlatformCardProps {
  platformKey: string;
  configured: boolean;
  /** Platform filter is currently set to this platform */
  active: boolean;
  total: number;
  /** Order counts by UI status (drives the distribution bar + chips) */
  distribution: Partial<Record<UiOrderStatus, number>>;
  /** Which status chips to render, in order */
  statusOrder: UiOrderStatus[];
  /** Chip label overrides (e.g. Cancelled → "Refunded" on eBay) */
  chipLabels?: Partial<Record<UiOrderStatus, string>>;
  lastSyncedAt: string | Date | null;
  /** Shown instead of a sync timestamp when the platform has no manual sync */
  syncNote?: string;
  onSelect: () => void;
  onStatusSelect: (status: UiOrderStatus) => void;
  /** Header title link (e.g. /orders/amazon). Falls back to onSelect click. */
  titleHref?: string;
  configureLabel?: string;
  /** Still resolving configuration/counts — show a skeleton, not "Not configured" */
  loading?: boolean;
  /** Extra classes on the root Card (layout overrides per card) */
  className?: string;
  /** Action buttons / platform-specific extras */
  children?: ReactNode;
}

/** Sync freshness: <24h fine, <72h aging, older = stale. */
function freshness(lastSyncedAt: string | Date | null): {
  label: string;
  className: string;
  stale: boolean;
} | null {
  if (!lastSyncedAt) return null;
  const date = new Date(lastSyncedAt);
  if (isNaN(date.getTime())) return null;
  const hours = (Date.now() - date.getTime()) / 36e5;
  const distance = formatDistanceToNowStrict(date, { addSuffix: true });
  if (hours < 24) {
    return {
      label: `Synced ${distance}`,
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
      stale: false,
    };
  }
  if (hours < 72) {
    return {
      label: `Synced ${distance}`,
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
      stale: false,
    };
  }
  return {
    label: `Stale — last sync ${distance}`,
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
    stale: true,
  };
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A platform scorecard: brand-accented rail, order count, a stacked
 * status-distribution bar, clickable status chips, sync freshness badge and a
 * slot for platform-specific actions. Actions pin to the card bottom so a row
 * of cards keeps its buttons aligned.
 */
export function PlatformCard({
  platformKey,
  configured,
  active,
  total,
  distribution,
  statusOrder,
  chipLabels,
  lastSyncedAt,
  syncNote,
  onSelect,
  onStatusSelect,
  titleHref,
  configureLabel = 'Configure',
  loading = false,
  className,
  children,
}: PlatformCardProps) {
  const meta = PLATFORM_META[platformKey] ?? { name: platformKey, color: '#64748B' };
  const fresh = freshness(lastSyncedAt);
  const segments = statusOrder
    .map((s) => ({ status: s, count: distribution[s] ?? 0 }))
    .filter((seg) => seg.count > 0);

  const title = (
    <CardTitle
      className="text-sm font-semibold cursor-pointer hover:text-primary flex items-center gap-2"
      onClick={titleHref ? undefined : onSelect}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.name}
    </CardTitle>
  );

  return (
    <Card
      className={cn(
        'relative overflow-hidden flex flex-col',
        active && 'ring-2 ring-primary',
        className
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: meta.color, opacity: 0.85 }}
      />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-5">
        {titleHref ? <Link href={titleHref}>{title}</Link> : title}
        {!configured ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : fresh?.stale ? (
          <AlertTriangle className="h-4 w-4 text-rose-500" aria-label="Sync stale" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {loading ? (
          <div className="space-y-2" aria-busy>
            <div className="h-9 w-24 animate-pulse rounded bg-muted" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          </div>
        ) : configured ? (
          <>
            <div className="space-y-2">
              <button
                type="button"
                className={cn(
                  'flex items-baseline gap-1.5 text-left cursor-pointer hover:text-primary rounded-sm',
                  FOCUS_RING
                )}
                onClick={onSelect}
              >
                <span className="text-3xl font-bold tabular-nums tracking-tight">
                  {total.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground font-medium">orders</span>
              </button>

              {/* Status distribution bar — flex-grow keeps segments honest
                  (proportional to count) while min-w keeps tiny ones visible */}
              <div
                className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                {segments.map((seg) => (
                  <div
                    key={seg.status}
                    className={cn('h-full min-w-[3px] basis-0', STATUS_META[seg.status].bar)}
                    style={{ flexGrow: seg.count }}
                    title={`${STATUS_META[seg.status].label}: ${seg.count.toLocaleString()}`}
                  />
                ))}
              </div>

              <div className="flex gap-x-3 gap-y-2 text-xs flex-wrap">
                {statusOrder.map((s) => {
                  const count = distribution[s] ?? 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-muted',
                        FOCUS_RING,
                        count > 0 ? STATUS_META[s].text : 'text-muted-foreground'
                      )}
                      onClick={() => onStatusSelect(s)}
                    >
                      <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
                      {chipLabels?.[s] ?? STATUS_META[s].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {fresh ? (
              <span
                className={cn(
                  'inline-flex items-center self-start rounded-full px-2 py-0.5 text-[11px] font-medium',
                  fresh.className,
                  fresh.stale && 'font-semibold'
                )}
              >
                {fresh.label}
              </span>
            ) : syncNote ? (
              <p className="text-[11px] text-muted-foreground">{syncNote}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Never synced</p>
            )}

            {children ? <div className="mt-auto space-y-3 pt-1">{children}</div> : null}
          </>
        ) : (
          <>
            <div className="text-lg font-medium text-muted-foreground">Not configured</div>
            <Link href="/settings/integrations">
              <Button variant="outline" size="sm" className="w-full">
                <Settings className="mr-2 h-4 w-4" />
                {configureLabel}
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
