'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { usePollSyncFeed, useVerifyFeed } from '@/hooks/use-amazon-sync';
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
    description?: string;
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
  done_verifying: {
    icon: Loader2,
    label: 'Verifying Prices',
    variant: 'default',
    color: 'text-amber-500',
    description: 'Waiting for price to propagate on Amazon',
  },
  verified: {
    icon: CheckCircle2,
    label: 'Verified',
    variant: 'default',
    color: 'text-green-500',
    description: 'Price verified live on Amazon',
  },
  verification_failed: {
    icon: AlertTriangle,
    label: 'Verification Failed',
    variant: 'destructive',
    description: 'Price not visible after timeout - quantity NOT updated',
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
  // Two-phase sync statuses
  price_pending: {
    icon: Clock,
    label: 'Price Pending',
    variant: 'secondary',
    description: 'Price feed not yet submitted',
  },
  price_submitted: {
    icon: Loader2,
    label: 'Price Submitted',
    variant: 'default',
    color: 'text-blue-500',
    description: 'Price feed submitted to Amazon',
  },
  price_processing: {
    icon: Loader2,
    label: 'Price Processing',
    variant: 'default',
    color: 'text-blue-500',
    description: 'Amazon processing price update',
  },
  price_verifying: {
    icon: Loader2,
    label: 'Price Verifying',
    variant: 'default',
    color: 'text-amber-500',
    description: 'Waiting for price to be visible on Amazon (up to 30 min)',
  },
  price_verified: {
    icon: CheckCircle2,
    label: 'Price Verified',
    variant: 'default',
    color: 'text-green-500',
    description: 'Price confirmed live - submitting quantity',
  },
  quantity_pending: {
    icon: Clock,
    label: 'Quantity Pending',
    variant: 'secondary',
    description: 'Quantity feed not yet submitted',
  },
  quantity_submitted: {
    icon: Loader2,
    label: 'Quantity Submitted',
    variant: 'default',
    color: 'text-blue-500',
    description: 'Quantity feed submitted to Amazon',
  },
  quantity_processing: {
    icon: Loader2,
    label: 'Quantity Processing',
    variant: 'default',
    color: 'text-blue-500',
    description: 'Amazon processing quantity update',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    variant: 'default',
    color: 'text-green-500',
    description: 'Two-phase sync completed successfully',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    variant: 'destructive',
    description: 'Two-phase sync failed - check notifications',
  },
};

export function SyncFeedStatus({ feed, showPollButton = false }: SyncFeedStatusProps) {
  const [isPolling, setIsPolling] = useState(false);
  const pollMutation = usePollSyncFeed();
  const verifyMutation = useVerifyFeed();

  // Stable refs for mutations to avoid re-registering intervals on every render
  const pollRef = useRef(pollMutation);
  pollRef.current = pollMutation;
  const verifyRef = useRef(verifyMutation);
  verifyRef.current = verifyMutation;

  const config = STATUS_CONFIG[feed.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isProcessing = feed.status === 'submitted' || feed.status === 'processing';
  const isVerifying = feed.status === 'done_verifying';
  const isComplete = !['pending', 'submitted', 'processing', 'done_verifying'].includes(
    feed.status
  );

  // Auto-poll while processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setIsPolling(true);
      pollRef.current.mutate(feed.id, {
        onSettled: () => setIsPolling(false),
      });
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [feed.id, isProcessing]);

  // Auto-verify prices while in done_verifying status
  useEffect(() => {
    if (!isVerifying) return;

    // Initial verify after a short delay (give Amazon time to propagate)
    const initialTimeout = setTimeout(() => {
      verifyRef.current.mutate(feed.id);
    }, 5000);

    // Then retry every 60 seconds
    const interval = setInterval(() => {
      verifyRef.current.mutate(feed.id);
    }, 60000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [feed.id, isVerifying]);

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
          <Icon className={`h-3.5 w-3.5 ${isProcessing || isVerifying ? 'animate-spin' : ''}`} />
          {config.label}
        </Badge>

        {feed.is_dry_run && <Badge variant="outline">Dry Run</Badge>}

        {(isComplete || isVerifying) && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600">{feed.success_count} success</span>
            {(feed.warning_count ?? 0) > 0 && (
              <span className="text-yellow-600">{feed.warning_count} warnings</span>
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
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isPolling ? 'animate-spin' : ''}`} />
            Poll
          </Button>
        )}
      </div>

      {isProcessing && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{isPolling ? 'Checking status...' : 'Waiting for Amazon...'}</span>
            <span>
              Poll {feed.poll_count ?? 0} / {MAX_POLL_ATTEMPTS}
            </span>
          </div>
          <Progress value={pollProgress} className="h-1" />
        </div>
      )}

      {config.description && !feed.error_message && (
        <p className="text-xs text-muted-foreground">{config.description}</p>
      )}

      {feed.error_message && <p className="text-sm text-destructive">{feed.error_message}</p>}
    </div>
  );
}
