'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import { ListWidget } from '@/components/ui/widget';
import { useInventoryList } from '@/hooks';
import { formatRelativeTime, formatCurrency } from '@/lib/utils';

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
        className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.item_name || `Set ${item.set_number}`}</p>
          <p className="text-xs text-muted-foreground">
            {item.set_number} &middot; {item.condition || 'Unknown'}
          </p>
        </div>
        <div className="ml-4 text-right">
          <p className="text-sm font-medium">{item.cost ? formatCurrency(item.cost) : '-'}</p>
          <p className="text-xs text-muted-foreground">{formatRelativeTime(item.created_at)}</p>
        </div>
      </Link>
    )) || [];

  return (
    <ListWidget
      title="Recent Activity"
      description="Recently added inventory"
      icon={<Clock className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
      emptyMessage="No recent inventory items"
      items={items}
    />
  );
}
