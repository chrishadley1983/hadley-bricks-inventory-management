'use client';

import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { RefreshJob, RefreshJobStatus } from '@/lib/ebay/listing-refresh.types';

interface RefreshHistoryListProps {
  jobs: RefreshJob[];
  isLoading?: boolean;
  onViewDetails?: (jobId: string) => void;
}

const STATUS_CONFIG: Record<
  RefreshJobStatus,
  { label: string; icon: React.ReactNode; color: string }
> = {
  pending: {
    label: 'Pending',
    icon: <Clock className="h-4 w-4" />,
    color: 'bg-slate-100 text-slate-700',
  },
  fetching: {
    label: 'Fetching',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: 'bg-blue-100 text-blue-700',
  },
  ending: {
    label: 'Ending',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: 'bg-amber-100 text-amber-700',
  },
  creating: {
    label: 'Creating',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: 'bg-green-100 text-green-700',
  },
  completed: {
    label: 'Completed',
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'bg-green-100 text-green-700',
  },
  failed: {
    label: 'Failed',
    icon: <XCircle className="h-4 w-4" />,
    color: 'bg-red-100 text-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'bg-slate-100 text-slate-700',
  },
};

/**
 * List of past refresh operations
 */
export function RefreshHistoryList({
  jobs,
  isLoading = false,
  onViewDetails,
}: RefreshHistoryListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No refresh history</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Completed refresh operations will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Recent Refresh History</h3>
      {jobs.map((job) => {
        const statusConfig = STATUS_CONFIG[job.status];
        const timeAgo = formatDistanceToNow(new Date(job.createdAt), { addSuffix: true });
        const successRate =
          job.totalListings > 0 ? Math.round((job.createdCount / job.totalListings) * 100) : 0;

        return (
          <Card key={job.id} className="hover:bg-muted/50 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={statusConfig.color}>
                      <span className="mr-1.5">{statusConfig.icon}</span>
                      {statusConfig.label}
                    </Badge>
                    {job.reviewMode && <Badge variant="outline">Review Mode</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {job.totalListings} listing{job.totalListings !== 1 ? 's' : ''} &bull; {timeAgo}
                  </p>
                  {job.status === 'completed' && (
                    <p className="text-sm">
                      <span className="text-green-600">{job.createdCount} created</span>
                      {job.failedCount > 0 && (
                        <span className="text-red-600 ml-2">{job.failedCount} failed</span>
                      )}
                      {job.skippedCount > 0 && (
                        <span className="text-muted-foreground ml-2">
                          {job.skippedCount} skipped
                        </span>
                      )}
                      <span className="text-muted-foreground ml-2">({successRate}% success)</span>
                    </p>
                  )}
                  {job.errorMessage && <p className="text-sm text-red-600">{job.errorMessage}</p>}
                </div>
                {onViewDetails && (
                  <Button variant="ghost" size="sm" onClick={() => onViewDetails(job.id)}>
                    Details
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
