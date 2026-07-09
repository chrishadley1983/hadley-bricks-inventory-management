'use client';

import Link from 'next/link';
import { AlertTriangle, Clock, Tag, RefreshCw, CheckCircle2, HelpCircle } from 'lucide-react';
import { Widget } from '@/components/ui/widget';
import { useInventorySummary, useBricqerInventoryStats } from '@/hooks';
import { useDashboardStore } from '@/stores';
import { formatCurrency, cn } from '@/lib/utils';
import { STATUS_META } from './status-meta';

const KNOWN_STATUS_KEYS = new Set([...STATUS_META.map((m) => m.key)]);

interface AlertItem {
  id: string;
  icon: React.ReactNode;
  iconWrap: string;
  title: string;
  description: string;
  href?: string;
}

/**
 * Operational alerts that actually need attention — inbound deliveries,
 * unvalued backlog, stale Bricqer sync, and unrecognised inventory statuses
 * (the sentinel for the mixed-case status bug class).
 */
export function AlertsWidget() {
  const excludeSold = useDashboardStore((state) => state.excludeSold);
  const platform = useDashboardStore((state) => state.platform);
  const { data, isLoading, error } = useInventorySummary({ excludeSold, platform });
  const { data: bricqer } = useBricqerInventoryStats();

  const valueByStatus = data?.valueByStatus ?? {};
  const alerts: AlertItem[] = [];

  // Inbound deliveries
  const inbound = valueByStatus['NOT YET RECEIVED'];
  if (inbound?.count) {
    alerts.push({
      id: 'not-received',
      icon: <Clock className="h-4 w-4 text-amber-700" />,
      iconWrap: 'bg-amber-100',
      title: 'Awaiting delivery',
      description: `${inbound.count.toLocaleString()} item${inbound.count > 1 ? 's' : ''} inbound · ${formatCurrency(inbound.cost)} at cost`,
      href: '/inventory?status=NOT%20YET%20RECEIVED',
    });
  }

  // Backlog items without a listing value
  const unvalued = valueByStatus['BACKLOG_UNVALUED'];
  if (unvalued?.count) {
    alerts.push({
      id: 'unvalued-backlog',
      icon: <Tag className="h-4 w-4 text-blue-700" />,
      iconWrap: 'bg-blue-100',
      title: 'Backlog needs pricing',
      description: `${unvalued.count.toLocaleString()} item${unvalued.count > 1 ? 's' : ''} without a listing value · ${formatCurrency(unvalued.cost)} at cost`,
      href: '/inventory?status=BACKLOG',
    });
  }

  // Stale Bricqer sync (>36h)
  if (bricqer?.lastUpdated) {
    const ageHours = (Date.now() - new Date(bricqer.lastUpdated).getTime()) / 3_600_000;
    if (ageHours > 36) {
      const days = Math.floor(ageHours / 24);
      alerts.push({
        id: 'bricqer-stale',
        icon: <RefreshCw className="h-4 w-4 text-rose-700" />,
        iconWrap: 'bg-rose-100',
        title: 'Bricqer sync is stale',
        description: `Store stats last synced ${days >= 1 ? `${days}d` : `${Math.floor(ageHours)}h`} ago — numbers may be out of date`,
      });
    }
  }

  // Unrecognised statuses — the sentinel that catches rogue status values
  const unknownCount = Object.entries(valueByStatus)
    .filter(([key]) => !KNOWN_STATUS_KEYS.has(key))
    .reduce((sum, [, info]) => sum + (info?.count ?? 0), 0);
  if (unknownCount > 0) {
    alerts.push({
      id: 'unknown-status',
      icon: <HelpCircle className="h-4 w-4 text-rose-700" />,
      iconWrap: 'bg-rose-100',
      title: 'Unrecognised inventory status',
      description: `${unknownCount.toLocaleString()} item${unknownCount > 1 ? 's' : ''} with a status the dashboard doesn't recognise — shown as “Other” in the pipeline`,
      href: '/inventory',
    });
  }

  return (
    <Widget
      title="Alerts"
      icon={<AlertTriangle className="h-4 w-4" />}
      action={
        isLoading ? null : alerts.length > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white tabular-nums">
            {alerts.length}
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500" title="All clear" />
        )
      }
      error={error instanceof Error ? error : null}
    >
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <p className="text-sm text-muted-foreground">All clear — nothing needs attention</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const body = (
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                    alert.iconWrap
                  )}
                >
                  {alert.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">{alert.description}</p>
                </div>
              </div>
            );
            return alert.href ? (
              <Link
                key={alert.id}
                href={alert.href}
                className="block rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                {body}
              </Link>
            ) : (
              <div key={alert.id} className="rounded-lg border p-3">
                {body}
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}
