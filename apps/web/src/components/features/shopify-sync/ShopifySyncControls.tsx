'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  RefreshCw,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  useRunBatchSync,
  useProcessSyncQueue,
} from '@/hooks/use-shopify-sync';
import type { BatchSyncSummary } from '@/hooks/use-shopify-sync';

export function ShopifySyncControls() {
  const [lastResult, setLastResult] = useState<BatchSyncSummary | null>(null);

  const batchSync = useRunBatchSync();
  const processQueue = useProcessSyncQueue();

  const isRunning = batchSync.isPending || processQueue.isPending;

  const handleBatchSync = async () => {
    try {
      const result = await batchSync.mutateAsync(50);
      setLastResult(result);
    } catch {
      // Error handled by mutation
    }
  };

  const handleProcessQueue = async () => {
    try {
      const result = await processQueue.mutateAsync(10);
      setLastResult(result);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync Controls</CardTitle>
        <CardDescription>
          Push products to Shopify and process the sync queue
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleBatchSync}
            disabled={isRunning}
          >
            {batchSync.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run Batch Sync
          </Button>

          <Button
            variant="outline"
            onClick={handleProcessQueue}
            disabled={isRunning}
          >
            {processQueue.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Process Queue
          </Button>
        </div>

        {(batchSync.error || processQueue.error) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {batchSync.error?.message || processQueue.error?.message}
            </AlertDescription>
          </Alert>
        )}

        {lastResult && (
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {lastResult.items_failed === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              Sync Complete ({(lastResult.duration_ms / 1000).toFixed(1)}s)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm text-muted-foreground">
              <div>Processed: {lastResult.items_processed}</div>
              <div>Created: {lastResult.items_created}</div>
              <div>Added to group: {lastResult.items_added_to_group ?? 0}</div>
              <div>Archived: {lastResult.items_archived}</div>
              <div className={lastResult.items_failed > 0 ? 'text-red-500' : ''}>
                Failed: {lastResult.items_failed}
              </div>
            </div>
            {lastResult.errors.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                {lastResult.errors.slice(0, 5).map((err, i) => (
                  <div key={i} className="text-red-500">
                    {err.item_id.substring(0, 8)}... — {err.error}
                  </div>
                ))}
                {lastResult.errors.length > 5 && (
                  <div>...and {lastResult.errors.length - 5} more</div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
