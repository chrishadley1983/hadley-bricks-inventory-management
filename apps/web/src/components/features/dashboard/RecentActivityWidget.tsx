'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import { ListWidget } from '@/components/ui/widget';
import { useInventoryList } from '@/hooks';
import { formatRelativeTime, formatCurrency, cn } from '@/lib/utils';

/**
 * Widget displaying recently added inventory items
 */
export function RecentActivityWidget() {
  const { data, isLoading, error } = useInventoryList(undefined, { page: 1, pageSize: 5 });

  const items =
    data?.data.map((item) => (
      <Link
        key={item.id}
        href={`/inventory/${item.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {item.item_name || `Set ${item.set_number}`}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {item.set_number}
            </span>
            {item.condition && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-medium',
                  item.condition === 'New'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                )}
              >
                {item.condition}
              </span>
            )}
            {item.listing_platform && (
              <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 capitalize">
                {item.listing_platform}
              </span>
            )}
          </div>
        </div>
        <div className="ml-2 shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">
            {item.cost ? formatCurrency(item.cost) : '—'}
          </p>
          <p className="text-xs text-muted-foreground">{formatRelativeTime(item.created_at)}</p>
        </div>
      </Link>
    )) || [];

  return (
    <ListWidget
      title="Recent Activity"
      description="Recently added inventory (cost shown)"
      icon={<Clock className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
      emptyMessage="No recent inventory items"
      items={items}
    />
  );
}
