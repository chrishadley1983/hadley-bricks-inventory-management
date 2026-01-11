'use client';

import { useState } from 'react';
import { CloudUpload, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSubmitSyncFeed, useClearSyncQueue } from '@/hooks/use-amazon-sync';

interface SyncSubmitControlsProps {
  queueCount: number;
  uniqueAsins: number;
  onFeedCreated?: (feedId: string) => void;
}

export function SyncSubmitControls({
  queueCount,
  uniqueAsins,
  onFeedCreated,
}: SyncSubmitControlsProps) {
  const [dryRun, setDryRun] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const submitMutation = useSubmitSyncFeed();
  const clearMutation = useClearSyncQueue();

  const handleSubmit = async () => {
    try {
      const result = await submitMutation.mutateAsync(dryRun);
      if (onFeedCreated && result.feed) {
        onFeedCreated(result.feed.id);
      }
    } catch (error) {
      console.error('Submit failed:', error);
    }
  };

  const handleClear = async () => {
    try {
      await clearMutation.mutateAsync();
    } finally {
      setShowClearConfirm(false);
    }
  };

  const isSubmitting = submitMutation.isPending;
  const isEmpty = queueCount === 0;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="dry-run"
            checked={dryRun}
            onCheckedChange={setDryRun}
            disabled={isSubmitting}
          />
          <Label htmlFor="dry-run" className="cursor-pointer">
            Dry Run
          </Label>
        </div>

        <span
          className="text-sm text-muted-foreground cursor-help"
          title={dryRun
            ? 'Validates the feed payload against Amazon\'s API without actually submitting changes.'
            : 'Submits the feed to Amazon for processing. Price and quantity updates will be applied.'
          }
        >
          {dryRun ? '(Validate only)' : '(Submit to Amazon)'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setShowClearConfirm(true)}
          disabled={isEmpty || isSubmitting}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Clear Queue
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={isEmpty || isSubmitting}
          className="min-w-[140px]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {dryRun ? 'Validating...' : 'Submitting...'}
            </>
          ) : dryRun ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Validate ({uniqueAsins})
            </>
          ) : (
            <>
              <CloudUpload className="mr-2 h-4 w-4" />
              Sync to Amazon ({uniqueAsins})
            </>
          )}
        </Button>
      </div>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Queue</DialogTitle>
            <DialogDescription>
              Are you sure you want to clear all {queueCount} items from the
              sync queue? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClear}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? 'Clearing...' : 'Clear All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
