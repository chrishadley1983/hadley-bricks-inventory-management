'use client';

import { RefreshCw, Check, AlertCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TableSyncStatus } from '@/stores';

interface SyncStatusBadgeProps {
  status: TableSyncStatus;
  showTime?: boolean;
  className?: string;
}

/**
 * Badge showing sync status for a table
 */
export function SyncStatusBadge({ status, showTime = false, className }: SyncStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status.status) {
      case 'synced':
        return {
          icon: Check,
          label: 'Synced',
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 hover:bg-green-100',
        };
      case 'syncing':
        return {
          icon: RefreshCw,
          label: 'Syncing...',
          variant: 'secondary' as const,
          className: 'animate-pulse',
        };
      case 'stale':
        return {
          icon: Clock,
          label: 'Stale',
          variant: 'outline' as const,
          className: 'text-yellow-600 border-yellow-300',
        };
      case 'error':
        return {
          icon: AlertCircle,
          label: 'Error',
          variant: 'destructive' as const,
          className: '',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Badge
      variant={config.variant}
      className={cn('gap-1', config.className, className)}
    >
      <Icon
        className={cn(
          'h-3 w-3',
          status.status === 'syncing' && 'animate-spin'
        )}
      />
      <span>{config.label}</span>
      {showTime && status.lastSync && (
        <span className="text-xs opacity-70">
          ({formatTime(status.lastSync)})
        </span>
      )}
    </Badge>
  );
}
