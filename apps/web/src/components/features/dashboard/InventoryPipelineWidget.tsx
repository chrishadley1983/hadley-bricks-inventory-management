'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { Widget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';
import { useDashboardStore } from '@/stores';
import { formatCurrency, cn } from '@/lib/utils';
import { STATUS_META, OTHER_META, type StatusMeta } from './status-meta';

interface Segment {
  meta: StatusMeta;
  count: number;
  cost: number;
  value: number;
}

const STATUS_LINKS: Record<string, string> = {
  'NOT YET RECEIVED': '/inventory?status=NOT%20YET%20RECEIVED',
  BACKLOG_VALUED: '/inventory?status=BACKLOG',
  BACKLOG_UNVALUED: '/inventory?status=BACKLOG',
  LISTED: '/inventory?status=LISTED',
  SOLD: '/inventory?status=SOLD',
  RETURNED: '/inventory?status=RETURNED',
};

/**
 * Inventory pipeline: one stacked bar + value table, built from EVERY status
 * key the API returns. Unknown statuses fold into "Other" instead of being
 * silently dropped, so the Total row always reconciles with the rows above it.
 */
export function InventoryPipelineWidget() {
  const excludeSold = useDashboardStore((state) => state.excludeSold);
  const platform = useDashboardStore((state) => state.platform);
  const { data, isLoading, error } = useInventorySummary({ excludeSold, platform });

  const { segments, totals } = useMemo(() => {
    const valueByStatus = data?.valueByStatus ?? {};
    const known = new Map(STATUS_META.map((m) => [m.key, m]));

    const segs: Segment[] = [];
    let other: Segment | null = null;

    // Known statuses first, in pipeline order
    for (const meta of STATUS_META) {
      const info = valueByStatus[meta.key];
      if (!info?.count) continue;
      if (excludeSold && meta.key === 'SOLD') continue;
      segs.push({ meta, count: info.count, cost: info.cost, value: info.listingValue });
    }

    // Catch-all: anything the map doesn't know still shows up
    for (const [key, info] of Object.entries(valueByStatus)) {
      if (known.has(key) || !info.count) continue;
      if (excludeSold && key === 'SOLD') continue;
      if (!other) other = { meta: OTHER_META, count: 0, cost: 0, value: 0 };
      other.count += info.count;
      other.cost += info.cost;
      other.value += info.listingValue;
    }
    if (other) segs.push(other);

    return {
      segments: segs,
      totals: {
        count: segs.reduce((s, x) => s + x.count, 0),
        cost: data?.totalCost ?? 0,
        value: data?.totalListingValue ?? 0,
      },
    };
  }, [data, excludeSold]);

  // Listed margin (profit as % of listing value, before fees)
  const listed = segments.find((s) => s.meta.key === 'LISTED');
  const listedMargin =
    listed && listed.value > 0 ? Math.round(((listed.value - listed.cost) / listed.value) * 100) : null;

  return (
    <Widget
      title="Inventory Pipeline"
      icon={<Layers className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {totals.count === 0 ? (
        <p className="text-sm text-muted-foreground">No inventory items</p>
      ) : (
        <div className="space-y-4">
          {/* Stacked count bar (2px gaps between segments) */}
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {segments.map((s) => (
              <div
                key={s.meta.key}
                className="h-3 rounded-sm transition-all"
                style={{
                  width: `${(s.count / totals.count) * 100}%`,
                  backgroundColor: s.meta.hex,
                  minWidth: s.count > 0 ? 3 : 0,
                }}
                title={`${s.meta.label}: ${s.count.toLocaleString()} items`}
              />
            ))}
          </div>

          {/* Per-status rows */}
          <div>
            <div className="grid grid-cols-[1fr_4rem_5.5rem_5.5rem] gap-2 border-b pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <div>Status</div>
              <div className="text-right">Items</div>
              <div className="text-right">Cost</div>
              <div className="text-right">Value</div>
            </div>
            <div className="divide-y divide-border/60">
              {segments.map((s) => {
                const href = STATUS_LINKS[s.meta.key];
                const row = (
                  <div className="grid grid-cols-[1fr_4rem_5.5rem_5.5rem] items-center gap-2 py-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: s.meta.hex }}
                      />
                      <span className="font-medium">{s.meta.label}</span>
                    </div>
                    <div className="text-right tabular-nums">{s.count.toLocaleString()}</div>
                    <div className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(s.cost)}
                    </div>
                    <div className="text-right tabular-nums text-muted-foreground">
                      {s.meta.hideValue ? '—' : formatCurrency(s.value)}
                    </div>
                  </div>
                );
                return href ? (
                  <Link key={s.meta.key} href={href} className="block rounded hover:bg-muted/60">
                    {row}
                  </Link>
                ) : (
                  <div key={s.meta.key}>{row}</div>
                );
              })}
            </div>

            {/* Total row (from the same response — reconciles with rows by construction) */}
            <div className="grid grid-cols-[1fr_4rem_5.5rem_5.5rem] gap-2 border-t pt-2 text-sm font-semibold">
              <div>Total</div>
              <div className="text-right tabular-nums">{totals.count.toLocaleString()}</div>
              <div className="text-right tabular-nums">{formatCurrency(totals.cost)}</div>
              <div className="text-right tabular-nums">{formatCurrency(totals.value)}</div>
            </div>
          </div>

          {/* Listed margin */}
          {listedMargin != null && (
            <div className="flex items-center justify-between border-t pt-2 text-xs">
              <span className="text-muted-foreground">Listed margin (before fees)</span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  listedMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                {listedMargin >= 0 ? '+' : ''}
                {listedMargin}%
              </span>
            </div>
          )}
        </div>
      )}
    </Widget>
  );
}
