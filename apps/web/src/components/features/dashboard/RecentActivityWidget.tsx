'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import { Widget } from '@/components/ui/widget';
import { useInventoryList } from '@/hooks';
import { formatRelativeTime, formatCurrency, cn } from '@/lib/utils';

/**
 * Widget displaying recently added inventory items — one quiet metadata line
 * per row; colour reserved for the Used condition flag only.
 */
export function RecentActivityWidget() {
  const { data, isLoading, error } = useInventoryList(undefined, { page: 1, pageSize: 5 });

  const items = data?.data ?? [];

  return (
    <Widget
      title="Recent Activity"
      description="Recently added inventory (cost shown)"
      icon={<Clock className="h-4 w-4" />}
      error={error instanceof Error ? error : null}
    >
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent inventory items</p>
      ) : (
        <div className="divide-y divide-border/60">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/inventory/${item.id}`}
              className="flex items-center justify-between gap-3 rounded px-1 py-2.5 transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.item_name || `Set ${item.set_number}`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{item.set_number}</span>
                  {item.condition && (
                    <>
                      {' · '}
                      <span className={cn(item.condition === 'Used' && 'text-amber-600')}>
                        {item.condition}
                      </span>
                    </>
                  )}
                  {item.listing_platform && (
                    <>
                      {' · '}
                      <span className="capitalize">{item.listing_platform}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="ml-2 shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {item.cost ? formatCurrency(item.cost) : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(item.created_at)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
