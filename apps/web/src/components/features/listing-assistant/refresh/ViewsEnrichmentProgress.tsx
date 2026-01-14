'use client';

import { Loader2, Eye } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { ViewsEnrichmentProgress as ViewsEnrichmentProgressType } from '@/lib/ebay/listing-refresh.types';

interface ViewsEnrichmentProgressProps {
  progress: ViewsEnrichmentProgressType | null;
  isEnriching: boolean;
}

/**
 * Progress indicator for views data enrichment (GetItem calls)
 */
export function ViewsEnrichmentProgress({
  progress,
  isEnriching,
}: ViewsEnrichmentProgressProps) {
  if (!isEnriching) return null;

  const percentage = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900">
          <Eye className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="font-medium text-blue-900 dark:text-blue-100">
                Fetching views data...
              </span>
            </div>
            {progress && (
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {progress.current} of {progress.total}
              </span>
            )}
          </div>
          <Progress value={percentage} className="h-2" />
          {progress && (
            <p className="text-sm text-blue-700 dark:text-blue-300 truncate">
              {progress.currentItemTitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
