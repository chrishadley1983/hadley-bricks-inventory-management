'use client';

import { Loader2, CheckCircle2, XCircle, AlertCircle, SkipForward } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { RefreshProgressEvent } from '@/lib/ebay/listing-refresh.types';

interface RefreshJobProgressProps {
  progress: RefreshProgressEvent | null;
  isExecuting: boolean;
}

const PHASE_LABELS = {
  fetching: 'Fetching listing details',
  ending: 'Ending old listings',
  creating: 'Creating new listings',
};

const PHASE_COLORS = {
  fetching: 'bg-blue-500',
  ending: 'bg-amber-500',
  creating: 'bg-green-500',
};

/**
 * Component to display real-time progress of a refresh job
 */
export function RefreshJobProgress({ progress, isExecuting }: RefreshJobProgressProps) {
  if (!isExecuting && !progress) return null;

  const percentage = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {isExecuting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                Processing Refresh
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Refresh Complete
              </>
            )}
          </CardTitle>
          {progress && (
            <Badge className={PHASE_COLORS[progress.phase]}>{PHASE_LABELS[progress.phase]}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {progress ? `${progress.current} of ${progress.total}` : 'Starting...'}
            </span>
            <span className="font-medium">{percentage}%</span>
          </div>
          <Progress value={percentage} className="h-2" />
        </div>

        {/* Current Item */}
        {progress && isExecuting && (
          <div className="text-sm">
            <span className="text-muted-foreground">Current: </span>
            <span className="font-medium truncate">{progress.currentItemTitle}</span>
          </div>
        )}

        {/* Stats */}
        {progress && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">
                <span className="font-medium">{progress.createdCount}</span> created
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <span className="text-sm">
                <span className="font-medium">{progress.endedCount}</span> ended
              </span>
            </div>
            {progress.failedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  <span className="font-medium">{progress.failedCount}</span> failed
                </span>
              </div>
            )}
            {progress.skippedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <SkipForward className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  <span className="font-medium">{progress.skippedCount}</span> skipped
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
