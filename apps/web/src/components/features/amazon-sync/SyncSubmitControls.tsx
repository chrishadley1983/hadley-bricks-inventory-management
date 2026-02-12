'use client';

import { useState, useCallback } from 'react';
import { CloudUpload, CheckCircle2, Loader2, Trash2, Info, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useSubmitSyncFeed,
  useClearSyncQueue,
  useTwoPhaseSync,
  type SyncMode,
  type TwoPhaseStepResult,
} from '@/hooks/use-amazon-sync';

interface SyncSubmitControlsProps {
  queueCount: number;
  uniqueAsins: number;
  onFeedCreated?: (feedId: string) => void;
  onTwoPhaseComplete?: (result: TwoPhaseStepResult) => void;
}

/** Map two-phase step to user-friendly status */
function getStepDisplayInfo(step: TwoPhaseStepResult['step']): { label: string; progress: number } {
  switch (step) {
    case 'price_polling':
      return { label: 'Waiting for Amazon to process price update...', progress: 20 };
    case 'price_verification':
      return { label: 'Verifying price is live on Amazon...', progress: 50 };
    case 'quantity_submission':
      return { label: 'Submitting quantity update...', progress: 70 };
    case 'quantity_polling':
      return { label: 'Waiting for Amazon to process quantity update...', progress: 85 };
    case 'complete':
      return { label: 'Sync complete!', progress: 100 };
    default:
      return { label: 'Processing...', progress: 10 };
  }
}

export function SyncSubmitControls({
  queueCount,
  uniqueAsins,
  onFeedCreated,
  onTwoPhaseComplete,
}: SyncSubmitControlsProps) {
  const [dryRun, setDryRun] = useState(true);
  const [syncMode, setSyncMode] = useState<SyncMode>('two_phase');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [twoPhaseError, setTwoPhaseError] = useState<string | null>(null);

  // Track the feed ID for two-phase sync polling
  const [activeTwoPhaseFeedId, setActiveTwoPhaseFeedId] = useState<string | null>(null);

  const submitMutation = useSubmitSyncFeed();
  const clearMutation = useClearSyncQueue();

  // Callbacks for two-phase sync completion
  const handleTwoPhaseComplete = useCallback(
    (result: TwoPhaseStepResult) => {
      setActiveTwoPhaseFeedId(null);
      onTwoPhaseComplete?.(result);
    },
    [onTwoPhaseComplete]
  );

  const handleTwoPhaseError = useCallback((error: Error) => {
    setTwoPhaseError(error.message);
    // Don't clear the feed ID - user can see progress even if polling fails
  }, []);

  // Two-phase sync polling hook
  const { result: twoPhaseResult, isPending: isTwoPhasePolling } = useTwoPhaseSync(
    activeTwoPhaseFeedId,
    {
      enabled: !!activeTwoPhaseFeedId,
      onComplete: handleTwoPhaseComplete,
      onError: handleTwoPhaseError,
    }
  );

  const handleSubmit = async () => {
    try {
      setTwoPhaseError(null);
      const result = await submitMutation.mutateAsync({
        dryRun,
        syncMode,
      });

      // Handle both single-phase and two-phase results
      const feedId = result.feed?.id || result.result?.priceFeed?.id;
      if (onFeedCreated && feedId) {
        onFeedCreated(feedId);
      }

      // If two-phase sync started (not dry run), begin polling
      if (syncMode === 'two_phase' && !dryRun && result.result?.priceFeed?.id) {
        setActiveTwoPhaseFeedId(result.result.priceFeed.id);
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
  const isTwoPhase = syncMode === 'two_phase';
  const isTwoPhaseInProgress = !!activeTwoPhaseFeedId;
  const isDisabled = isEmpty || isSubmitting || isTwoPhaseInProgress;

  // Get display info for current two-phase step
  const stepInfo = twoPhaseResult?.step ? getStepDisplayInfo(twoPhaseResult.step) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Two-phase progress indicator */}
      {isTwoPhaseInProgress && (
        <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="ml-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-blue-800 dark:text-blue-200">
                  Two-Phase Sync in Progress
                </span>
                {isTwoPhasePolling && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {stepInfo?.label || 'Starting...'}
              </p>
              <Progress value={stepInfo?.progress || 5} className="h-2" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                You can safely navigate away - you&apos;ll receive a notification when complete.
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Two-phase error */}
      {twoPhaseError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <div className="flex flex-col gap-1">
              <span className="font-medium">Sync Error</span>
              <p className="text-sm">{twoPhaseError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-fit"
                onClick={() => {
                  setTwoPhaseError(null);
                  setActiveTwoPhaseFeedId(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center space-x-2">
            <Switch
              id="dry-run"
              checked={dryRun}
              onCheckedChange={setDryRun}
              disabled={isDisabled}
            />
            <Label htmlFor="dry-run" className="cursor-pointer">
              Dry Run
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="two-phase"
              checked={isTwoPhase}
              onCheckedChange={(checked: boolean) => setSyncMode(checked ? 'two_phase' : 'single')}
              disabled={isDisabled || dryRun}
            />
            <Label htmlFor="two-phase" className="cursor-pointer flex items-center gap-1">
              Two-Phase Sync
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>
                      Submits price update first, waits until it&apos;s live on Amazon (up to 30 min),
                      then submits quantity. Prevents selling at old price when updating both.
                      You can safely navigate away - you&apos;ll receive email/push notifications when complete.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
          </div>

          <span
            className="text-sm text-muted-foreground cursor-help"
            title={
              dryRun
                ? "Validates the feed payload against Amazon's API without actually submitting changes."
                : isTwoPhase
                  ? 'Submits price first, verifies, then quantity. Email/push notification on completion.'
                  : 'Submits the feed to Amazon for processing. Price and quantity updates will be applied.'
            }
          >
            {dryRun
              ? '(Validate only)'
              : isTwoPhase
                ? '(Price → Verify → Quantity)'
                : '(Submit to Amazon)'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowClearConfirm(true)}
            disabled={isDisabled}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear Queue
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={isDisabled}
            className="min-w-[140px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {dryRun ? 'Validating...' : isTwoPhase ? 'Starting...' : 'Submitting...'}
              </>
            ) : dryRun ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Validate ({uniqueAsins})
              </>
            ) : (
              <>
                <CloudUpload className="mr-2 h-4 w-4" />
                {isTwoPhase ? `2-Phase Sync (${uniqueAsins})` : `Sync to Amazon (${uniqueAsins})`}
              </>
            )}
          </Button>
        </div>
      </div>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Queue</DialogTitle>
            <DialogDescription>
              Are you sure you want to clear all {queueCount} items from the sync queue? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClear} disabled={clearMutation.isPending}>
              {clearMutation.isPending ? 'Clearing...' : 'Clear All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
