'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListingImport } from '@/lib/platform-stock';

interface ImportStatusBannerProps {
  import?: ListingImport | null;
  isImporting?: boolean;
  platform?: 'amazon' | 'ebay';
  className?: string;
}

export function ImportStatusBanner({
  import: importData,
  isImporting = false,
  platform = 'amazon',
  className,
}: ImportStatusBannerProps) {
  const platformLabel = platform === 'ebay' ? 'eBay' : 'Amazon';
  const importMessage = platform === 'ebay'
    ? 'Fetching listings from eBay. This may take a few minutes.'
    : 'Fetching report from Amazon. This may take a few minutes.';

  // Show importing state
  if (isImporting) {
    return (
      <Alert className={cn('border-blue-200 bg-blue-50 dark:bg-blue-950/20', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <AlertTitle className="text-blue-800 dark:text-blue-400">
          Importing listings...
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-300">
          {importMessage}
        </AlertDescription>
      </Alert>
    );
  }

  // Show import result
  if (importData) {
    if (importData.status === 'processing') {
      return (
        <Alert className={cn('border-blue-200 bg-blue-50 dark:bg-blue-950/20', className)}>
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <AlertTitle className="text-blue-800 dark:text-blue-400">
            Import in progress
          </AlertTitle>
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            Processing {importData.processedRows || 0} of {importData.totalRows || '?'} listings...
          </AlertDescription>
        </Alert>
      );
    }

    if (importData.status === 'failed') {
      return (
        <Alert variant="destructive" className={className}>
          <XCircle className="h-4 w-4" />
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>
            {importData.errorMessage || 'An unknown error occurred during import.'}
          </AlertDescription>
        </Alert>
      );
    }

    if (importData.status === 'completed') {
      const completedAt = importData.completedAt
        ? new Date(importData.completedAt).toLocaleString('en-GB', {
            dateStyle: 'short',
            timeStyle: 'short',
          })
        : 'Unknown';

      return (
        <Alert className={cn('border-green-200 bg-green-50 dark:bg-green-950/20', className)}>
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800 dark:text-green-400">
            Import complete
          </AlertTitle>
          <AlertDescription className="text-green-700 dark:text-green-300">
            {importData.processedRows ?? 0} listings imported at {completedAt}
            {(importData.errorCount ?? 0) > 0 && ` (${importData.errorCount} skipped)`}
          </AlertDescription>
        </Alert>
      );
    }

    if (importData.status === 'pending') {
      return (
        <Alert className={cn('border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20', className)}>
          <Clock className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-400">
            Import pending
          </AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            Import is queued and will start shortly.
          </AlertDescription>
        </Alert>
      );
    }
  }

  // No import data
  return null;
}

interface LastImportInfoProps {
  import?: ListingImport | null;
  className?: string;
}

export function LastImportInfo({ import: importData, className }: LastImportInfoProps) {
  if (!importData || importData.status !== 'completed') {
    return (
      <span className={cn('text-sm text-muted-foreground', className)}>
        No previous import
      </span>
    );
  }

  const completedAt = importData.completedAt
    ? new Date(importData.completedAt).toLocaleString('en-GB', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'Unknown';

  return (
    <span className={cn('text-sm text-muted-foreground', className)}>
      Last import: {completedAt} ({importData.processedRows} listings)
    </span>
  );
}
