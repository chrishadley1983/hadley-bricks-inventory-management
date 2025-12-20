'use client';

import Link from 'next/link';
import { AlertTriangle, ShoppingCart, Clock } from 'lucide-react';
import { Widget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';

/**
 * Widget displaying low stock alerts and pending items
 */
export function LowStockWidget() {
  const { data, isLoading, error } = useInventorySummary();

  const notReceivedCount = data?.byStatus?.['NOT YET RECEIVED'] || 0;
  const listedCount = data?.byStatus?.['LISTED'] || 0;

  const alerts = [];

  if (notReceivedCount > 0) {
    alerts.push({
      id: 'not-received',
      icon: <Clock className="h-4 w-4 text-yellow-500" />,
      title: 'Pending Receipt',
      description: `${notReceivedCount} item${notReceivedCount > 1 ? 's' : ''} awaiting delivery`,
      href: '/inventory?status=NOT%20YET%20RECEIVED',
    });
  }

  if (listedCount > 0) {
    alerts.push({
      id: 'listed',
      icon: <ShoppingCart className="h-4 w-4 text-blue-500" />,
      title: 'Listed Items',
      description: `${listedCount} item${listedCount > 1 ? 's' : ''} currently listed`,
      href: '/inventory?status=LISTED',
    });
  }

  return (
    <Widget
      title="Alerts & Status"
      icon={<AlertTriangle className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts at this time</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
            >
              {alert.icon}
              <div>
                <p className="font-medium">{alert.title}</p>
                <p className="text-xs text-muted-foreground">{alert.description}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
