'use client';

import { BarChart3 } from 'lucide-react';
import { Widget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  'NOT YET RECEIVED': 'bg-yellow-500',
  'IN STOCK': 'bg-green-500',
  LISTED: 'bg-blue-500',
  SOLD: 'bg-purple-500',
};

const STATUS_LABELS: Record<string, string> = {
  'NOT YET RECEIVED': 'Not Received',
  'IN STOCK': 'In Stock',
  LISTED: 'Listed',
  SOLD: 'Sold',
};

/**
 * Widget displaying inventory breakdown by status
 */
export function StatusBreakdownWidget() {
  const { data, isLoading, error } = useInventorySummary();

  const byStatus = data?.byStatus || {};
  const totalItems = data?.totalItems || 0;

  const statuses = ['NOT YET RECEIVED', 'IN STOCK', 'LISTED', 'SOLD'];

  return (
    <Widget
      title="Inventory by Status"
      icon={<BarChart3 className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {totalItems === 0 ? (
        <p className="text-sm text-muted-foreground">No inventory items</p>
      ) : (
        <div className="space-y-3">
          {statuses.map((status) => {
            const count = byStatus[status] || 0;
            const percentage = totalItems > 0 ? (count / totalItems) * 100 : 0;

            return (
              <div key={status} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
                  <span className="font-medium">{count}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className={cn('h-2 rounded-full transition-all', STATUS_COLORS[status])}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}
