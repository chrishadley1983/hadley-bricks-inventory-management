'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { usePollSyncFeed } from '@/hooks/use-amazon-sync';
import type { SyncFeed } from '@/lib/amazon/amazon-sync.types';
import { MAX_POLL_ATTEMPTS } from '@/lib/amazon/amazon-sync.types';

interface SyncFeedStatusProps {
  feed: SyncFeed;
  showPollButton?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    color?: string;
  }
> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    variant: 'secondary',
  },
  submitted: {
    icon: Loader2,
    label: 'Submitted',
    variant: 'default',
    color: 'text-blue-500',
  },
  processing: {
    icon: Loader2,
    label: 'Processing',
    variant: 'default',
    color: 'text-blue-500',
  },
  done: {
    icon: CheckCircle2,
    label: 'Complete',
    variant: 'default',
    color: 'text-green-500',
  },
  cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    variant: 'destructive',
  },
  fatal: {
    icon: XCircle,
    label: 'Failed',
    variant: 'destructive',
  },
  error: {
    icon: XCircle,
    label: 'Error',
    variant: 'destructive',
  },
  processing_timeout: {
    icon: AlertTriangle,
    label: 'Timeout',
    variant: 'destructive',
  },
};

export function SyncFeedStatus({ feed, showPollButton = false }: SyncFeedStatusProps) {
  const [isPolling, setIsPolling] = useState(false);
  const pollMutation = usePollSyncFeed();

  const config = STATUS_CONFIG[feed.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isProcessing = feed.status === 'submitted' || feed.status === 'processing';
  const isComplete = !['pending', 'submitted', 'processing'].includes(feed.status);

  // Auto-poll while processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setIsPolling(true);
      pollMutation.mutate(feed.id, {
        onSettled: () => setIsPolling(false),
      });
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [feed.id, feed.status, isProcessing, pollMutation]);

  const handleManualPoll = () => {
    setIsPolling(true);
    pollMutation.mutate(feed.id, {
      onSettled: () => setIsPolling(false),
    });
  };

  // Calculate progress for polling indicator
  const pollProgress = feed.poll_count
    ? Math.min((feed.poll_count / MAX_POLL_ATTEMPTS) * 100, 100)
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge
          variant={config.variant}
          className={`flex items-center gap-1.5 ${config.color || ''}`}
        >
          <Icon
            className={`h-3.5 w-3.5 ${isProcessing ? 'animate-spin' : ''}`}
          />
          {config.label}
        </Badge>

        {feed.is_dry_run && (
          <Badge variant="outline">Dry Run</Badge>
        )}

        {isComplete && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600">
              {feed.success_count} success
            </span>
            {(feed.warning_count ?? 0) > 0 && (
              <span className="text-yellow-600">
                {feed.warning_count} warnings
              </span>
            )}
            {(feed.error_count ?? 0) > 0 && (
              <span className="text-red-600">{feed.error_count} errors</span>
            )}
          </div>
        )}

        {showPollButton && isProcessing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualPoll}
            disabled={isPolling || pollMutation.isPending}
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${isPolling ? 'animate-spin' : ''}`}
            />
            Poll
          </Button>
        )}
      </div>

      {isProcessing && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {isPolling ? 'Checking status...' : 'Waiting for Amazon...'}
            </span>
            <span>Poll {feed.poll_count ?? 0} / {MAX_POLL_ATTEMPTS}</span>
          </div>
          <Progress value={pollProgress} className="h-1" />
        </div>
      )}

      {feed.error_message && (
        <p className="text-sm text-destructive">{feed.error_message}</p>
      )}
    </div>
  );
}
